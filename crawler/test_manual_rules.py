from multi_matcher import apply_confirmed_rules


def product(product_id, name, price, **extra):
    return {"id": product_id, "name": name, "price": price, "url": "", "image": "", **extra}


def test_pchome_rule_overrides_auto_target():
    sinya = product("s1", "ASUS ROG STRIX B850-G", 6990, category="MB 主機板")
    coolpc = product("c1", "ROG STRIX B850-G", 7090)
    pchome = product("p1", "ROG STRIX B850-G WIFI", 6790)
    matched = [{
        "name": sinya["name"], "sinya_name": sinya["name"], "coolpc_name": coolpc["name"],
        "sinya_price": 6990, "coolpc_price": 7090, "price_diff": -100,
        "pchome_name": "舊自動配對", "pchome_price": 9999, "momo_price": 0,
    }]

    applied, skipped = apply_confirmed_rules(
        matched, [sinya], [coolpc], [pchome], [],
        [{"sinyaName": sinya["name"], "targetName": pchome["name"], "targetId": "pchome_p1", "platform": "pchome"}],
        {"pchome"},
    )

    assert (applied, skipped) == (1, 0)
    assert matched[0]["pchome_name"] == pchome["name"]
    assert matched[0]["pchome_price"] == 6790
    assert matched[0]["cheaper"] == "pchome"
    assert matched[0]["manual_rule"] is True


def test_coolpc_rule_adds_unmatched_source_row():
    sinya = product("s2", "ASUS PRIME B850M-A", 3990, category="MB 主機板")
    coolpc = product("c2", "PRIME B850M-A WIFI", 3890, category="主機板 MB")
    matched = []

    applied, skipped = apply_confirmed_rules(
        matched, [sinya], [coolpc], [], [],
        [{"sinyaName": sinya["name"], "targetName": coolpc["name"], "targetId": "coolpc_c2", "platform": "coolpc"}],
        {"coolpc"},
    )

    assert (applied, skipped) == (1, 0)
    assert matched[0]["coolpc_name"] == coolpc["name"]
    assert matched[0]["coolpc_price"] == 3890
    assert matched[0]["score"] == 1.0


def test_rule_alias_handles_unique_title_changes_without_cross_model_match():
    sinya = product("s3", "華碩 TUF GAMING B850-G WIFI 新包裝", 6590, category="MB 主機板")
    coolpc = product("c3", "ASUS TUF B850-G WIFI 主機板", 6490, category="主機板 MB")
    matched = []

    applied, skipped = apply_confirmed_rules(
        matched, [sinya], [coolpc], [], [],
        [{
            "sinyaName": "舊品名 B850-G", "targetName": "舊目標 B850-G",
            "sourceAlias": "B850-G", "targetAlias": "B850-G", "platform": "coolpc",
        }],
        {"coolpc"},
    )

    assert (applied, skipped) == (1, 0)
    assert matched[0]["sinya_name"] == sinya["name"]
    assert matched[0]["coolpc_name"] == coolpc["name"]


if __name__ == "__main__":
    test_pchome_rule_overrides_auto_target()
    test_coolpc_rule_adds_unmatched_source_row()
    test_rule_alias_handles_unique_title_changes_without_cross_model_match()
    print("PASS: manual rule feedback tests")
