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
    # 筆電系列名稱正規化
    s = re.sub(r'IDEAPAD\s*SLIM\s*', 'IDEAPAD ', s)               # IdeaPad Slim 3 → IdeaPad 3
    s = re.sub(r'YOGA\s*SLIM\s*', 'YOGA ', s)                   # Yoga Slim 7 → Yoga 7
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


# 筆電組合包標籤
LAPTOP_COMBO_TAGS = re.compile(
    r'【雙營組】|【雙螢組】|【職人辦公組】|【Office超值組】|【抗漲升級組】|【全能防護組】'
    r'|【學生專案組】|【開學配備組】|【防疫辦公組】|【商務辦公組】'
)


def extract_bare_laptop(name):
    """從筆電組合包品名中剝離附加品，取出裸機筆電品名。
    
    例如：
      【雙營組】LG gram 16Z90TL-G.AS55C2 曜石黑 極致輕薄AI筆電+LG UltraGear 27G610A-B ...
      → LG gram 16Z90TL-G.AS55C2 曜石黑 極致輕薄AI筆電
      
      【Office超值組】ASUS V16 V3607VJ-0031K210H 靜謐黑 華碩蒼藍戰魂效能筆電+Office 2024 ...
      → ASUS V16 V3607VJ-0031K210H 靜謐黑 華碩蒼藍戰魂效能筆電
    
    如果不是組合包，返回 None。
    """
    if not name:
        return None
    # 只處理筆電組合包
    if not LAPTOP_COMBO_TAGS.search(name):
        return None
    # 去除【】標籤
    bare = re.sub(r'【[^】]*】', '', name).strip()
    # 取 + 之前的部分（裸機）
    if '+' in bare:
        bare = bare.split('+')[0].strip()
    # 去除尾部「送」之後的附加品描述
    bare = re.split(r'送[^,，]{0,20}$', bare)[0].strip()
    # 確保裸機品名中包含「筆電」關鍵詞
    if '筆電' not in bare:
        return None
    return bare


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
    for m in re.finditer(r'\b(GAMING\s*[AX]\d{2}|CYBORG\s*\d{2}|KATANA\s*\d{2}|NITRO\s*[V\d]|VICTUS\s*\d{2}|CREATOR\s*\d{2}|AERO\s*[AX]\d{2}|SWIFT\s*\d|RAIDER\s*\d|VECTOR\s*\d|STEALTH\s*\d{2}|PULSE\s*\d{2}|BRAVO\s*\d{2}|CYBORG|KATANA|NITRO|VICTUS|CREATOR|RAIDER|VECTOR|STEALTH|PULSE|BRAVO|ALLY|ODYSSEY|PROART|ZENBOOK|VIVOBOOK|EXPERTBOOK|GRAM|TUF\s*GAMING|ROG\s*STRIX|ROG\s*ZEPHYRUS|ROG\s*SCAR|LEGION|IDEAPAD|THINKBOOK|SWIFT|ASPIRE|ENVOY|SPECTRE|ELITEBOOK|PROBOOK|SURFACE|IPHONE|OMNIBOOK|ZBOOK|LOQ|YOGA|THINKPAD|PROBOOK|FIREFLY|FURY|OMEN|HYPERX)', n):
        tok = m.group(1).replace(' ', '')
        if len(tok) >= 4:
            tokens.add(tok)
    # 筆電型號代碼（如 B14WFK, B2RWFKG, V3607VJ, ANV16S, 16Z90TS 等）
    # 從完整品名（split 前）中提取，因為型號代碼常在 / 之後
    n_full = re.sub(r'【[^】]*】', ' ', norm(name))
    # 字母開頭的型號代碼（如 B14WFK, AU89C2, FA617NT, FX607VU, G614PR, GU606AM）
    # 支援 1-2 字母前綴 + 3-4 數字 + 0-4 字母後綴
    for m in re.finditer(r'\b([A-Z]{1,2}\d{3,4}[A-Z]{0,4})\b', n_full):
        tok = m.group(1)
        if len(tok) >= 5:
            tokens.add(tok)
    # 數字開頭的型號代碼（如 16Z90TS, 27UP600K）
    for m in re.finditer(r'\b(\d{2,4}[A-Z]\d{2,4}[A-Z]{2,4})\b', n_full):
        tok = m.group(1)
        if len(tok) >= 5:
            tokens.add(tok)
    # 也提取 - 分隔的型號代碼（如 B14WFK-884TW）
    for m in re.finditer(r'\b([A-Z]\d{2,4}[A-Z]{2,4})-(\d{3,4}[A-Z]{0,2})\b', n_full):
        tokens.add(m.group(1))
        tokens.add(m.group(1) + m.group(2))
    # 提取含點的型號代碼（如 16Z90TS-G.AU89C2 → 16Z90TS, AU89C2）
    for m in re.finditer(r'\b(\d{2,4}[A-Z]\d{2,4}[A-Z]{2,4})[.-]([A-Z]\d{2,4}[A-Z]{2,4})\b', n_full):
        tokens.add(m.group(1))
        tokens.add(m.group(2))
    # 提取 GIGABYTE 長型號代碼（10+ 字元英數混合，如 CTHH3TW893SH, 6YJM5TWE64SH）
    for m in re.finditer(r'\b([A-Z0-9]{10,})\b', n_full):
        tok = m.group(1)
        # 排除純數字和通用規格詞
        if not tok.isdigit() and tok not in GENERIC_CODE:
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
    # 品牌名不應被當成後綴
    "MSI", "ASUS", "AOC", "HP", "LG", "JBL", "PNY", "EVGA",
    # 筆電系列名/CPU 後綴不應被當成後綴
    "CORE", "HX", "H", "U", "P", "HS", "KF", "K", "F",
    # 筆電型號前綴
    "ANV", "AN", "NL", "SFL", "SFG", "SFE", "SFA", "AL", "AM", "ASP",
    # ASUS 筆電系列代號（A14/A16/A18=TUF AMD, F16/F17=TUF Intel）
    "A14", "A16", "A18", "F16", "F17", "F18",
    # CPU 短別名（R5/R7/R9/I5/I7/I9）不應被當成後綴
    "R5", "R7", "R9", "I5", "I7", "I9",
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
    # 筆電型號代碼常在 / 之後，需要從完整品名中提取
    n_full = n.replace('-', ' ').replace('.', ' ')
    n = re.split(r'[/〈(【]', n)[0]
    n = n.replace('-', ' ').replace('.', ' ')
    
    codes = set()
    # 從 split 前的品名中提取所有 3+ 字元的英數混合 token
    for m in re.finditer(r'\b([A-Z0-9]{3,})\b', n_full):
        code = m.group(1)
        if code in GENERIC_CODE:
            continue
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
    
    # R3. 型號代型號代碼衝突（筆電例外：長型號代碼 vs CPU 代碼不衝突）
    codes1 = extract_model_codes(name1)
    codes2 = extract_model_codes(name2)
    if codes1 and codes2:
        # HP ZBook 子系列區分：FURY/FIREFLY vs ZBook 8/X/POWER 是不同產品線
        all_t1 = extract_tokens(name1)
        all_t2 = extract_tokens(name2)
        zbook_sub1 = {t for t in all_t1 if t in {'FURY', 'FIREFLY'}}
        zbook_sub2 = {t for t in all_t2 if t in {'FURY', 'FIREFLY'}}
        if bool(zbook_sub1) != bool(zbook_sub2):
            return True, f"R3型號代碼衝突(ZBook子系列): {zbook_sub1} vs {zbook_sub2}"
        # 即使有共同代碼，如果雙方有不同的筆電型號後綴代碼（如 288TW vs 884TW），仍應衝突
        laptop_suffix1 = {c for c in codes1 if re.match(r'^\d{2,4}TW$', c)}
        laptop_suffix2 = {c for c in codes2 if re.match(r'^\d{2,4}TW$', c)}
        if laptop_suffix1 and laptop_suffix2 and not (laptop_suffix1 & laptop_suffix2):
            return True, f"R3型號代碼衝突: {codes1} vs {codes2}"
        # 筆電系列數字後綴衝突（如 KATANA17 vs KATANA15）
        all_tokens1 = extract_tokens(name1)
        all_tokens2 = extract_tokens(name2)
        series_num1 = {t for t in all_tokens1 if re.match(r'^(KATANA|CYBORG|GAMING|VICTUS|NITRO|SWIFT|ASPIRE|PULSE|BRAVO|STEALTH|RAIDER|VECTOR|CREATOR)\d+$', t)}
        series_num2 = {t for t in all_tokens2 if re.match(r'^(KATANA|CYBORG|GAMING|VICTUS|NITRO|SWIFT|ASPIRE|PULSE|BRAVO|STEALTH|RAIDER|VECTOR|CREATOR)\d+$', t)}
        if series_num1 and series_num2 and not (series_num1 & series_num2):
            return True, f"R3型號代碼衝突(系列不同): {series_num1} vs {series_num2}"
        # 筆電型號代碼含螢幕尺寸衝突（如 SFL16 vs SFL14, ANV15 vs ANV16）
        size_code1 = {c for c in codes1 if re.match(r'^[A-Z]{2,4}\d{2}$', c) and c not in codes2}
        size_code2 = {c for c in codes2 if re.match(r'^[A-Z]{2,4}\d{2}$', c) and c not in codes1}
        if size_code1 and size_code2 and not (size_code1 & size_code2):
            # 提取型號代碼中的數字部分（如 SFL16 -> 16, ANV15 -> 15）
            nums1 = {re.search(r'(\d+)$', c).group(1) for c in size_code1}
            nums2 = {re.search(r'(\d+)$', c).group(1) for c in size_code2}
            if nums1 and nums2 and not (nums1 & nums2):
                return True, f"R3型號代碼碼衝突(螢幕尺寸): {size_code1} vs {size_code2}"
        # 筆電 CPU 規格例外：如果雙方有共同的筆電系列 token，
        # 且不同的短代碼都是 CPU 代碼（如 255H vs 255U, 13620H vs 1315U），不衝突
        LAPTOP_SERIES_SET = {'KATANA', 'KATANA15', 'KATANA17', 'CYBORG', 'CYBORG15', 'GAMINGA16', 'AEROX16', 'NITRO', 'VICTUS', 'SWIFT', 'ASPIRE', 'GRAM', 'ZENBOOK', 'LOQ', 'IDEAPAD', 'YOGA', 'THINKPAD', 'THINKBOOK', 'OMNIBOOK', 'ZBOOK', 'ELITEBOOK', 'PROBOOK', 'SPECTRE', 'ENVOY', 'OMEN', 'FIREFLY', 'FURY', 'LEGION', 'EXPERTBOOK', 'TRAVELMATE', 'TOUGHBOOK'}
        lt_series1 = {t for t in extract_tokens(name1) if t in LAPTOP_SERIES_SET}
        lt_series2 = {t for t in extract_tokens(name2) if t in LAPTOP_SERIES_SET}
        is_laptop_pair = bool(lt_series1 and lt_series2 and (lt_series1 & lt_series2))
        # CPU 代碼模式：I7-13620H, R7-255H, Ultra7-255U, 13620H, 255H, 255U 等
        CPU_CODE_RE = r'^(I\d{4,5}[A-Z]?|R\d{4}[A-Z]?|ULTRA\d{3,4}[A-Z]?|\d{4,5}[A-Z]{1,2}|\d{3,4}[A-Z])$'
        # 如果有共同代碼，但雙方有不同的子型號代碼（如 32P vs 52M），仍應衝突
        # 檢查短代碼（2-4字元字母+數字）是否有完全不同的子型號
        sub1 = {c for c in codes1 if re.match(r'^([A-Z]{1,2}\d{1,3}[A-Z]?|\d{2,3}[A-Z])$', c) and c not in codes2}
        sub2 = {c for c in codes2 if re.match(r'^([A-Z]{1,2}\d{1,3}[A-Z]?|\d{2,3}[A-Z])$', c) and c not in codes1}
        if sub1 and sub2 and not (sub1 & sub2):
            # 確保這些是子型號而非規格（排除 N150, W11 等已知規格代碼）
            real_sub1 = {c for c in sub1 if c not in {'N150', 'W11', 'W10', 'W12'}}
            real_sub2 = {c for c in sub2 if c not in {'N150', 'W11', 'W10', 'W12'}}
            if real_sub1 and real_sub2:
                # 筆電 CPU 規格例外：如果雙方都是 CPU 代碼且同系列筆電，不衝突
                if is_laptop_pair and all(re.match(CPU_CODE_RE, c) for c in real_sub1) and all(re.match(CPU_CODE_RE, c) for c in real_sub2):
                    pass  # 同系列筆電不同 CPU 規格，允許配對
                else:
                    return True, f"R3型號代碼衝突: {codes1} vs {codes2}"
        if not (codes1 & codes2):
            # 筆電例外：如果一方只有長型號代碼（5+字元），另一方只有 CPU 代碼（如 14700HX, 240H），不衝突
            long_codes1 = {c for c in codes1 if len(c) >= 5}
            long_codes2 = {c for c in codes2 if len(c) >= 5}
            cpu_codes1 = {c for c in codes1 if re.match(r'^(I\d{4,5}|R\d{4}|ULTRA\d{3,4}|\d{3,4}HX|\d{3,4}H)$', c)}
            cpu_codes2 = {c for c in codes2 if re.match(r'^(I\d{4,5}|R\d{4}|ULTRA\d{3,4}|\d{3,4}HX|\d{3,4}H)$', c)}
            if (long_codes1 and cpu_codes2 and not long_codes2) or (long_codes2 and cpu_codes1 and not long_codes1):
                pass  # 筆電型號 vs CPU 代碼，不衝突
            # 筆電裸機例外：如果雙方都有長型號代碼但不同（如 B14WFK vs 14700HX），
            # 但雙方都有相同的筆電系列 token（KATANA/CYBORG/GAMINGA16 等），不衝突
            elif long_codes1 and long_codes2:
                laptop_series1 = {t for t in extract_tokens(name1) if t in {'KATANA', 'KATANA15', 'KATANA17', 'CYBORG', 'CYBORG15', 'GAMINGA16', 'AEROX16', 'NITRO', 'VICTUS', 'SWIFT', 'ASPIRE', 'GRAM', 'ZENBOOK', 'LOQ', 'IDEAPAD', 'YOGA', 'THINKPAD', 'THINKBOOK', 'OMNIBOOK', 'ZBOOK', 'ELITEBOOK', 'PROBOOK', 'SPECTRE', 'ENVOY', 'OMEN', 'FIREFLY', 'FURY', 'LEGION'}}
                laptop_series2 = {t for t in extract_tokens(name2) if t in {'KATANA', 'KATANA15', 'KATANA17', 'CYBORG', 'CYBORG15', 'GAMINGA16', 'AEROX16', 'NITRO', 'VICTUS', 'SWIFT', 'ASPIRE', 'GRAM', 'ZENBOOK', 'LOQ', 'IDEAPAD', 'YOGA', 'THINKPAD', 'THINKBOOK', 'OMNIBOOK', 'ZBOOK', 'ELITEBOOK', 'PROBOOK', 'SPECTRE', 'ENVOY', 'OMEN', 'FIREFLY', 'FURY', 'LEGION'}}
                if laptop_series1 and laptop_series2 and (laptop_series1 & laptop_series2):
                    # HP ZBook 子系列區分：FURY vs 8 vs X vs POWER 是不同產品線
                    zbook_sub1 = {t for t in laptop_series1 if t in {'FURY', 'FIREFLY'}}
                    zbook_sub2 = {t for t in laptop_series2 if t in {'FURY', 'FIREFLY'}}
                    if bool(zbook_sub1) != bool(zbook_sub2):
                        return True, f"R3型號代碼衝突(ZBook子系列): {zbook_sub1} vs {zbook_sub2}"
                    # 同系列筆電，但型號代碼中的數字後綴不同（如 288TW vs 884TW）仍應衝突
                    # 只有不含數字的長型號代碼（如 B14WFK）相同時才允許
                    # 檢查是否有含數字的長代碼不同
                    digit_codes1 = {c for c in long_codes1 if re.search(r'\d', c) and c not in long_codes2}
                    digit_codes2 = {c for c in long_codes2 if re.search(r'\d', c) and c not in long_codes1}
                    if digit_codes1 and digit_codes2:
                        return True, f"R3型號代碼衝突: {codes1} vs {codes2}"
                    # 檢查筆電系列中的數字後綴是否不同（如 KATANA17 vs KATANA15）
                    series_num1 = {t for t in laptop_series1 if re.search(r'\d+$', t)}
                    series_num2 = {t for t in laptop_series2 if re.search(r'\d+$', t)}
                    if series_num1 and series_num2 and not (series_num1 & series_num2):
                        return True, f"R3型號代碼衝突(系列不同): {series_num1} vs {series_num2}"
                    pass  # 同系列筆電，型號代碼不含數字部分相同，不衝突
                # 筆電型號代碼例外：如果雙方有共同的 5+ 字元筆電型號代碼（如 16Z90TS），
                # 即使其他代碼不同（如 AU89C2 vs 258V），也不衝突
                elif long_codes1 & long_codes2:
                    pass  # 有共同的長型號代碼，不衝突
                else:
                    return True, f"R3型號代碼衝突: {codes1} vs {codes2}"
            else:
                return True, f"R3型號代碼衝突: {codes1} vs {codes2}"
    
    # R4. 型號後綴衝突
    suf1 = extract_suffixes(name1)
    suf2 = extract_suffixes(name2)
    if suf1 and suf2:
        if not (suf1 & suf2):
            return True, f"R4型號後綴衝突: {suf1} vs {suf2}"
    
    # R5. 顏色衝突（兩邊都有顏色且無交集才否決）
    # 筆電例外：筆電顏色命名不一致（如「黑」vs「灰」），不視為衝突
    col1 = extract_colors(name1)
    col2 = extract_colors(name2)
    if col1 and col2:
        if not (col1 & col2):
            # 筆電例外：如果雙方都有筆電系列 token，顏色不衝突
            lt1 = {t for t in extract_tokens(name1) if t in {'KATANA', 'KATANA15', 'KATANA17', 'CYBORG', 'CYBORG15', 'GAMINGA16', 'AEROX16', 'NITRO', 'VICTUS', 'SWIFT', 'ASPIRE', 'GRAM', 'ZENBOOK', 'LOQ', 'IDEAPAD', 'YOGA', 'THINKPAD', 'THINKBOOK', 'OMNIBOOK', 'ZBOOK', 'ELITEBOOK', 'PROBOOK', 'SPECTRE', 'ENVOY', 'OMEN', 'FIREFLY', 'FURY', 'LEGION'}}
            lt2 = {t for t in extract_tokens(name2) if t in {'KATANA', 'KATANA15', 'KATANA17', 'CYBORG', 'CYBORG15', 'GAMINGA16', 'AEROX16', 'NITRO', 'VICTUS', 'SWIFT', 'ASPIRE', 'GRAM', 'ZENBOOK', 'LOQ', 'IDEAPAD', 'YOGA', 'THINKPAD', 'THINKBOOK', 'OMNIBOOK', 'ZBOOK', 'ELITEBOOK', 'PROBOOK', 'SPECTRE', 'ENVOY', 'OMEN', 'FIREFLY', 'FURY', 'LEGION'}}
            if lt1 and lt2 and (lt1 & lt2):
                pass  # 同系列筆電，顏色不一致不衝突
            else:
                return True, f"R5顏色衝突: {col1} vs {col2}"
    
    # R6. 整機 vs 單品
    sys1 = is_system(name1)
    sys2 = is_system(name2)
    if sys1 != sys2:
        return True, f"R6整機vs單品: sys1={sys1} sys2={sys2}"
    
    # R7. 組合 vs 單品
    # 筆電裸機例外：如果一方是筆電組合包，另一方是裸機筆電，
    # 且裸機品名能從組合包中剝離出來，則不視為組合 vs 單品衝突
    bare1 = extract_bare_laptop(name1)
    bare2 = extract_bare_laptop(name2)
    combo1 = is_combo(name1)
    combo2 = is_combo(name2)
    if combo1 != combo2:
        # 如果組合包方可以剝離出裸機品名，且裸機品名與另一方有 token 重疊，允許配對
        if (bare1 and not combo2) or (bare2 and not combo1):
            pass  # 筆電裸機比對，允許
        else:
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
    
    # 筆電裸機例外：如果雙方有相同的筆電系列 token，提升 overlap 和 head
    laptop_series = {'KATANA', 'KATANA15', 'KATANA17', 'CYBORG', 'CYBORG15', 
                     'GAMINGA16', 'AEROX16', 'NITRO', 'VICTUS', 'SWIFT', 
                     'ASPIRE', 'GRAM', 'ZENBOOK', 'CREATOR', 'RAIDER', 
                     'VECTOR', 'STEALTH', 'PULSE', 'BRAVO', 'LEGION',
                     'LOQ', 'IDEAPAD', 'YOGA', 'THINKPAD', 'THINKBOOK',
                     'OMNIBOOK', 'ZBOOK', 'ELITEBOOK', 'PROBOOK', 'SPECTRE',
                     'ENVOY', 'OMEN', 'FIREFLY', 'FURY'}
    laptop_tokens1 = tokens1 & laptop_series
    laptop_tokens2 = tokens2 & laptop_series
    if laptop_tokens1 and laptop_tokens2 and (laptop_tokens1 & laptop_tokens2):
        # 筆電系列匹配：提升 overlap 至至少 0.50，head 至至少 0.60
        overlap = max(overlap, 0.50)
        rHead = max(rHead, 0.60)
        # 商務筆電系列（ZBook/EliteBook/ProBook/ThinkPad/OmniBook）：同系列即強信號
        biz_series = {'ZBOOK', 'ELITEBOOK', 'PROBOOK', 'THINKPAD', 'THINKBOOK', 'OMNIBOOK', 'SPECTRE', 'FIREFLY', 'FURY'}
        biz1 = laptop_tokens1 & biz_series
        biz2 = laptop_tokens2 & biz_series
        if biz1 and biz2 and (biz1 & biz2):
            overlap = max(overlap, 0.65)
            rHead = max(rHead, 0.70)
    
    # 筆電型號代碼匹配：如果雙方有相同的 5+ 字元筆電型號代碼（如 B14WFK, FA617NT, G614PR），
    # 這是極強的信號，直接提升分數
    laptop_code_pattern = re.compile(r'^[A-Z]{1,2}\d{3,4}[A-Z]{0,4}$')
    code_tokens1 = {t for t in tokens1 if laptop_code_pattern.match(t) and len(t) >= 5}
    code_tokens2 = {t for t in tokens2 if laptop_code_pattern.match(t) and len(t) >= 5}
    if code_tokens1 and code_tokens2 and (code_tokens1 & code_tokens2):
        overlap = max(overlap, 0.85)
        rHead = max(rHead, 0.85)
    
    # GIGABYTE 筆電型號代碼模糊匹配：
    # GIGABYTE 使用 12 字元型號代碼（如 CTHH3TW893SH），欣亞和原價屋可能末 1-3 碼不同
    # 如果雙方都有 10+ 字元的型號代碼，且前 8 碼相同，視為匹配
    long_code_pattern = re.compile(r'^[A-Z0-9]{10,}$')
    long_codes1 = {t for t in tokens1 if long_code_pattern.match(t) and len(t) >= 10}
    long_codes2 = {t for t in tokens2 if long_code_pattern.match(t) and len(t) >= 10}
    if long_codes1 and long_codes2:
        # 檢查前 8 碼是否相同
        matched = False
        for c1 in long_codes1:
            for c2 in long_codes2:
                if len(c1) >= 8 and len(c2) >= 8 and c1[:8] == c2[:8]:
                    matched = True
                    break
            if matched:
                break
        if matched:
            overlap = max(overlap, 0.80)
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


