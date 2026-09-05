#!/usr/bin/env python3
"""
驗收測試 — 依照規格書第七節
A 組：必須被否決（12 筆）
B 組：必須保留，不可誤殺（8 筆）
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from matcher import veto, compute_score, norm, head, MATCH_THRESHOLD

print("=" * 70)
print("驗收測試 — 商品配對規則規格書 v2")
print("=" * 70)

# ── A 組：必須被否決 ──
print("\n【A 組】以下配對必須被否決：")
print("-" * 70)

A_tests = [
    ("麗臺 RTX PRO 5000 Blackwell 48GB", "麗臺 RTX PRO 5000 Blackwell 72GB", "R2"),
    ("巨蟒 ANACOMDA DDR5-7200 32G(16G*2)", "芝奇 焰鋒戟RGB 128GB(64GB*2)", "R1/R2"),
    ("索泰 ZOTAC RTX 5080 SOLID 16GB", "微星 RTX5080 16G GAMING TRIO", "R1"),
    ("華碩 ProArt PA34VCNV", "華碩 ProArt PA27USD", "R3"),
    ("PHILIPS Evnia 32M2N6800MW", "三星 Odyssey G9 S57CG952NC", "R1/R3"),
    ("BenQ EW2790Q", "BenQ SW272U", "R3"),
    ("AOC U27G4", "AOC AGON PD49", "R3"),
    ("LG 27UP600K-W", "LG UltraGear 32GS95UV-W", "R3"),
    ("微星 PRO Z890-S WIFI PZ", "微星玩具總動員-大全配", "R6"),
    ("海韻 Focus GX-1000 櫻花", "海韻 FOCUS GD-1000", "R4"),
    ("曜越 Toughpower GT 750W", "曜越 Toughpower GF A3 750W", "R4"),
    ("致態小翼 e7 1TB", "致態小翼 S001 1TB", "R4"),
    # 附錄新增
    ("三星 SAMSUNG 9100 PRO 4TB/M.2 PCIe Gen5/含散熱片", "三星 Samsung 9100 PRO 8TB含散熱片/PCIe 5.0 x4", "R2"),
    ("三星 SAMSUNG 9100 PRO 1TB/M.2 PCIe Gen5/含散熱片", "三星 Samsung 9100 PRO 4TB含散熱片/PCIe 5.0 x4", "R2"),
]

A_pass = 0
A_fail = 0
for sinya, coolpc, expected_rule in A_tests:
    is_vetoed, reason = veto(sinya, coolpc)
    status = "PASS" if is_vetoed else "FAIL"
    if is_vetoed:
        A_pass += 1
    else:
        A_fail += 1
    print(f"  [{status}] {sinya[:35]:35s} vs {coolpc[:35]:35s} → {reason or '未否決'} (預期: {expected_rule})")

print(f"\n  A 組結果: {A_pass} PASS / {A_fail} FAIL")

# ── B 組：必須保留（不可誤殺） ──
print("\n【B 組】以下配對必須保留（不可被否決）：")
print("-" * 70)

B_tests = [
    ("微星 RTX 5070Ti 16G VANGUARD SOC", "MSI RTX 5070 Ti 16GB VANGUARD SOC 顯示卡"),
    ("AMD Ryzen 7 9800X3D", "AMD R7 9800X3D 8核16緒 中央處理器"),
    ("三星 SAMSUNG 990 PRO 2TB", "三星 990 PRO 2TB M.2 PCIe4.0 固態硬碟"),
    ("華碩 TUF GAMING B850M-PLUS WIFI", "ASUS TUF Gaming B850M-PLUS WIFI 主機板"),
    ("酷碼 Elite 600 白 全景玻璃機殼", "酷碼 Elite 600 白 顯卡長40/全景玻璃透側/ATX"),
    ("Intel Core Ultra 7 265K", "英特爾 Ultra 7 265K 中央處理器"),
    ("美光 Crucial T705 2TB", "美光 Micron Crucial T705 2TB Gen5 讀14100"),
    ("acer Nitro V ANV16S-41-R5FT", "acer Nitro V ANV16S-41-R5FT 電競筆電"),
    # 附錄新增
    ("三星 SAMSUNG 9100 PRO 4TB/M.2 PCIe Gen5/含散熱片", "三星 Samsung 9100 PRO 4TB含散熱片/PCIe 5.0 x4/TLC"),
]

B_pass = 0
B_fail = 0
for sinya, coolpc in B_tests:
    is_vetoed, reason = veto(sinya, coolpc)
    score, details = compute_score(sinya, coolpc)
    status = "PASS" if not is_vetoed else "FAIL"
    if not is_vetoed:
        B_pass += 1
    else:
        B_fail += 1
    print(f"  [{status}] {sinya[:35]:35s} vs {coolpc[:35]:35s} → score={score:.3f} {reason or 'OK'}")

print(f"\n  B 組結果: {B_pass} PASS / {B_fail} FAIL")

# ── 正規化驗證 ──
print("\n【正規化驗證】")
print("-" * 70)
norm_tests = [
    ("5070 Ti", "5070TI", "型號寫法統一"),
    ("Ryzen 7", "R7", "CPU別名"),
    ("Core i7", "I7", "CPU別名"),
    ("Core Ultra 7", "ULTRA7", "CPU別名"),
    ("16GB", "16G", "容量單位"),
    ("2TB", "2T", "容量單位"),
]
for original, expected, desc in norm_tests:
    result = norm(original)
    status = "PASS" if result == expected else "FAIL"
    print(f"  [{status}] norm({original!r}) = {result!r} (預期: {expected!r}) — {desc}")

# ── 總結 ──
print("\n" + "=" * 70)
total_pass = A_pass + B_pass
total_fail = A_fail + B_fail
if total_fail == 0:
    print(f"✓ 全數通過：A 組 {A_pass} 筆否決成功，B 組 {B_pass} 筆保留成功")
else:
    print(f"✗ 有 {total_fail} 筆失敗：A 組 {A_fail} 筆未否決，B 組 {B_fail} 筆被誤殺")
print("=" * 70)
if __name__ == "__main__":
    sys.exit(1 if total_fail else 0)
