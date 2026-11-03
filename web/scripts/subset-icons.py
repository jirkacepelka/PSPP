#!/usr/bin/env python3
"""Subsets the Material Symbols Rounded variable font to the icons used in src/.

Usage: python3 scripts/subset-icons.py   (requires: pip install fonttools brotli)
Every quoted [a-z0-9_]+ literal in src/**/*.ts(x) that matches an icon glyph is kept.
"""
import pathlib, re, subprocess, sys
from fontTools.ttLib import TTFont

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'node_modules/material-symbols/material-symbols-rounded.woff2'
out = root / 'src/assets/material-symbols-subset.woff2'
font = TTFont(str(src))
glyphs = set(font.getGlyphOrder())
words = set()
for p in (root / 'src').rglob('*.ts*'):
    text = p.read_text(encoding='utf-8')
    words.update(re.findall(r"['\"`>]([a-z0-9_]{2,40})['\"`<]", text))
icons = sorted(w for w in words if w in glyphs)
keep = icons + [f'{i}.fill' for i in icons if f'{i}.fill' in glyphs]
chars = 'abcdefghijklmnopqrstuvwxyz0123456789_'
cmd = [sys.executable, '-m', 'fontTools.subset', str(src), f'--text={chars}', f"--glyphs={','.join(keep)}",
       '--no-layout-closure', '--layout-features=*', '--flavor=woff2', f'--output-file={out}']
subprocess.check_call(cmd)
print(f'{len(icons)} icons -> {out.relative_to(root)} ({out.stat().st_size // 1024} kB)')
