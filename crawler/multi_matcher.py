"""
多平台配對引擎 — 在欣亞 vs 原價屋配對基礎上，加入 PCHOME 和 momo 的價格比對
策略：
1. 以欣亞 vs 原價屋配對結果為基礎
2. 對每個配對成功的商品，使用欣亞品名 + 原價屋品名雙重搜尋 PCHOME 和 momo
3. 取配對分數最高者作為最佳配對
4. 降低跨平台配對門檻至 0.55 以提升覆蓋率
"""

import sys
import os
import re
from difflib import SequenceMatcher

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from matcher import (
    norm, head, extract_tokens, extract_brands, veto,
    compute_score, is_excluded, build_inverted_index,
    MATCH_THRESHOLD, compute_spec_diff,
)


def find_best_match(query_name, products, product_index, pos_to_orig,
                    category_compat=None, query_category="", threshold=0.55):
    """
    在給定的商品列表中找到與 query_name 最相似的商品。
    使用與主配對引擎相同的計分和否決邏輯，但降低門檻以適應跨平台品名差異。
    Returns: (best_product, best_score) or (None, 0)
    """
    tokens = extract_tokens(query_name)
    candidate_positions = set()
    for tok in tokens:
        if tok in product_index:
            candidate_positions.update(product_index[tok])

    if not candidate_positions:
        return None, 0

    best_score = -1
    best_pos = -1

    for ci_pos in candidate_positions:
        ci_orig = pos_to_orig.get(ci_pos, ci_pos)
        if ci_orig >= len(products):
            continue
        cp = products[ci_orig]
        if cp.get("price", 0) == 0 or not cp.get("name"):
            continue
        if is_excluded(cp["name"]):
            continue

        # Category compatibility check (loose for cross-platform)
        if category_compat and query_category:
            cat_c = cp.get("category", "")
            if cat_c and query_category and cat_c != query_category:
                if (query_category, cat_c) not in category_compat and (cat_c, query_category) not in category_compat:
                    continue

        is_vetoed, reason = veto(query_name, cp["name"])
        if is_vetoed:
            continue

        score, details = compute_score(query_name, cp["name"])
        if score > best_score:
            best_score = score
            best_pos = ci_pos

    if best_pos >= 0 and best_score >= threshold:
        ci_orig = pos_to_orig.get(best_pos, best_pos)
        return products[ci_orig], best_score

    return None, 0


def find_best_match_multi_query(query_names, products, product_index, pos_to_orig,
                                 category_compat=None, query_category="", threshold=0.55):
    """
    使用多個品名（欣亞品名 + 原價屋品名 + 配對名稱）搜尋最佳配對。
    取所有搜尋中分數最高者。
    Returns: (best_product, best_score) or (None, 0)
    """
    best_prod = None
    best_score = 0

    for qname in query_names:
        if not qname:
            continue
        prod, score = find_best_match(
            qname, products, product_index, pos_to_orig,
            category_compat, query_category, threshold
        )
        if prod and score > best_score:
            best_prod = prod
            best_score = score

    return best_prod, best_score


def _extract_rule_alias(name):
    """Return one high-signal model alias; deliberately never returns generic product words."""
    cleaned = re.sub(r'【[^】]*】', ' ', name or '').upper()
    cleaned = re.split(r'[/\(（〈]', cleaned)[0]
    codes = re.findall(r'\b(?=[A-Z0-9-]{4,}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)*\b', cleaned)
    if codes:
        return sorted(codes, key=len, reverse=True)[0]
    series = re.search(r'\b(?:ROG|TUF|STRIX|ISKUR|KATANA|THINKPAD|ELITEBOOK|IDEAPAD|NITRO|PREDATOR|PRIME|MORTAR)\s+[A-Z0-9-]+(?:\s+[A-Z0-9-]+)?\b', cleaned)
    return series.group(0) if series else ''


def _find_rule_product(products, target_name, target_id, target_alias, platform):
    """Find a current crawler product from a saved feedback rule without fuzzy matching."""
    clean_id = str(target_id or "")
    if clean_id.startswith(f"{platform}_"):
        clean_id = clean_id[len(platform) + 1:]
    for product in products:
        if clean_id and str(product.get("id", "")) == clean_id:
            return product
    for product in products:
        if product.get("name") == target_name:
            return product
    if target_alias:
        alias_candidates = [
            product for product in products
            if _extract_rule_alias(product.get("name", "")) == target_alias.upper()
        ]
        if len(alias_candidates) == 1:
            return alias_candidates[0]
    return None


