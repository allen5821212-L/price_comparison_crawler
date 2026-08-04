#!/usr/bin/env python3
"""
商品配對引擎 — 依照「商品配對規則規格書 v2」實作
流程：清洗 → 正規化 → 建索引 → 計分 → 硬否決 → 取最高分 → 後處理
"""

import re
from difflib import SequenceMatcher

# ════════════════════════════════════════════════════════════
#  品牌對照表 (R1)
# ════════════════════════════════════════════════════════════

BRAND_MAP = {
    "MSI": "微星", "ASUS": "華碩", "GIGABYTE": "技嘉", "AORUS": "技嘉",
    "ZOTAC": "索泰", "LEADTEK": "麗臺", "SAMSUNG": "三星",
    "CRUCIAL": "美光", "MICRON": "美光", "KINGSTON": "金士頓",
    "ADATA": "威剛", "XPG": "威剛", "GSKILL": "芝奇", "G.SKILL": "芝奇",
    "CORSAIR": "海盜船", "ANACOMDA": "巨蟒", "AGI": "亞奇雷",
    "TEAM": "十銓", "LIANLI": "聯力", "COOLERMASTER": "酷碼",
    "THERMALTAKE": "曜越", "FSP": "全漢", "SEASONIC": "海韻",
    "SUPERFLOWER": "振華", "MONTECH": "君主", "NOCTUA": "貓頭鷹",
    "THERMALRIGHT": "利民", "LOGITECH": "羅技", "RAZER": "雷蛇",
    "BENQ": "明基", "PHILIPS": "飛利浦", "LG": "樂金", "AOC": "AOC",
    "ACER": "宏碁", "DELL": "戴爾", "HP": "惠普",
    "LENOVO": "聯想", "THINKPAD": "聯想", "INTEL": "英特爾", "AMD": "AMD",
    "SEAGATE": "希捷", "WD": "威騰", "SAPPHIRE": "藍寶",
    "POWERCOLOR": "撼訊", "ASROCK": "華擎",
    "INNO3D": "映眾", "PNY": "PNY", "EVGA": "EVGA",
    "KIOXIA": "鎧俠", "TRANSCEND": "創見", "VIEWSONIC": "優派",
    "ANTEC": "安鈦克", "DEEPCOOL": "九州風神", "JONSBO": "JONSBO",
    "ENERMAX": "保銳", "NZXT": "NZXT", "PHANTEKS": "追風者",
    "SILVERSTONE": "銀欣", "BITFENIX": "BitFenix",
    "ARCTIC": "ARCTIC", "SCYTHE": "鐮刀",
    "BE QUIET": "be quiet", "BEQUIET": "be quiet",
    "DARKFLASH": "darkFlash", "AULA": "狼蛛",
    "EDIFIER": "漫步者", "JBL": "JBL",
    "APPLE": "蘋果", "SONY": "索尼",
    "NVIDIA": "NVIDIA",
    "HYNIX": "海力士", "SOLIDIGM": "Solidigm",
    "KINGSTON": "金士頓", "FURY": "金士頓",
    "COLORFUL": "七彩虹", "GALAX": "嘉軒",
    "BIOSTAR": "映泰", "COLORFUL": "七彩虹",
    "ZALMAN": "扎爾曼", "COUGAR": "美洲獅",
    "FSP": "全漢", "GIGABYTE": "技嘉",
    "TOUGHRAM": "曜越", "T-FORCE": "十銓",
    "DELTA": "台達", "DELTA ELECTRONICS": "台達",
}

# Build reverse lookup: for each canonical brand, list all aliases
BRAND_ALIASES = {}  # alias_upper → canonical_name
for eng, chn in BRAND_MAP.items():
    BRAND_ALIASES[eng.upper()] = chn
    BRAND_ALIASES[chn.upper()] = chn
# Extra aliases not in BRAND_MAP
EXTRA_ALIASES = {
    "酷冷至尊": "酷碼", "COOLER MASTER": "酷碼", "酷冷": "酷碼",
    "貓頭鹰": "貓頭鷹", "銀欣科技": "銀欣",
    "保銳科技": "保銳", "分形工藝": "NZXT",
    "九州": "九州風神", "威寶": "WD",
    "東芝": "鎧俠", "TOSHIBA": "鎧俠",
    "宏碲": "宏碁",
    "樂金": "LG",
    "藍寶": "藍寶",
}
for alias, canonical in EXTRA_ALIASES.items():
    BRAND_ALIASES[alias.upper()] = canonical


def extract_brands(name):
    """Extract all brand identifiers from a product name. Returns set of canonical brand names."""
    name_u = name.upper()
    found = set()
    for alias, canonical in BRAND_ALIASES.items():
        if alias in name_u:
            found.add(canonical)
    return found


# ════════════════════════════════════════════════════════════
#  正規化 (步驟 2)
# ════════════════════════════════════════════════════════════

