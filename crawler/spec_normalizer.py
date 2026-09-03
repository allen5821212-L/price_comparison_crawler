"""Conservative product-spec normalization shared by all platform matchers.

The matcher keeps this module dependency-free so critical guardrails can run
before any fuzzy string comparison and can be regression-tested independently.
"""

from __future__ import annotations

from dataclasses import dataclass
import re


MARKETING_TERMS = (
    "狂降", "限時下殺", "限時優惠", "限搭機", "搭機價", "裝機價", "含稅免運",
    "免運", "現貨", "保固內", "限量優惠", "熱賣", "特價", "促銷", "優惠",
    "破盤", "下殺", "出清", "福利品", "贈品", "送",
)
SIGNIFICANT_SUFFIXES = frozenset({"TI", "SUPER", "XT", "XTX", "OC", "NONOC"})

CORE_CHIP_PATTERNS = (
    r"(?<![A-Z0-9])(RTX\s*PRO\s*\d{4}|RTX\s*\d{3,4}|GTX\s*\d{3,4}|RX\s*\d{3,4}|ARC\s*[A-Z]\d{3,4})(?:\s*(?:TI|SUPER|XT|XTX))?(?![A-Z0-9])",
    r"(?<![A-Z0-9])(RYZEN\s*[3579]\s*\d{4,5}[A-Z0-9]*|R[3579]\s*\d{4,5}[A-Z0-9]*|CORE\s*(?:ULTRA\s*)?[3579]\s*\d{3,5}[A-Z0-9]*|I[3579][-\s]*\d{4,5}[A-Z0-9]*|ULTRA\s*[3579]\s*\d{3,5}[A-Z0-9]*)(?![A-Z0-9])",
    r"(?<![A-Z0-9])([ABXZH]\d{3,4}E?M?)(?![A-Z0-9])",
)

# 僅保留同時具備字母、數字且足以識別型號的代碼；通用規格不可當成 MPN。
MPN_EXCLUDED = frozenset({"DDR4", "DDR5", "PCIE4", "PCIE5", "PCIE6", "USB32", "WIFI6", "WIFI7", "WIN11", "W11"})


@dataclass(frozen=True)
class SpecFeatures:
    capacities: frozenset[str]
    power_watts: frozenset[str]
    suffixes: frozenset[str]
    memory_generations: frozenset[str]
    pcie_generations: frozenset[str]
    core_chips: frozenset[str]


