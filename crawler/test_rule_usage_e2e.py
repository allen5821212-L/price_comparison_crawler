import sys

import crawl


if __name__ == "__main__":
    rule_id = int(sys.argv[1])
    crawl.report_matching_rule_usage([rule_id])
    print("PASS: crawler usage report submitted")