def norm(s):
    """正規化商品名稱 — 統一寫法差異。"""
    s = (s or "").upper()
    # 型號寫法統一
    s = re.sub(r'(\d)\s+(TI|SUPER|XT|XTX)\b', r'\1\2', s)       # 5070 Ti → 5070TI
    s = re.sub(r'\bRYZEN\s*([3579])\b', r'R\1', s)               # Ryzen 7 → R7
    s = re.sub(r'\bCORE\s*I([3579])\b', r'I\1', s)              # Core i7 → I7
    s = re.sub(r'\bCORE\s*ULTRA\s*([3579])\b', r'ULTRA\1', s)    # Core Ultra 7 → ULTRA7
    # 容量單位統一（不可用 \b，中文字元會使詞邊界失效）
    s = re.sub(r'(\d)\s*GB(?![A-Z0-9])', r'\1G', s)              # 16GB → 16G
    s = re.sub(r'(\d)\s*TB(?![A-Z0-9])', r'\1T', s)             # 2TB → 2T
    return s


def head(nm):
    """品名主體：去除【】促銷標籤，截掉第一個 / 〈 ( （ 之後的規格描述。"""
    s = re.sub(r'【[^】]*】', ' ', nm or '')
    s = re.split(r'[/〈(（]', s)[0]
    return norm(s).strip()


# ════════════════════════════════════════════════════════════
#  清洗規則 (步驟 1)
# ════════════════════════════════════════════════════════════

# 組合包 / 贈品 / 福利品等不可比價品項
COMBO_PATTERNS = re.compile(
    r'買[一二三四五六\d]送[一二三四五六\d]'
    r'|共[一二三四五六\d]個'
    r'|套裝搭購|組合套餐|組合|合購|搭購|加購|任選|同捆|超值組|優惠組'
    r'|[~～][^~～]{0,12}加送|加送[^,，]{0,10}'
    r'|贈品|第[二三四五2-5]件'
    r'|福利品|拆封|展示機|整新|二手|預購|客訂'
    r'|\s[+＋]\s'
)

# 整機關鍵詞
SYSTEM_KEYWORDS = re.compile(
    r'大全配|全配|整機|準系統|欣亞PC|套裝電腦|套裝主機'
    r'|玩具總動員|仁者無敵|魅力無窮|裝機價|酷！PC|酷!PC'
)

# 零組件類別詞（用於 R6 整機偵測）
COMPONENT_KEYWORDS = [
    '主機板', '顯卡', '顯示卡', '電源', '水冷', '記憶體',
    'SSD', '機殼', 'CPU', '處理器', 'RAM', 'VGA',
    'HDD', '硬碟', '散熱器', '風扇',
]


def is_excluded(name):
    """判斷是否為不可比價品項（贈品/福利品/二手品）。
    只過濾不可比價品項，不過濾組合包（由 R7 規則處理）。
    """
    if not name:
        return True
    # 箱損/外箱受損是全新品，只是外箱有瑕疵，應保留
    if re.search(r'箱損|外箱受損|外箱損', name):
        return False
    if re.search(r'贈品|福利品|拆封|展示機|整新|二手|預購|客訂', name):
        return True
    return False


def is_combo(name):
    """判斷是否為組合包/搭購品（用於 R7 規則）。"""
    if not name:
        return False
    # 擴充：CPU+MB 組合包（U版專案、限省、現省等）
    if re.search(r'U版專案|限省\d|現省\d|【.*\+.*】|【搭機價】|【任搭CPU】|【CPU獨家', name):
        return True
    # 偵測 CPU+MB 組合：品名同時含 CPU 型號與主機板晶片組
    cpu_pattern = re.search(r'(R[3579]\s*\d{4}|I[3579]\s*\d{4,5}|ULTRA[3579]\s*\d{3,4}|RYZEN\s*\d|CORE\s*I?\d|CORE\s*ULTRA\s*\d)', name, re.IGNORECASE)
    mb_pattern = re.search(r'\b([ABH]\d{3}[A-Z]*)', name)
    if cpu_pattern and mb_pattern and '+' in name:
        return True
    return bool(COMBO_PATTERNS.search(name))


def is_system(name):
    """判斷是否為整機/套裝電腦。"""
    if not name:
        return False
    if SYSTEM_KEYWORDS.search(name):
        return True
    # 機殼品名不可能是整機（即使規格描述中提到電源/風扇等）
    if '機殼' in name or '機箱' in name:
        return False
    # 3 種以上零組件類別 → 整機
    count = sum(1 for kw in COMPONENT_KEYWORDS if kw in name.upper())
    return count >= 3


# ════════════════════════════════════════════════════════════
#  Token 提取 (用於倒排索引與計分)
# ════════════════════════════════════════════════════════════