def compute_spec_diff(name1, name2):
    """計算兩個品名之間的規格差異，返回差異描述列表。"""
    diffs = []
    
    # CPU 規格差異
    cpu1 = re.search(r'(?:Ultra\s*\d|Core\s*Ultra\s*\d|Core\s*i\d|Ryzen\s*\d|R\d|I\d)[\s-]*(\d{3,5}[A-Z]{0,2})', name1, re.IGNORECASE)
    cpu2 = re.search(r'(?:Ultra\s*\d|Core\s*Ultra\s*\d|Core\s*i\d|Ryzen\s*\d|R\d|I\d)[\s-]*(\d{3,5}[A-Z]{0,2})', name2, re.IGNORECASE)
    if cpu1 and cpu2 and cpu1.group(1).upper() != cpu2.group(1).upper():
        diffs.append(f"CPU: {cpu1.group(1)} vs {cpu2.group(1)}")
    
    # RAM 容量差異（只匹配 1-128G 範圍，排除 SSD 容量和 GPU VRAM）
    # 排除：1) 數字 >128（SSD/HDD 容量）2) 前面是 RTX/GTX/RX（GPU VRAM）
    def _extract_ram(name):
        for m in re.finditer(r'(?:/|\s)(\d{1,3})G(?:B)?(?:\s|$|/|D[DR])', name):
            val = int(m.group(1))
            if val > 128:
                continue  # SSD/HDD capacity, not RAM
            # Check if preceded by GPU model name
            start = max(0, m.start() - 10)
            prefix = name[start:m.start()]
            if re.search(r'(RTX|GTX|RX)\s*\d{3,4}\s*$', prefix, re.IGNORECASE):
                continue  # GPU VRAM, not system RAM
            return m.group(1)
        return None
    ram1 = _extract_ram(name1)
    ram2 = _extract_ram(name2)
    if ram1 and ram2 and ram1 != ram2:
        diffs.append(f"RAM: {ram1}G vs {ram2}G")
    
    # SSD 容量差異（只匹配 /NNNT 或 /NNNTB 格式）
    ssd1 = re.search(r'(?:/|\s)(\d{1,3})T(?:B)?(?:\s|$|/)', name1, re.IGNORECASE)
    ssd2 = re.search(r'(?:/|\s)(\d{1,3})T(?:B)?(?:\s|$|/)', name2, re.IGNORECASE)
    if ssd1 and ssd2 and ssd1.group(1) != ssd2.group(1):
        diffs.append(f"SSD: {ssd1.group(1)}T vs {ssd2.group(1)}T")
    
    # GPU 差異
    gpu1 = re.search(r'(RTX|GTX|RX)\s*(\d{3,4})', name1, re.IGNORECASE)
    gpu2 = re.search(r'(RTX|GTX|RX)\s*(\d{3,4})', name2, re.IGNORECASE)
    if gpu1 and gpu2:
        g1 = f"{gpu1.group(1).upper()}{gpu1.group(2)}"
        g2 = f"{gpu2.group(1).upper()}{gpu2.group(2)}"
        if g1 != g2:
            diffs.append(f"GPU: {g1} vs {g2}")
    
    # 螢幕尺寸差異
    size1 = re.search(r'(\d+(?:\.\d)?)\s*吋', name1)
    size2 = re.search(r'(\d+(?:\.\d)?)\s*吋', name2)
    if size1 and size2 and size1.group(1) != size2.group(1):
        diffs.append(f"螢幕: {size1.group(1)}吋 vs {size2.group(1)}吋")
    
    return diffs


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
        sinya_name = sp["name"]
        
        # 筆電裸機比對：如果品名是筆電組合包，使用剝離後的裸機品名進行比對
        bare_name = extract_bare_laptop(sinya_name)
        match_name = bare_name if bare_name else sinya_name
        
        sinya_tokens = extract_tokens(match_name)
        
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
            
            # 步驟 5: 硬否決（使用裸機品名比對）
            is_vetoed, reason = veto(match_name, cp["name"])
            if is_vetoed:
                vetoed_candidates.append((ci_orig, reason, 0))
                continue
            
            # 步驟 4: 計分（使用裸機品名比對）
            score, details = compute_score(match_name, cp["name"])
            
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
                "is_bare_match": bool(bare_name),
                "spec_diff": compute_spec_diff(sinya_name, cp["name"]),
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
    
    # ── 步驟 6b: 第二輪 — 升級版/組合包變體配對 ──
    # 32G升級版等變體品名與基礎版相同型號代碼，但基礎版已配走 CoolPC 商品。
    # 允許升級版配對同一 CoolPC 商品（一對多），因為它們是同一型號的不同容量版本。
    for si_orig in sorted(sinya_valid.keys()):
        if si_orig in sinya_matched:
            continue
        sp = sinya_products[si_orig]
        sinya_name = sp["name"]
        
        # 只處理升級版/組合包變體
        if '升級版' not in sinya_name and '雙營組' not in sinya_name and '雙螢組' not in sinya_name:
            continue
        
        bare_name = extract_bare_laptop(sinya_name)
        match_name = bare_name if bare_name else sinya_name
        sinya_tokens = extract_tokens(match_name)
        
        candidate_positions = set()
        for tok in sinya_tokens:
            if tok in coolpc_index:
                candidate_positions.update(coolpc_index[tok])
        if not candidate_positions:
            continue
        
        best_score = -1
        best_ci = -1
        for ci_pos in candidate_positions:
            ci_orig = coolpc_pos_to_orig[ci_pos]
            # 第二輪：允許配對已配對的 CoolPC 商品
            cp = coolpc_products[ci_orig]
            
            # Category compatibility check
            if category_compat:
                cat_s = sp.get("category", "")
                cat_c = cp.get("category", "")
                if cat_s and cat_c and cat_s != cat_c:
                    if (cat_s, cat_c) not in category_compat and (cat_c, cat_s) not in category_compat:
                        continue
            
            is_vetoed, reason = veto(match_name, cp["name"])
            if is_vetoed:
                continue
            
            score, details = compute_score(match_name, cp["name"])
            if score > best_score:
                best_score = score
                best_ci = ci_orig
        
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
                "is_bare_match": bool(bare_name),
                "spec_diff": compute_spec_diff(sinya_name, cp["name"]),
            })
            sinya_matched.add(si_orig)
    
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
