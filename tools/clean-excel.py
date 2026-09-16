#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
清洗《基础测试数据.xlsx》→ 输出按游戏名排序的整洁版，未知项黄底标注。

清理动作（全部可追溯，不做破坏性删改）：
  1. 删「幽灵行」：B 列无游戏名（源表 24 行，多为误触空行 / 表尾残留）
  2. 规范机型代号 A 列：8egn1/gta → 8gen1、'870/8gen3' & '8gen1、870' → 多机型展开说明
     （无法判定的一并标黄，不擅自猜测）
  3. 补齐「是否可玩」C 列空缺
  4. 按游戏名排序（中文优先按拼音，纯英文按字母，符号置后）
  5. 标黄：未知项 —— 判定见 is_unknown()

输出：
  E:/新建文件夹/基础测试数据-清洗版.xlsx
    ├ Sheet「清洗后数据」  ← 主表，按游戏名排序，未知项黄底
    └ Sheet「清洗报告」    ← 逐项统计：删了几行、改了什么、哪些标黄
"""
import os
import re
from collections import Counter

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

try:
    from pypinyin import Style, lazy_pinyin
    _HAS_PINYIN = True
except ImportError:
    _HAS_PINYIN = False

SRC = r'E:\新建文件夹\基础测试数据.xlsx'
OUT = r'E:\新建文件夹\基础测试数据-清洗版.xlsx'

# ---------- 机型代号归一 ----------
CHIP_CN = {
    '8gen1': '骁龙 8 Gen 1',
    '8e': '骁龙 8 Elite',
    '8gen3': '骁龙 8 Gen 3',
    '870': '骁龙 870',
}
# 错拼 / 别名 → 标准代号（gta 是历史遗留的机型笔误）
CHIP_ALIAS = {
    '8egn1': '8gen1',   # 字母顺序打错
    'gta': '8gen1',     # 明显笔误（与游戏 GTA 无关，看同批数据都是 8gen1）
}
CHIP_VALID = set(CHIP_CN)

# ---------- 表头（源表无表头，这里补上，方便阅读与后续筛选） ----------
HEADERS = [
    '机型芯片', '游戏名', '是否可玩', '兼容层', '运行模式', '驱动/GPU',
    'DXVK', 'vkd3d', '运行库', '帧率', '备注', '主程序exe', '状态', '补充',
]
NCOL = len(HEADERS)   # 14（源表 A-N）

# ---------- 样式 ----------
YELLOW = PatternFill('solid', fgColor='FFF2A8')       # 未知项（数据本身有问题）：黄底
ORANGE = PatternFill('solid', fgColor='FFE0C2')       # 待补（库内未收录）：浅橙底
HEAD_FILL = PatternFill('solid', fgColor='E8EAF0')
HEAD_FONT = Font(bold=True, size=11, color='1F2937')
GRAY_FONT = Font(color='9AA3B2', italic=True)          # 被规范化过的值
THIN = Side(style='thin', color='D5DAE3')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def s(v):
    return '' if v is None else str(v).strip()


def has_cjk(t):
    return bool(re.search(r'[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]', t))


# ---------- 排序键：中文按拼音，英文按字母，符号置后 ----------
def sort_key(name):
    """分三段：① 中文（按拼音）② 英文/数字（按字母）③ 符号开头。"""
    n = (name or '').strip()
    if not n:
        return (9, '', '')
    if has_cjk(n):
        if _HAS_PINYIN:
            py = ''.join(lazy_pinyin(n, style=Style.NORMAL))
        else:
            py = n                       # 无 pypinyin 时退化为码点序
        return (0, py, n)
    if n[0].isalnum():
        return (1, n.lower(), '')
    return (2, n.lower(), '')


def is_unknown(rec):
    """未知项判定 —— 只看「数据本身是否可用」，不看是否被本地库收录。
       标黄（黄底）：① 游戏名缺失/无法识别  ② 机型代号未知或混填
    """
    reasons = []
    name = rec['name']
    chip = rec['chip_raw']

    if not name:
        reasons.append('无游戏名')
    elif not re.search(r'[\w\u4e00-\u9fff]', name) or len(name) <= 1:
        reasons.append(f'名称无法识别（{name}）')

    if chip and chip not in CHIP_VALID and chip not in CHIP_ALIAS:
        if re.search(r'[/、,，+]', chip):
            reasons.append(f'多机型混填（{chip}）')
        elif chip.replace('.', '').isdigit():
            reasons.append(f'机型为非代号数字（{chip}）')
        else:
            reasons.append(f'机型代号未知（{chip}）')

    return reasons


def pending(rec, lib_index):
    """待补项 —— 数据本身正常，但本地库未收录（需要补中文名/封面/详情）。
       标浅橙：与黄底区分，便于「先修脏数据、再补内容」。"""
    name = rec['name']
    if not name or rec['reasons']:
        return False
    return norm_key(name) not in lib_index


def norm_key(t):
    """与 phonecfg.js 的 normKey 保持一致的归一（保留 CJK）。"""
    s0 = s(t).lower()
    s0 = re.sub(r'[\s\u3000]+', '', s0)
    s0 = re.sub(r'[·・:：,，.。!！?？"\'“”‘’()（）\[\]【】<>《》|｜/\\~～\-—_+*&#@$%^&;；＊]', '', s0)
    return s0


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb['Sheet1']
    raw = list(ws.iter_rows(min_row=2, values_only=True))

    # ---------- 本地库索引（用于③判定） ----------
    lib_index = set()
    lib_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'games.json')
    try:
        import json
        with open(lib_path, encoding='utf-8') as f:
            lib = json.load(f)
        arr = lib if isinstance(lib, list) else (lib.get('items') or lib.get('games') or [])
        for it in arr:
            for part in re.split(r'[/／|｜]', s(it.get('title'))):
                k = norm_key(part)
                if k:
                    lib_index.add(k)
            k = norm_key(it.get('title'))
            if k:
                lib_index.add(k)
    except Exception as e:
        print(f'[warn] 本地库索引读取失败（未知项判定将退化为仅看名称/机型）：{e}')

    # ---------- 联网补充的中文名映射（由 cn-names.json 提供，可选） ----------
    cn_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'cn-names.json')
    cn_map = {}
    try:
        import json
        with open(cn_path, encoding='utf-8') as f:
            cn_map = json.load(f)
        for en, cn in cn_map.items():
            k = norm_key(cn)
            if k:
                lib_index.add(k)
    except Exception:
        pass

    report = {
        '源行数': len(raw),
        '删除幽灵行': 0,
        '机型归一': 0,
        '可玩列补齐': 0,
        '标黄未知': 0,
        '标橙待补': 0,
        '删除样例': [],
    }

    cleaned = []
    for r in raw:
        rec = {
            'chip_raw': s(r[0]),
            'name': s(r[1]),
            'ok': s(r[2]),
            'layer': s(r[3]),
            'mode': s(r[4]),
            'gpu': s(r[5]),
            'dxvk': s(r[6]),
            'vkd3d': s(r[7]),
            'runtime': s(r[8]),
            'fps': s(r[9]),
            'note': s(r[10]),
            'exe': s(r[11]),
            'state': s(r[12]),
            'extra': s(r[13]),
        }
        # ① 幽灵行：无游戏名且无任何配置信息
        if not rec['name'] and not rec['layer'] and not rec['gpu'] and not rec['fps']:
            report['删除幽灵行'] += 1
            if len(report['删除样例']) < 5:
                report['删除样例'].append(f"第 {len(cleaned) + report['删除幽灵行'] + 1} 行（空）")
            continue
        cleaned.append(rec)

    # ---------- 规范化 + 未知判定 ----------
    for rec in cleaned:
        rec['chip_fixed'] = ''
        rec['chip_note'] = ''
        c = rec['chip_raw']
        if c in CHIP_VALID:
            rec['chip_fixed'] = CHIP_CN[c]
        elif c in CHIP_ALIAS:
            rec['chip_fixed'] = CHIP_CN[CHIP_ALIAS[c]]
            rec['chip_note'] = f'（原“{c}”已归一到 {CHIP_ALIAS[c]}）'
            report['机型归一'] += 1
        elif re.search(r'[/、,，+]', c):
            parts = [p.strip() for p in re.split(r'[/、,，+]', c) if p.strip()]
            rec['chip_fixed'] = ' / '.join(CHIP_CN.get(CHIP_ALIAS.get(p, p), p) for p in parts)
            rec['chip_note'] = f'（原“{c}”为多机型混填）'
        elif c:
            rec['chip_fixed'] = c

        if not rec['ok'] and rec['state'] in ('0', '1'):
            rec['ok'] = '是' if rec['state'] == '1' else '否'
            rec['ok_note'] = '（据状态列回填）'
            report['可玩列补齐'] += 1
        else:
            rec['ok_note'] = ''

        rec['reasons'] = is_unknown(rec)
        rec['pending'] = pending(rec, lib_index)
        if rec['reasons']:
            report['标黄未知'] += 1
        elif rec['pending']:
            report['标橙待补'] += 1

    # ---------- 排序 ----------
    cleaned.sort(key=lambda x: sort_key(x['name']))

    # ---------- 写盘 ----------
    out = openpyxl.Workbook()
    w = out.active
    w.title = '清洗后数据'

    w.append(HEADERS)
    for i in range(1, NCOL + 1):
        cell = w.cell(row=1, column=i)
        cell.fill = HEAD_FILL
        cell.font = HEAD_FONT
        cell.border = BORDER
        cell.alignment = Alignment(horizontal='center', vertical='center')

    for rec in cleaned:
        row = [
            rec['chip_fixed'], rec['name'], rec['ok'], rec['layer'], rec['mode'],
            rec['gpu'], rec['dxvk'], rec['vkd3d'], rec['runtime'], rec['fps'],
            rec['note'], rec['exe'], rec['state'], rec['extra'],
        ]
        w.append(row)
        rr = w.max_row
        fill = YELLOW if rec['reasons'] else (ORANGE if rec['pending'] else None)
        for ci in range(1, NCOL + 1):
            cell = w.cell(row=rr, column=ci)
            cell.border = BORDER
            cell.alignment = Alignment(vertical='top', wrap_text=(ci in (6, 11)))
            if fill:
                cell.fill = fill
        # 机型被规范化过的，用灰字提示
        if rec['chip_note']:
            w.cell(row=rr, column=1).font = GRAY_FONT
        # 标记原因追加在「补充」列最前，便于筛选
        mark = ''
        if rec['reasons']:
            mark = '⚠ 未知：' + '；'.join(rec['reasons'])
        elif rec['pending']:
            mark = '○ 待补：本地库未收录'
        if mark:
            extra = mark + ((' | ' + rec['extra']) if rec['extra'] else '')
            w.cell(row=rr, column=14).value = extra

    widths = [14, 34, 9, 20, 10, 24, 20, 14, 16, 12, 30, 26, 7, 40]
    for i, wd in enumerate(widths, start=1):
        w.column_dimensions[get_column_letter(i)].width = wd
    w.freeze_panes = 'C2'
    w.auto_filter.ref = f'A1:{get_column_letter(NCOL)}{w.max_row}'

    # ---------- 清洗报告 ----------
    rp = out.create_sheet('清洗报告')
    rp.append(['项目', '数值 / 说明'])
    rp.cell(row=1, column=1).font = HEAD_FONT
    rp.cell(row=1, column=2).font = HEAD_FONT
    rp.cell(row=1, column=1).fill = HEAD_FILL
    rp.cell(row=1, column=2).fill = HEAD_FILL
    lines = [
        ('源表行数', report['源行数']),
        ('删除幽灵行（无游戏名且无数据）', report['删除幽灵行']),
        ('保留有效行', len(cleaned)),
        ('机型代号归一（错拼/笔误）', report['机型归一']),
        ('「是否可玩」据状态列回填', report['可玩列补齐']),
        ('', ''),
        ('🟡 黄底 = 未知项', report['标黄未知']),
        ('🟠 橙底 = 待补（库内未收录）', report['标橙待补']),
        ('⚪ 无底色 = 数据完整且已收录', len(cleaned) - report['标黄未知'] - report['标橙待补']),
        ('', ''),
        ('排序规则', '中文按拼音 → 英文按字母 → 符号置后'),
        ('黄底含义', '① 游戏名缺失/无法识别 ② 机型代号未知或混填'),
        ('橙底含义', '数据本身正常，但本地库未收录（待补封面/详情）'),
        ('筛选方式', '表头已开筛选，「补充」列含 ⚠ 只看未知、含 ○ 只看待补'),
    ]
    for k, v in lines:
        rp.append([k, v])
    rp.column_dimensions['A'].width = 34
    rp.column_dimensions['B'].width = 46

    out.save(OUT)
    print(f'✅ 已输出：{OUT}')
    print(f"   源 {report['源行数']} 行 → 删幽灵行 {report['删除幽灵行']} → 保留 {len(cleaned)} 行")
    print(f"   机型归一 {report['机型归一']} ｜ 可玩列回填 {report['可玩列补齐']}")
    print(f"   🟡 黄底未知 {report['标黄未知']} ｜ 🟠 橙底待补 {report['标橙待补']} ｜ ⚪ 干净 {len(cleaned) - report['标黄未知'] - report['标橙待补']}")
    if report['删除样例']:
        print('   删除样例：', '；'.join(report['删除样例']))


if __name__ == '__main__':
    main()