# 通用規格詞（排除）
GENERIC_TOKENS = {
    "ATX", "ITX", "MATX", "EATX", "RGB", "ARGB", "USB", "HDMI",
    "DP", "VGA", "DVI", "TYPEC", "TYPEC30", "TYPEC40",
    "DDR4", "DDR5", "GDDR5", "GDDR6", "GDDR7",
    "PCIE", "PCIE30", "PCIE40", "PCIE50", "PCIE60",
    "NVME", "SATA", "SATA3", "M2", "M2SSD",
    "FREESYNC", "GSYNC", "ADAPTIVE",
    "HDR400", "HDR500", "HDR600", "HDR700", "HDR800", "HDR900", "HDR1000",
    "HDMI20", "HDMI21", "HDMI11",
    "DP12", "DP14", "DP20", "DP21",
    "USB20", "USB30", "USB31", "USB32",
    "WIFI", "WIFI6", "WIFI7", "BLUETOOTH", "BT50",
    "ELITE", "TG", "MESH", "LCD", "OLED", "IPS", "VA", "TN",
    "TUF", "ROG", "PRIME", "PRO", "AORUS", "AORUS",
    "GAMING", "EAGLE", "AERO", "STEALTH",
    "BLACK", "WHITE", "RED", "BLUE", "GREEN", "GRAY", "GREY",
    "SLIM", "LITE", "PLUS", "MAX", "ULTRA", "SUPER",
    "OC", "OCX", "STORM", "FROST", "BLAZE",
}


