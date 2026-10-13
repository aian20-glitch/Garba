#!/usr/bin/env python3
"""Картинки магазина (RULES.md §17): исходники художника → лёгкие webp для приложения.

    python3 tools/shop_art.py <папка с исходниками PNG>

Исходники (PNG от художника) кладутся копией в mobile/design/shop/ (webp без потерь качества
на глаз), готовые картинки — в mobile/assets/shop/. Для рамок печатает долю дырки под фото —
её вписать в frameHole в mobile/lib/widgets/shop_look.dart.
"""
import sys
from pathlib import Path
from collections import deque
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'mobile/assets/shop'
SRC_COPY = ROOT / 'mobile/design/shop'


def trim_square(im, pad=0.02):
    """Обрезать прозрачные поля и дополнить до квадрата, предмет — по центру."""
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(box)
    side = int(max(im.size) * (1 + pad * 2))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas


def frame_hole(im):
    """Дырка под фото: прозрачная область, связанная с центром. Возвращает (cx, cy, диаметр)."""
    a = im.getchannel('A')
    w, h = im.size
    px = a.load()
    start = (w // 2, h // 2)
    seen = {start}
    q = deque([start])
    xs, ys = [], []
    while q:
        x, y = q.popleft()
        xs.append(x)
        ys.append(y)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny] < 60:
                seen.add((nx, ny))
                q.append((nx, ny))
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    if x0 == 0 or y0 == 0 or x1 == w - 1 or y1 == h - 1:
        raise SystemExit('дырка рамки не замкнута — картинка не подходит')
    return (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, ((x1 - x0 + 1) + (y1 - y0 + 1)) / 2


def frame(im, size=512):
    """Рамка: дырка — ровно в центре квадрата, всё нарисованное помещается."""
    cx, cy, d = frame_hole(im)
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    half = max(cx - box[0], box[2] - cx, cy - box[1], box[3] - cy) + 4
    side = int(half * 2)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, (int(half - cx), int(half - cy)))
    return canvas.resize((size, size), Image.LANCZOS), d / side


def save(im, name, quality):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'{name}.webp'
    im.save(path, 'WEBP', quality=quality, method=6)
    return path.stat().st_size // 1024


def main(src):
    src = Path(src)
    SRC_COPY.mkdir(parents=True, exist_ok=True)
    for png in sorted(src.glob('*.png')):
        name = png.stem
        im = Image.open(png).convert('RGBA')
        im.save(SRC_COPY / f'{name}.webp', 'WEBP', quality=95, method=6)
        if name.startswith('frame_'):
            out, hole = frame(im)
            print(f'{name}: {save(out, name, 88)} КБ, дырка {hole:.3f}')
        elif name.startswith('back_'):
            print(f'{name}: {save(im.convert("RGB").resize((400, 600), Image.LANCZOS), name, 86)} КБ')
        elif name.startswith('cloth_'):
            print(f'{name}: {save(im.convert("RGB").resize((768, 1152), Image.LANCZOS), name, 82)} КБ')
        elif name.startswith('fx_'):
            side = 512 if name == 'fx_burkit' else 256
            print(f'{name}: {save(trim_square(im).resize((side, side), Image.LANCZOS), name, 88)} КБ')
        elif name.startswith('sticker_'):
            print(f'{name}: {save(trim_square(im).resize((320, 320), Image.LANCZOS), name, 88)} КБ')


if __name__ == '__main__':
    main(sys.argv[1])
