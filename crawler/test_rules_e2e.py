import sys

import crawl
from multi_matcher import apply_confirmed_rules


sinya_name, target_name = sys.argv[1], sys.argv[2]
rules = crawl.fetch_confirmed_matching_rules()
rule = next((item for item in rules if item.get("sinyaName") == sinya_name), None)
assert rule, "Expected a non-empty temporary rule from the application endpoint"

sinya = {"id": "s-e2e", "name": sinya_name, "price": 7000, "url": "", "image": "", "category": "MB 主機板"}
coolpc = {"id": "e2e-b850-g", "name": target_name, "price": 6800, "url": "", "image": "", "category": "主機板 MB"}
matched = []

applied, skipped = apply_confirmed_rules(
    matched, [sinya], [coolpc], [], [], [rule], {"coolpc"}
)

assert (applied, skipped) == (1, 0)
assert matched[0]["coolpc_name"] == target_name
assert matched[0]["manual_rule"] is True
print("PASS: crawler loaded and applied the non-empty exported rule")
