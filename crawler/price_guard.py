"""Price-sanity checks shared by crawler persistence and matching preparation."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any


MIN_VALID_PRICE = 10
MAX_VALID_PRICE = 99_999
MIN_ACCEPTABLE_RATIO = 0.4
MAX_ACCEPTABLE_RATIO = 2.5


@dataclass(frozen=True)
class PriceAssessment:
    is_suspect: bool
    reason: str | None


def assess_price(price: Any, previous_price: Any = None) -> PriceAssessment:
    """Flag placeholder and implausible one-day price movements without guessing a price."""
    try:
        value = int(price or 0)
    except (TypeError, ValueError):
        return PriceAssessment(True, "價格無法解析")
    if value <= MIN_VALID_PRICE:
        return PriceAssessment(True, f"價格低於或等於 NT${MIN_VALID_PRICE}")
    if value >= MAX_VALID_PRICE:
        return PriceAssessment(True, f"價格高於或等於 NT${MAX_VALID_PRICE:,}")
    try:
        prior = int(previous_price or 0)
    except (TypeError, ValueError):
        prior = 0
    if prior > MIN_VALID_PRICE:
        ratio = value / prior
        if ratio < MIN_ACCEPTABLE_RATIO:
            return PriceAssessment(True, f"單日跌幅超過 60%（{ratio:.2f}x）")
        if ratio > MAX_ACCEPTABLE_RATIO:
            return PriceAssessment(True, f"單日漲幅超過 150%（{ratio:.2f}x）")
    return PriceAssessment(False, None)


def state_fingerprint(product: dict[str, Any]) -> str:
    """Stable hash of the fields whose change warrants matching/history work."""
    state = {
        "name": str(product.get("name") or ""),
        "price": str(product.get("observed_price", product.get("price", 0)) or 0),
        "stock_status": str(product.get("stock_status") or ""),
        "promo_info": str(product.get("promo_info") or ""),
        "original_price": int(product.get("original_price") or 0),
    }
    encoded = json.dumps(state, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
