"""Apply bounded, evidence-based penalties from human-rejected mismatch features."""

from __future__ import annotations

import re
from typing import Any

from spec_normalizer import extract_spec_features, normalize_match_text


def observed_features(name: str) -> set[str]:
    text = normalize_match_text(name)
    specs = extract_spec_features(name)
    features = {f"capacity:{value}" for value in specs.capacities}
    features |= {f"ddr:{value.lower()}" for value in specs.memory_generations}
    features |= {f"pcie:{value.lower()}" for value in specs.pcie_generations}
    features |= {f"suffix:{value}" for value in specs.suffixes}
    if re.search(r"白(?:色)?|\bWHITE\b", text):
        features.add("color:white")
    if re.search(r"黑(?:色)?|\bBLACK\b", text):
        features.add("color:black")
    if re.search(r"灰(?:色)?|\b(?:GRAY|GREY)\b", text):
        features.add("color:gray")
    if re.search(r"無\s*(?:WI-?FI|WIFI)|\bNO\s*-?\s*WI-?FI\b", text):
        features.add("wifi:no-wifi")
    elif re.search(r"\bWI-?FI(?:\s*[67])?\b", text):
        features.add("wifi:wifi")
    return features


def build_negative_penalty_lookup(records: list[dict[str, Any]] | None) -> dict[tuple[str, str, str], float]:
    lookup: dict[tuple[str, str, str], float] = {}
    for record in records or []:
        platform = str(record.get("platform") or "")
        source_feature = str(record.get("sourceFeature") or record.get("source_feature") or "")
        target_feature = str(record.get("targetFeature") or record.get("target_feature") or "")
        try:
            penalty = max(0.0, min(0.36, float(record.get("penalty") or 0)))
        except (TypeError, ValueError):
            penalty = 0.0
        if platform and source_feature and target_feature and penalty:
            lookup[(platform, source_feature, target_feature)] = penalty
    return lookup


def negative_penalty(source_name: str, target_name: str, platform: str, lookup: dict[tuple[str, str, str], float] | None) -> float:
    if not lookup:
        return 0.0
    source_features = observed_features(source_name)
    target_features = observed_features(target_name)
    penalties = [
        weight for (rule_platform, source_feature, target_feature), weight in lookup.items()
        if rule_platform == platform and source_feature in source_features and target_feature in target_features
    ]
    return min(0.36, sum(penalties))