def extract_tokens(name):
    """從品名中提取 token（英數混合、長度≥3），另加容量與3位以上數字型號。
    另外加入特殊型號正規化 token（GPU/CPU/MB/RAM/SSD）以提升核心零組件覆蓋率。
    """
    n = norm(name)
    # 去除【】標籤
    n = re.sub(r'【[^】]*】', ' ', n)
    # 截掉規格描述尾部
    n = re.split(r'[/〈(【]', n)[0]
    n = n.replace('-', ' ').replace('.', ' ')
    
    tokens = set()
    
    # 英數混合 token (長度 ≥ 3)
    for m in re.finditer(r'[A-Z0-9]{3,}', n):
        tok = m.group(0)
        if tok in GENERIC_TOKENS:
            continue
        tokens.add(tok)
    
    # 容量 token: NG, NT (e.g. 16G, 2T)
    for m in re.finditer(r'(\d+)G\b', n):
        tok = m.group(0)
        if len(tok) >= 2:
            tokens.add(tok)
    for m in re.finditer(r'(\d+)T\b', n):
        tok = m.group(0)
        if len(tok) >= 2:
            tokens.add(tok)
    
    # 3 位以上純數字型號
    for m in re.finditer(r'\b(\d{3,})\b', n):
        tok = m.group(1)
        tokens.add(tok)
    
    # ── 特殊型號正規化 token ──
    # GPU: RTX5070TI, RX9060XT, etc. (preserve XT/TI/SUPER suffix)
    for m in re.finditer(r'RTX\s*(\d{3,4}[A-Z]*)', n):
        tokens.add('RTX' + m.group(1).replace(' ', ''))
    for m in re.finditer(r'GTX\s*(\d{3,4}[A-Z]*)', n):
        tokens.add('GTX' + m.group(1).replace(' ', ''))
    for m in re.finditer(r'\bRX\s*(\d{4}[A-Z]*)', n):
        tokens.add('RX' + m.group(1).replace(' ', ''))
    for m in re.finditer(r'\bARC\s*A(\d{3})', n):
        tokens.add('ARCA' + m.group(1))
    for m in re.finditer(r'RTX\s*PRO\s*(\d{4})', n):
        tokens.add('RTXPRO' + m.group(1))
    
    # CPU: R79800X3D, I714700K, ULTRA7265K, etc.
    cpu_n = n
    cpu_n = re.sub(r'\bRYZEN\s*(\d)\b', r'R\1', cpu_n)
    cpu_n = re.sub(r'\bCORE\s*I(\d)\b', r'I\1', cpu_n)
    cpu_n = re.sub(r'\bCORE\s*ULTRA\s*(\d)\b', r'ULTRA\1', cpu_n)
    for m in re.finditer(r'\bR(\d)\s*(\d{4}[A-Z0-9]*)', cpu_n):
        tokens.add('R' + m.group(1) + m.group(2))
    for m in re.finditer(r'\bI(\d)\s*(\d{4,5}[A-Z]*)', cpu_n):
        tokens.add('I' + m.group(1) + m.group(2))
    for m in re.finditer(r'\bULTRA(\d)\s*(\d{3,4}[A-Z]*)', cpu_n):
        tokens.add('ULTRA' + m.group(1) + m.group(2))
    for m in re.finditer(r'\bIU(\d{3,4}[A-Z]*)', cpu_n):
        tokens.add('IU' + m.group(1))
    
    # MB: B850MPLUS, Z890S, etc.
    for m in re.finditer(r'\b([ABH])(\d{3})M?\s?([A-Z0-9]*)', n):
        chipset = m.group(1) + m.group(2)
        suffix = (m.group(3) or '').replace(' ', '')
        if suffix and len(suffix) >= 2:
            tokens.add(chipset + suffix)
        else:
            tokens.add(chipset)
    
    # RAM: D56000_32G (speed + capacity)
    ram_cap = ''
    for m in re.finditer(r'(\d+)G\s*(?:DDR|D5|D4|\*\d|雙通|四通)', n):
        ram_cap = m.group(1) + 'G'
    if not ram_cap:
        for m in re.finditer(r'DDR\s*5\s*\d{4}\s*(\d+)G\b', n):
            ram_cap = m.group(1) + 'G'
    if not ram_cap:
        for m in re.finditer(r'DDR\s*4\s*\d{4}\s*(\d+)G\b', n):
            ram_cap = m.group(1) + 'G'
    if not ram_cap:
        for m in re.finditer(r'\bD5\s*\d{4}\s*(\d+)G\b', n):
            ram_cap = m.group(1) + 'G'
    if not ram_cap:
        for m in re.finditer(r'\bD4\s*\d{4}\s*(\d+)G\b', n):
            ram_cap = m.group(1) + 'G'
    if not ram_cap:
        for m in re.finditer(r'(\d+)G\s*\(\d+G\s*\*\s*\d+\)', n):
            ram_cap = m.group(1) + 'G'
    ram_speed = ''
    for m in re.finditer(r'DDR?\s*5\s*(\d{4})', n):
        ram_speed = 'D5' + m.group(1)
    if not ram_speed:
        for m in re.finditer(r'DDR?\s*4\s*(\d{4})', n):
            ram_speed = 'D4' + m.group(1)
    if not ram_speed:
        for m in re.finditer(r'\bD5\s*(\d{4})', n):
            ram_speed = 'D5' + m.group(1)
    if not ram_speed:
        for m in re.finditer(r'\bD4\s*(\d{4})', n):
            ram_speed = 'D4' + m.group(1)
    if ram_speed and ram_cap:
        tokens.add(ram_speed + '_' + ram_cap)
    
    # SSD model + capacity
    storage_cap = ''
    for m in re.finditer(r'(\d+)\s*TB\b', n):
        storage_cap = m.group(1) + 'T'
    if not storage_cap:
        for m in re.finditer(r'(\d+)\s*GB\s*(?:SSD|M\.2|PCIe|GEN|/|SATA)', n):
            storage_cap = m.group(1) + 'G'
    if storage_cap == '512G': storage_cap = '500G'
    if storage_cap == '960G': storage_cap = '1T'
    if storage_cap == '256G': storage_cap = '250G'
    if storage_cap == '128G': storage_cap = '120G'
    for m in re.finditer(r'\b(990|970|980|9100|870|860|850|950|T700|T500|T300|T705|MP700|MP600|MP500|NM790|NM770|NM760|T60|TI600|TIPLUS|990EVOP|990EVO|990PRO|BX500|A400|SU650|SU800|S330|S270|SA510|RE100|EXCERIA|VULCAN|SPATIUM|CYBER|FURY|NS100|NS200|S70|S50|S40|ST)\s*([A-Z]*)', n):
        tok = m.group(1) + m.group(2)
        if storage_cap:
            tok += '_' + storage_cap
        tokens.add(tok)
    
    # ── 機殼系列名稱 token ──
    # 常見機殼系列：GT502, Y70, RM400, DS900, O11, 4000D, 5000D 等
    for m in re.finditer(r'\b(GT\d{3,4}|Y\d{2,3}|RM\d{3,4}|DS\d{3,4}|O11|O\d{4}[A-Z]?|\d{4}[A-Z]|HELIOS|PANORAMA|SILENT|SERUM|LANCOOL|LANCOOL\d|AIR\d{2,3}|FOCUS\d?|SHELF|TOWER\d{0,2}|COMPASS|EDGE|CINE|VIEW|H6\d?|H5\d?|H7\d?)', n):
        tok = m.group(1).replace(' ', '')
        if len(tok) >= 3:
            tokens.add(tok)
    # 機殼品牌+系列（如 HYTE Y70, darkFlash DS900, 銀欣 RM400）
    for m in re.finditer(r'\b(GT\d{3})\s*([A-Z]*)', n):
        tok = m.group(1) + (m.group(2) or '')
        if len(tok) >= 4:
            tokens.add(tok)
    
    # ── 筆電系列名稱 token ──
    # 常見筆電系列：GAMING A16, CYBORG 15, KATANA 15, NITRO V, VICTUS, TUF GAMING 等
    for m in re.finditer(r'\b(GAMING\s*[AX]\d{2}|CYBORG\s*\d{2}|KATANA\s*\d{2}|NITRO\s*[V\d]|VICTUS\s*\d{2}|CREATOR\s*\d{2}|AERO\s*[AX]\d{2}|SWIFT\s*\d|RAIDER\s*\d|VECTOR\s*\d|STEALTH\s*\d{2}|PULSE\s*\d{2}|BRAVO\s*\d{2}|CYBORG|KATANA|NITRO|VICTUS|CREATOR|RAIDER|VECTOR|STEALTH|PULSE|BRAVO|ALLY|ODYSSEY|PROART|ZENBOOK|VIVOBOOK|EXPERTBOOK|GRAM|TUF\s*GAMING|ROG\s*STRIX|ROG\s*ZEPHYRUS|ROG\s*SCAR|LEGION|IDEAPAD|THINKBOOK|SWIFT|ASPIRE|ENVOY|SPECTRE|ELITEBOOK|PROBOOK|SURFACE|IPHONE)', n):
        tok = m.group(1).replace(' ', '')
        if len(tok) >= 4:
            tokens.add(tok)
    # 筆電型號代碼（如 B14WFK, B2RWFKG, V3607VJ, ANV16S 等）
    for m in re.finditer(r'\b([A-Z]\d{3,4}[A-Z]{2,4})\b', n):
        tok = m.group(1)
        if len(tok) >= 5:
            tokens.add(tok)
    
    return tokens


