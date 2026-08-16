#!/usr/bin/env bash
set -euo pipefail

# The bracketed pattern deliberately avoids matching this script's own command
# line, unlike a literal `pgrep -f crawl.py` condition.
while pgrep -f '[c]rawl\.py' >/dev/null; do
  sleep 20
done

systemctl restart price-comparison-crawler-worker.service
