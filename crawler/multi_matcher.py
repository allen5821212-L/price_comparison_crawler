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


def match_all_platforms(sinya_products, coolpc_products, pchome_products, momo_products,
                        category_compat=None):
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

        # 重新計算最便宜的平台
        prices = {
            "sinya": m["sinya_price"],
            "coolpc": m["coolpc_price"],
        }
        if m["pchome_price"] > 0:
            prices["pchome"] = m["pchome_price"]
        if m["momo_price"] > 0:
            prices["momo"] = m["momo_price"]

        min_price = min(prices.values())
        min_platforms = [p for p, v in prices.items() if v == min_price]
        if len(min_platforms) == len(prices):
            m["cheaper"] = "tie"
        elif min_price == m["sinya_price"] and min_price == m["coolpc_price"]:
            m["cheaper"] = "tie"
        else:
            m["cheaper"] = min_platforms[0] if len(min_platforms) == 1 else min_platforms[0]

    print(f"  PCHOME 配對成功: {pchome_matched_count} / {len(matched)} 組")
    print(f"  momo 配對成功: {momo_matched_count} / {len(matched)} 組")
    print(f"=== 多平台配對完成 ===\n")

    return matched, rejected, review, price_review