# ════════════════════════════════════════════════════════════
#  硬否決規則 (步驟 5) — R1 ~ R7
# ════════════════════════════════════════════════════════════

# R3/R4 通用規格詞（排除）
GENERIC_CODE = {
    "ATX", "ITX", "MATX", "EATX", "RGB", "ARGB", "USB", "HDMI",
    "DP", "VGA", "DVI", "TYPEC", "DDR4", "DDR5", "GDDR5", "GDDR6", "GDDR7",
    "PCIE", "NVME", "SATA", "M2", "FREESYNC", "GSYNC", "HDR",
    "WIFI", "BT", "OC", "PRO", "MAX", "PLUS", "LITE", "SLIM",
    "TUF", "ROG", "GAMING", "AORUS", "EAGLE", "AERO", "PRIME",
    "BLACK", "WHITE", "RED", "BLUE", "GREEN", "GRAY", "GREY",
    "TG", "MESH", "LCD", "OLED", "IPS", "VA", "TN",
    "ELITE", "STEALTH", "STORM", "FROST", "BLAZE",
    "ACE", "ULTRA", "SUPER", "TI", "XT", "XTX",
}

# R4 型號後綴修飾詞（排除）
SUFFIX_EXCLUDE = {
    "TG", "MESH", "ELITE", "ARGB", "LCD", "OC", "PRO", "MAX",
    "PLUS", "LITE", "SLIM", "ULTRA", "SUPER", "TI", "XT", "XTX",
    "ACE", "GAMING", "TUF", "ROG", "AORUS", "EAGLE", "AERO",
    "PRIME", "STEALTH", "STORM", "FROST", "BLAZE",
    "BLACK", "WHITE", "RED", "BLUE", "GREEN", "GRAY", "GREY",
    "V2", "V3", "V4", "V5", "II", "III", "IV",
}

# 顏色詞
COLOR_MAP = {
    "WHITE": "白", "BLACK": "黑", "RED": "紅", "BLUE": "藍",
    "GREEN": "綠", "GRAY": "灰", "GREY": "灰", "PURPLE": "紫",
    "PINK": "粉", "SILVER": "銀", "GOLD": "金",
    "白": "白", "黑": "黑", "紅": "紅", "藍": "藍",
    "綠": "綠", "灰": "灰", "紫": "紫", "粉": "粉",
    "銀": "銀", "金": "金", "煙燻灰": "灰", "透明": "透明",
    "櫻花": "粉", "樱花": "粉",
}


def extract_colors(name):
    """抽出顏色詞，統一為中文。"""
    n = norm(name)
    colors = set()
    for eng, chn in COLOR_MAP.items():
        if eng in n:
            colors.add(chn)
    return colors


def extract_numeric_patterns(name):
    """抽出數字型態模式。返回 {pattern: set(values)}。
    e.g. "Elite 600 16G" → {"#": {"600"}, "#G": {"16G"}}
    """
    n = norm(name)
    n = re.sub(r'【[^】]*】', ' ', n)
    n = re.split(r'[/〈(【]', n)[0]
    n = n.replace('-', ' ')
    
    patterns = {}
    
    # 容量型態 NG, NT（不可用 \b，中文字元會使詞邊界失效）
    for m in re.finditer(r'(\d+)G(?![A-Z0-9])', n):
        patterns.setdefault('#G', set()).add(m.group(0))
    for m in re.finditer(r'(\d+)T(?![A-Z0-9])', n):
        patterns.setdefault('#T', set()).add(m.group(0))
    
    # 純數字型號 (3位以上)
    for m in re.finditer(r'\b(\d{3,})\b', n):
        patterns.setdefault('#', set()).add(m.group(1))
    
    return patterns