def _recalculate_cheaper(match):
    prices = {
        "sinya": match.get("sinya_price", 0),
        "coolpc": match.get("coolpc_price", 0),
    }
    if match.get("pchome_price", 0) > 0:
        prices["pchome"] = match["pchome_price"]
    if match.get("momo_price", 0) > 0:
        prices["momo"] = match["momo_price"]
    prices = {platform: price for platform, price in prices.items() if price > 0}
    if not prices:
        match["cheaper"] = "tie"
        return
    lowest = min(prices.values())
    platforms = [platform for platform, price in prices.items() if price == lowest]
    match["cheaper"] = platforms[0] if len(platforms) == 1 else "tie"


def apply_confirmed_rules(matched, sinya_products, coolpc_products, pchome_products,
                          momo_products, confirmed_rules, platforms):
    """Apply exact administrator confirmations. Rules never bypass target availability checks."""
    if not confirmed_rules:
        return 0, 0

    products_by_platform = {
        "coolpc": coolpc_products,
        "pchome": pchome_products,
        "momo": momo_products,
    }
    sinya_by_name = {product.get("name"): product for product in sinya_products if product.get("name")}
    matched_by_sinya = {match.get("sinya_name"): match for match in matched}
    applied = 0
    skipped = 0

    for rule in confirmed_rules:
        platform = rule.get("platform")
        if platform not in platforms or platform not in products_by_platform:
            continue
        sinya_name = rule.get("sinyaName") or rule.get("sinya_name")
        target_name = rule.get("targetName") or rule.get("target_name")
        target_id = rule.get("targetId") or rule.get("target_id")
        source_alias = rule.get("sourceAlias") or rule.get("source_alias") or ""
        target_alias = rule.get("targetAlias") or rule.get("target_alias") or ""
        source = sinya_by_name.get(sinya_name)
        if not source and source_alias:
            source_candidates = [
                product for product in sinya_products
                if _extract_rule_alias(product.get("name", "")) == source_alias.upper()
            ]
            if len(source_candidates) == 1:
                source = source_candidates[0]
                sinya_name = source["name"]
        target = _find_rule_product(products_by_platform[platform], target_name, target_id, target_alias, platform)
        if not source or not target:
            skipped += 1
            continue

        match = matched_by_sinya.get(sinya_name)
        if platform == "coolpc":
            if not match:
                match = {
                    "name": source["name"],
                    "sinya_name": source["name"],
                    "coolpc_name": target["name"],
                    "sinya_price": source.get("price", 0),
                    "coolpc_price": target.get("price", 0),
                    "price_diff": source.get("price", 0) - target.get("price", 0),
                    "sinya_url": source.get("url", ""),
                    "coolpc_url": target.get("url", ""),
                    "sinya_image": source.get("image", ""),
                    "coolpc_image": target.get("image", ""),
                    "category": source.get("category") or target.get("category", ""),
                    "score": 1.0,
                    "is_bare_match": False,
                    "spec_diff": compute_spec_diff(source["name"], target["name"]),
                }
                matched.append(match)
                matched_by_sinya[sinya_name] = match
            else:
                match.update({
                    "coolpc_name": target["name"],
                    "coolpc_price": target.get("price", 0),
                    "coolpc_url": target.get("url", ""),
                    "coolpc_image": target.get("image", ""),
                    "price_diff": source.get("price", 0) - target.get("price", 0),
                    "score": 1.0,
                    "spec_diff": compute_spec_diff(source["name"], target["name"]),
                })
        elif not match:
            # The current table is anchored on a Sinya/CoolPC row. Retain the rule for a later run
            # rather than fabricating a missing CoolPC price column.
            skipped += 1
            continue
        else:
            match[f"{platform}_name"] = target["name"]
            match[f"{platform}_price"] = target.get("price", 0)
            match[f"{platform}_url"] = target.get("url", "")
            match[f"{platform}_image"] = target.get("image", "")
            match[f"{platform}_score"] = 1.0

        match["manual_rule"] = True
        _recalculate_cheaper(match)
        applied += 1

    return applied, skipped