def normalize_match_text(value: str | None) -> str:
    """Normalize before token and string-distance work without losing model data."""
    text = (value or "").upper().replace("－", "-").replace("／", "/")
    text = re.sub(r"\[([^\]]*)\]", r" \1 ", text)
    for term in MARKETING_TERMS:
        text = text.replace(term, " ")
    # 促銷標籤中的料號仍可能有價值，只清掉括號本身。
    text = text.replace("【", " ").replace("】", " ")
    text = re.sub(r"\bNON[\s-]*OC\b", "NONOC", text)
    text = re.sub(r"(\d)(TI|SUPER|XTX|XT)\b", r"\1 \2", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _canonical_capacity(number: str, unit: str) -> str:
    numeric = int(number.lstrip("0") or "0")
    if unit.upper().startswith("T"):
        return f"{numeric}T"
    # 同一通路偶爾以 1000GB 表示 1TB，先統一這種常見十進位寫法。
    if numeric >= 1000 and numeric % 1000 == 0:
        return f"{numeric // 1000}T"
    return f"{numeric}G"


def _compact_code(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def _canonical_core_chip(value: str) -> str:
    """Collapse vendor naming aliases while preserving the actual chip generation/model."""
    code = _compact_code(value)
    code = re.sub(r"^RYZEN", "R", code)
    code = re.sub(r"^COREULTRA", "ULTRA", code)
    code = re.sub(r"^COREI", "I", code)
    return code


def extract_mpn_codes(value: str | None) -> frozenset[str]:
    """Extract manufacturer/product-number style codes without generic interface noise."""
    text = normalize_match_text(value)
    matches = re.findall(
        r"(?<![A-Z0-9])(?:[A-Z]{1,4}\d[A-Z0-9.-]{3,}|\d{2,4}[A-Z][A-Z0-9.-]{2,})(?![A-Z0-9])",
        text,
    )
    return frozenset(code for raw in matches if (code := _compact_code(raw)) not in MPN_EXCLUDED)


def extract_spec_features(value: str | None) -> SpecFeatures:
    """Extract only high-signal specifications used for non-negotiable matching guardrails."""
    text = normalize_match_text(value)
    capacities = frozenset(
        _canonical_capacity(match.group(1), match.group(2))
        for match in re.finditer(r"(?<![A-Z0-9])(\d{1,4})\s*(GB|TB|G|T)(?![A-Z0-9])", text)
    )
    power_watts = frozenset(
        f"{int(match.group(1))}W"
        for match in re.finditer(r"(?<![A-Z0-9])(\d{2,4})\s*W(?![A-Z0-9])", text)
    )
    suffixes = frozenset(
        match.group(1)
        for match in re.finditer(r"(?<![A-Z0-9])(TI|SUPER|XTX|XT|NONOC|OC)(?![A-Z0-9])", text)
    )
    memory_generations = frozenset(
        f"DDR{match.group(1)}"
        for match in re.finditer(r"\bDDR\s*([45])\b", text)
    )
    pcie_generations = frozenset(
        f"PCIE{match.group(1)}"
        for match in re.finditer(r"\bPCI\s*E?\s*([45])(?:\.0)?\b", text)
    )
    core_chips = frozenset(
        _canonical_core_chip(match.group(1))
        for pattern in CORE_CHIP_PATTERNS
        for match in re.finditer(pattern, text)
    )
    return SpecFeatures(capacities, power_watts, suffixes, memory_generations, pcie_generations, core_chips)


def hard_spec_conflict(left: str | None, right: str | None) -> str | None:
    """Return the first conflict among capacity/power, chip, suffix and generation guardrails."""
    left_specs = extract_spec_features(left)
    right_specs = extract_spec_features(right)
    if left_specs.capacities and right_specs.capacities and left_specs.capacities != right_specs.capacities:
        return f"規格容量衝突: {sorted(left_specs.capacities)} vs {sorted(right_specs.capacities)}"
    if left_specs.power_watts and right_specs.power_watts and left_specs.power_watts != right_specs.power_watts:
        return f"功率規格衝突: {sorted(left_specs.power_watts)} vs {sorted(right_specs.power_watts)}"
    if left_specs.memory_generations and right_specs.memory_generations and left_specs.memory_generations != right_specs.memory_generations:
        return f"記憶體世代衝突: {sorted(left_specs.memory_generations)} vs {sorted(right_specs.memory_generations)}"
    if left_specs.pcie_generations and right_specs.pcie_generations and left_specs.pcie_generations != right_specs.pcie_generations:
        return f"PCIe 世代衝突: {sorted(left_specs.pcie_generations)} vs {sorted(right_specs.pcie_generations)}"
    if left_specs.core_chips and right_specs.core_chips and left_specs.core_chips != right_specs.core_chips:
        return f"核心晶片衝突: {sorted(left_specs.core_chips)} vs {sorted(right_specs.core_chips)}"
    if left_specs.suffixes != right_specs.suffixes and (left_specs.suffixes or right_specs.suffixes):
        return f"關鍵後綴衝突: {sorted(left_specs.suffixes)} vs {sorted(right_specs.suffixes)}"
    return None


def suffix_confidence_cap(left: str | None, right: str | None) -> tuple[float | None, str | None]:
    """Compatibility helper for callers that only need a confidence cap."""
    left_suffixes = extract_spec_features(left).suffixes
    right_suffixes = extract_spec_features(right).suffixes
    if left_suffixes == right_suffixes:
        return None, None
    if left_suffixes or right_suffixes:
        return 0.0, f"型號後綴不一致: {sorted(left_suffixes)} vs {sorted(right_suffixes)}"
    return None, None