def extract_model_codes(name):
    """抽出含字母又含數字的代碼（排除通用規格詞）。
    匹配任何 3+ 字元的 token 中同時含字母和數字者。
    """
    n = norm(name)
    n = re.sub(r'【[^】]*】', ' ', n)
    n = re.split(r'[/〈(【]', n)[0]
    n = n.replace('-', ' ').replace('.', ' ')
    
    codes = set()
    # 匹配任何 3+ 字元的英數混合 token（同時含字母和數字）
    for m in re.finditer(r'\b([A-Z0-9]{3,})\b', n):
        code = m.group(1)
        if code in GENERIC_CODE:
            continue
        # 必須同時含字母和數字
        has_letter = any(c.isalpha() for c in code)
        has_digit = any(c.isdigit() for c in code)
        if has_letter and has_digit:
            codes.add(code)
    return codes


def extract_suffixes(name):
    """抽出 2-4 個字元的代號（排除通用詞、修飾詞、容量/瓦數）。
    包含純字母和英數混合的短代號（如 e7, S001, GX, GF）。
    """
    n = norm(name)
    n = re.sub(r'【[^】]*】', ' ', n)
    n = re.split(r'[/〈(【]', n)[0]
    n = n.replace('-', ' ').replace('.', ' ')
    
    # 先移除容量和瓦數 token，避免它們被當成後綴
    n_cleaned = re.sub(r'\b\d+G\b', ' ', n)   # 16G, 32G
    n_cleaned = re.sub(r'\b\d+T\b', ' ', n_cleaned)  # 1T, 2T
    n_cleaned = re.sub(r'\b\d+W\b', ' ', n_cleaned)  # 750W, 1000W
    
    suffixes = set()
    # 2-4 字元的英數混合 token
    for m in re.finditer(r'\b([A-Z0-9]{2,4})\b', n_cleaned):
        suf = m.group(1)
        if suf in SUFFIX_EXCLUDE:
            continue
        if suf in GENERIC_CODE:
            continue
        # 純數字不算代號
        if suf.isdigit():
            continue
        suffixes.add(suf)
    return suffixes


def veto(name1, name2):
    """執行 7 條硬否決規則。返回 (vetoed: bool, reason: str)。"""
    
    # R1. 品牌衝突（RAM 例外：同規格不同品牌可配對）
    brands1 = extract_brands(name1)
    brands2 = extract_brands(name2)
    if brands1 and brands2:
        if not (brands1 & brands2):
            # RAM 例外：如果雙方都有 DDR 速度+容量 token 且完全一致，允許跨品牌配對
            tokens1 = extract_tokens(name1)
            tokens2 = extract_tokens(name2)
            ram_tokens1 = {t for t in tokens1 if t.startswith('D4') or t.startswith('D5')}
            ram_tokens2 = {t for t in tokens2 if t.startswith('D4') or t.startswith('D5')}
            if ram_tokens1 and ram_tokens2 and ram_tokens1 == ram_tokens2:
                pass  # 允許跨品牌 RAM 配對
            else:
                return True, f"R1品牌衝突: {brands1} vs {brands2}"
    
    # R2. 數字型號衝突
    p1 = extract_numeric_patterns(name1)
    p2 = extract_numeric_patterns(name2)
    for pat, vals1 in p1.items():
        if pat in p2:
            vals2 = p2[pat]
            if vals1 and vals2 and not (vals1 & vals2):
                # 例外：純數字模式 (#) 忽略個位數
                if pat == '#':
                    big1 = {v for v in vals1 if len(v) >= 3}
                    big2 = {v for v in vals2 if len(v) >= 3}
                    if big1 and big2 and not (big1 & big2):
                        return True, f"R2數字型號衝突: {pat} {big1} vs {big2}"
                else:
                    return True, f"R2數字型號衝突: {pat} {vals1} vs {vals2}"
    
    # R3. 型號代碼衝突（筆電例外：長型號代碼 vs CPU 代碼不衝突）
    codes1 = extract_model_codes(name1)
    codes2 = extract_model_codes(name2)
    if codes1 and codes2:
        if not (codes1 & codes2):
            # 筆電例外：如果一方只有長型號代碼（5+字元），另一方只有 CPU 代碼（如 14700HX, 240H），不衝突
            long_codes1 = {c for c in codes1 if len(c) >= 5}
            long_codes2 = {c for c in codes2 if len(c) >= 5}
            cpu_codes1 = {c for c in codes1 if re.match(r'^(I\d{4,5}|R\d{4}|ULTRA\d{3,4}|\d{3,4}HX|\d{3,4}H)$', c)}
            cpu_codes2 = {c for c in codes2 if re.match(r'^(I\d{4,5}|R\d{4}|ULTRA\d{3,4}|\d{3,4}HX|\d{3,4}H)$', c)}
            if (long_codes1 and cpu_codes2 and not long_codes2) or (long_codes2 and cpu_codes1 and not long_codes1):
                pass  # 筆電型號 vs CPU 代碼，不衝突
            else:
                return True, f"R3型號代碼衝突: {codes1} vs {codes2}"
    
    # R4. 型號後綴衝突
    suf1 = extract_suffixes(name1)
    suf2 = extract_suffixes(name2)
    if suf1 and suf2:
        if not (suf1 & suf2):
            return True, f"R4型號後綴衝突: {suf1} vs {suf2}"
    
    # R5. 顏色衝突（兩邊都有顏色且無交集才否決）
    col1 = extract_colors(name1)
    col2 = extract_colors(name2)
    if col1 and col2:
        if not (col1 & col2):
            return True, f"R5顏色衝突: {col1} vs {col2}"
    
    # R6. 整機 vs 單品
    sys1 = is_system(name1)
    sys2 = is_system(name2)
    if sys1 != sys2:
        return True, f"R6整機vs單品: sys1={sys1} sys2={sys2}"
    
    # R7. 組合 vs 單品
    combo1 = is_combo(name1)
    combo2 = is_combo(name2)
    if combo1 != combo2:
        return True, f"R7組合vs單品: combo1={combo1} combo2={combo2}"
    
    return False, ""


