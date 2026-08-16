import os

os.environ["MATCHING_RULES_URL"] = "http://127.0.0.1:3000/api/matching-rules"

import crawl


if __name__ == "__main__":
    rules = crawl.fetch_confirmed_matching_rules()
    assert isinstance(rules, list)
    print(f"PASS: crawler read {len(rules)} active rules from API")
