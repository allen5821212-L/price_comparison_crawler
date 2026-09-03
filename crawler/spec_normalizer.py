"""Hardware-spec extraction used before fuzzy product-name matching.

The matcher deliberately keeps this module dependency-free so the same hard
rules apply to every platform and can be regression-tested independently.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


MARKETING_TERMS = (
    "狂降", "限時下殺", "限時優惠", "含稅免運", "免運", "現貨", "保固內",
    "限量優惠", "熱賣", "特價", "破盤", "下殺", "贈品", "送",
)
SIGNIFICANT_SUFFIXES = frozenset({"TI", "SUPER", "XT", "XTX", "OC", "NONOC", "PLUS", "PRO", "MAX"})


@dataclass(frozen=True)
class SpecFeatures:
    capacities: frozenset[str]
    suffixes: frozenset[str]
    memory_generations: frozenset[str]
    pcie_generations: frozenset[str]


def normalize_match_text(value: str | None) -> str:
    """Normalize before token and string-distance work without losing model data."""
    text = (value or "").upper().replace("－", "-").replace("／", "/")
    text = re.sub(r"\[([^\]]*)\]", r" \1 ", text)

    for term in MARKETING_TERMS:
        text = text.replace(term, " ")
    text = re.sub(r"【[^】]*】", " ", text)
    text = re.sub(r"\bNON[\s-]*OC\b", "NONOC", text)
    text = re.sub(r"(\d)(TI|SUPER|XTX|XT)\b", r"\1 \2", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _canonical_capacity(number: str, unit: str) -> str:
    numeric = number.lstrip("0") or "0"
    return f"{numeric}{'T' if unit.upper().startswith('T') else 'G'}"


def extract_spec_features(value: str | None) -> SpecFeatures:
    """Extract only high-signal specifications used for matching guardrails."""
    text = normalize_match_text(value)
    capacities = frozenset(
        _canonical_capacity(match.group(1), match.group(2))
        for match in re.finditer(r"(?<![A-Z0-9])(\d{1,4})\s*(GB|TB|G|T)(?![A-Z0-9])", text)
    )
    suffixes = frozenset(
        match.group(1)
        for match in re.finditer(r"(?<![A-Z0-9])(TI|SUPER|XTX|XT|NONOC|OC|PLUS|PRO|MAX)(?![A-Z0-9])", text)
    )
    memory_generations = frozenset(
        f"DDR{match.group(1)}"
        for match in re.finditer(r"\bDDR\s*([45])\b", text)
    )
    pcie_generations = frozenset(
        f"PCIE{match.group(1)}"
        for match in re.finditer(r"\bPCI\s*E?\s*([45])(?:\.0)?\b", text)
    )
    return SpecFeatures(capacities, suffixes, memory_generations, pcie_generations)


def hard_spec_conflict(left: str | None, right: str | None) -> str | None:
    """Return a reason for non-negotiable capacity / generation conflicts."""
    left_specs = extract_spec_features(left)
    right_specs = extract_spec_features(right)
    if left_specs.capacities and right_specs.capacities and left_specs.capacities != right_specs.capacities:
        return f"規格容量衝突: {sorted(left_specs.capacities)} vs {sorted(right_specs.capacities)}"
    if left_specs.memory_generations and right_specs.memory_generations and left_specs.memory_generations != right_specs.memory_generations:
        return f"記憶體世代衝突: {sorted(left_specs.memory_generations)} vs {sorted(right_specs.memory_generations)}"
    if left_specs.pcie_generations and right_specs.pcie_generations and left_specs.pcie_generations != right_specs.pcie_generations:
        return f"PCIe 世代衝突: {sorted(left_specs.pcie_generations)} vs {sorted(right_specs.pcie_generations)}"
    return None


def suffix_confidence_cap(left: str | None, right: str | None) -> tuple[float | None, str | None]:
    """A suffix mismatch may remain reviewable, but can never become high confidence."""
    left_suffixes = extract_spec_features(left).suffixes
    right_suffixes = extract_spec_features(right).suffixes
    if left_suffixes == right_suffixes:
        return None, None
    if left_suffixes or right_suffixes:
        return 0.54, f"型號後綴不一致: {sorted(left_suffixes)} vs {sorted(right_suffixes)}"
    return None, None