# ════════════════════════════════════════════════════════════
#  計分 (步驟 4)
# ════════════════════════════════════════════════════════════

def string_similarity(a, b):
    """字串相似度 (0~1)。"""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def compute_score(name1, name2):
    """計算配對分數。返回 (score, details)。"""
    tokens1 = extract_tokens(name1)
    tokens2 = extract_tokens(name2)
    
    if not tokens1 or not tokens2:
        return 0.0, {"overlap": 0, "rHead": 0, "rFull": 0}
    
    overlap = len(tokens1 & tokens2) / min(len(tokens1), len(tokens2))
    rHead = string_similarity(head(name1), head(name2))
    rFull = string_similarity(norm(name1), norm(name2))
    
    # RAM 例外：同規格不同品牌配對時，head 相似度因品牌不同而被壓低
    # 如果雙方有完全一致的 DDR 速度+容量 token，將 head 提升至 max(rHead, 0.80)
    ram_tokens1 = {t for t in tokens1 if t.startswith('D4') or t.startswith('D5')}
    ram_tokens2 = {t for t in tokens2 if t.startswith('D4') or t.startswith('D5')}
    if ram_tokens1 and ram_tokens2 and ram_tokens1 == ram_tokens2:
        rHead = max(rHead, 0.80)
    
    score = 0.45 * overlap + 0.40 * rHead + 0.15 * rFull
    return score, {"overlap": overlap, "rHead": rHead, "rFull": rFull}


# ════════════════════════════════════════════════════════════
#  倒排索引 (步驟 3)
# ════════════════════════════════════════════════════════════

def build_inverted_index(products):
    """用 token 建倒排索引。返回 {token: [index, ...]}。"""
    index = {}
    for i, p in enumerate(products):
        tokens = extract_tokens(p["name"])
        for tok in tokens:
            index.setdefault(tok, []).append(i)
    return index


# ════════════════════════════════════════════════════════════
#  主配對函式
# ════════════════════════════════════════════════════════════

MATCH_THRESHOLD = 0.75
REVIEW_THRESHOLD = 0.58