def match_all_platforms(sinya_products, coolpc_products, pchome_products, momo_products,
                        category_compat=None, confirmed_rules=None):
    """
    四平台配對主函數。
    1. 先執行欣亞 vs 原價屋配對（使用現有引擎）
    2. 對每個配對成功的商品，使用欣亞+原價屋雙品名搜尋 PCHOME 和 momo
    3. 回傳包含四平台價格的配對結果
    """
    from matcher import match_products_v2

    # Step 1: 欣亞 vs 原價屋配對
    matched, rejected, review, price_review = match_products_v2(
        sinya_products, coolpc_products, category_compat=category_compat
    )

    coolpc_rules_applied, coolpc_rules_skipped = apply_confirmed_rules(
        matched, sinya_products, coolpc_products, pchome_products, momo_products,
        confirmed_rules or [], {"coolpc"}
    )

    print(f"\n=== 多平台擴展配對開始 ===")
    print(f"  PCHOME 商品數: {len(pchome_products)}")
    print(f"  momo 商品數: {len(momo_products)}")

    # Step 2: 為 PCHOME 和 momo 建立倒排索引
    pchome_valid = [p for p in pchome_products if p.get("price", 0) > 0 and p.get("name") and not is_excluded(p["name"])]
    momo_valid = [p for p in momo_products if p.get("price", 0) > 0 and p.get("name") and not is_excluded(p["name"])]

    pchome_index = build_inverted_index(pchome_valid)
    momo_index = build_inverted_index(momo_valid)

    pchome_pos_to_orig = {i: i for i in range(len(pchome_valid))}
    momo_pos_to_orig = {i: i for i in range(len(momo_valid))}

    # Step 3: 對每個已配對的商品，使用雙品名搜尋 PCHOME 和 momo
    pchome_matched_count = 0
    momo_matched_count = 0

    for m in matched:
        # 使用欣亞品名 + 原價屋品名 + 配對名稱進行多重搜尋
        query_names = [
            m.get("sinya_name", ""),
            m.get("coolpc_name", ""),
            m.get("name", ""),
        ]

        # 搜尋 PCHOME — 使用多重品名
        pchome_prod, pchome_score = find_best_match_multi_query(
            query_names, pchome_valid, pchome_index, pchome_pos_to_orig
        )
        if pchome_prod:
            m["pchome_name"] = pchome_prod["name"]
            m["pchome_price"] = pchome_prod["price"]
            m["pchome_url"] = pchome_prod.get("url", "")
            m["pchome_image"] = pchome_prod.get("image", "")
            m["pchome_score"] = round(pchome_score, 4)
            pchome_matched_count += 1
        else:
            m["pchome_name"] = ""
            m["pchome_price"] = 0
            m["pchome_url"] = ""
            m["pchome_image"] = ""
            m["pchome_score"] = 0

        # 搜尋 momo — 使用多重品名
        momo_prod, momo_score = find_best_match_multi_query(
            query_names, momo_valid, momo_index, momo_pos_to_orig
        )
        if momo_prod:
            m["momo_name"] = momo_prod["name"]
            m["momo_price"] = momo_prod["price"]
            m["momo_url"] = momo_prod.get("url", "")
            m["momo_image"] = momo_prod.get("image", "")
            m["momo_score"] = round(momo_score, 4)
            momo_matched_count += 1
        else:
            m["momo_name"] = ""
            m["momo_price"] = 0
            m["momo_url"] = ""
            m["momo_image"] = ""
            m["momo_score"] = 0

        _recalculate_cheaper(m)

    extra_rules_applied, extra_rules_skipped = apply_confirmed_rules(
        matched, sinya_products, coolpc_products, pchome_products, momo_products,
        confirmed_rules or [], {"pchome", "momo"}
    )

    print(f"  PCHOME 配對成功: {pchome_matched_count} / {len(matched)} 組")
    print(f"  momo 配對成功: {momo_matched_count} / {len(matched)} 組")
    print(f"  人工確認規則套用: {coolpc_rules_applied + extra_rules_applied} 組（等待商品資料: {coolpc_rules_skipped + extra_rules_skipped} 組）")
    print(f"=== 多平台配對完成 ===\n")

    return matched, rejected, review, price_review