def match_products_v2(sinya_products, coolpc_products, category_compat=None):
    """
    依照規格書 v2 的完整配對流程。
    
    Returns:
        matched: list of matched pairs
        rejected: list of rejected pairs with reasons (for review)
        review: list of borderline pairs (score >= 0.58 but < 0.75)
    """
    print("=== 商品配對開始 (v2 規格書) ===")
    matched = []
    rejected = []
    review = []
    sinya_matched = set()
    coolpc_matched = set()
    
    # ── 步驟 1: 清洗 ──
    sinya_valid = {}
    for i, p in enumerate(sinya_products):
        if p.get("price", 0) == 0 or not p.get("name"):
            continue
        if is_excluded(p["name"]):
            continue
        sinya_valid[i] = p
    
    coolpc_valid = {}
    for i, p in enumerate(coolpc_products):
        if p.get("price", 0) == 0 or not p.get("name"):
            continue
        if is_excluded(p["name"]):
            continue
        coolpc_valid[i] = p
    
    print(f"  清洗後有效商品: 欣亞 {len(sinya_valid)} / 原價屋 {len(coolpc_valid)}")
    
    # ── 步驟 2: 正規化 (在 extract_tokens / head / norm 中完成) ──
    
    # ── 步驟 3: 建倒排索引 ──
    coolpc_index = build_inverted_index(
        [coolpc_valid[i] for i in sorted(coolpc_valid.keys())]
    )
    # Map back from positional index to original index
    coolpc_sorted_keys = sorted(coolpc_valid.keys())
    coolpc_pos_to_orig = {pos: orig for pos, orig in enumerate(coolpc_sorted_keys)}
    
    sinya_index = build_inverted_index(
        [sinya_valid[i] for i in sorted(sinya_valid.keys())]
    )
    sinya_sorted_keys = sorted(sinya_valid.keys())
    sinya_pos_to_orig = {pos: orig for pos, orig in enumerate(sinya_sorted_keys)}
    
    # ── 步驟 4-6: 逐一計分 → 硬否決 → 取最高分 ──
    # For each Sinya product, find best CoolPC candidate via inverted index
    for si_orig in sorted(sinya_valid.keys()):
        if si_orig in sinya_matched:
            continue
        
        sp = sinya_products[si_orig]
        sinya_tokens = extract_tokens(sp["name"])
        
        # Gather candidates from inverted index (products sharing at least one token)
        candidate_positions = set()
        for tok in sinya_tokens:
            if tok in coolpc_index:
                candidate_positions.update(coolpc_index[tok])
        
        if not candidate_positions:
            continue
        
        best_score = -1
        best_ci = -1
        best_details = {}
        vetoed_candidates = []
        
        for ci_pos in candidate_positions:
            ci_orig = coolpc_pos_to_orig[ci_pos]
            if ci_orig in coolpc_matched:
                continue
            
            cp = coolpc_products[ci_orig]
            
            # Category compatibility check
            if category_compat:
                cat_s = sp.get("category", "")
                cat_c = cp.get("category", "")
                if cat_s and cat_c and cat_s != cat_c:
                    if (cat_s, cat_c) not in category_compat and (cat_c, cat_s) not in category_compat:
                        continue
            
            # 步驟 5: 硬否決
            is_vetoed, reason = veto(sp["name"], cp["name"])
            if is_vetoed:
                vetoed_candidates.append((ci_orig, reason, 0))
                continue
            
            # 步驟 4: 計分
            score, details = compute_score(sp["name"], cp["name"])
            
            if score > best_score:
                best_score = score
                best_ci = ci_orig
                best_details = details
        
        # 步驟 6: 門檻判定
        if best_ci >= 0 and best_score >= MATCH_THRESHOLD:
            cp = coolpc_products[best_ci]
            price_diff = sp["price"] - cp["price"]
            cheaper = "sinya" if sp["price"] < cp["price"] else ("coolpc" if cp["price"] < sp["price"] else "tie")
            
            matched.append({
                "name": sp["name"],
                "sinya_name": sp["name"],
                "coolpc_name": cp["name"],
                "sinya_price": sp["price"],
                "coolpc_price": cp["price"],
                "price_diff": price_diff,
                "cheaper": cheaper,
                "sinya_url": sp.get("url", ""),
                "coolpc_url": cp.get("url", ""),
                "sinya_image": sp.get("image", ""),
                "coolpc_image": cp.get("image", ""),
                "category": sp.get("category") or cp.get("category", ""),
                "score": round(best_score, 4),
            })
            sinya_matched.add(si_orig)
            coolpc_matched.add(best_ci)
        elif best_ci >= 0 and best_score >= REVIEW_THRESHOLD:
            # Borderline — put in review list
            cp = coolpc_products[best_ci]
            review.append({
                "sinya_name": sp["name"],
                "coolpc_name": cp["name"],
                "sinya_price": sp["price"],
                "coolpc_price": cp["price"],
                "score": round(best_score, 4),
                "reason": "分數介於 0.58-0.75",
            })
        
        # Record vetoed candidates for audit
        for ci_orig, reason, score in vetoed_candidates:
            cp = coolpc_products[ci_orig]
            rejected.append({
                "sinya_name": sp["name"],
                "coolpc_name": cp["name"],
                "reason": reason,
                "score": 0,
            })
    
    # ── 步驟 7: 後處理 ──
    # 7a. 價差合理性
    price_review = []
    final_matched = []
    for m in matched:
        if m["sinya_price"] > 0 and m["coolpc_price"] > 0:
            ratio = max(m["sinya_price"], m["coolpc_price"]) / min(m["sinya_price"], m["coolpc_price"])
            if ratio > 3.0:
                price_review.append({**m, "reason": f"價差過大({ratio:.1f}x)"})
                continue
        final_matched.append(m)
    
    # 7c. 去重 (同一組合合併)
    seen_pairs = set()
    deduped = []
    for m in final_matched:
        key = (m["sinya_name"], m["coolpc_name"])
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        deduped.append(m)
    
    print(f"  配對成功: {len(deduped)} 組")
    print(f"  複核清單 (否決): {len(rejected)} 筆")
    print(f"  複核清單 (邊界): {len(review)} 筆")
    print(f"  複核清單 (價差): {len(price_review)} 筆")
    print(f"  欣亞未比對: {len(sinya_valid) - len(sinya_matched)} 件")
    print(f"  原價屋未比對: {len(coolpc_valid) - len(coolpc_matched)} 件")
    print(f"=== 商品配對完成 ===\n")
    
    return deduped, rejected, review, price_review
