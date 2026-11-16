# PROTOTYPE research script for issue #37: builds two image-only "scanned" PDFs (clean, rough) from page
# pictures in scan/p-*.png (made with pdftoppm), and writes the true ink box of each page.
import glob, json, random, sys
import numpy as np
from PIL import Image, ImageFilter
random.seed(7); np.random.seed(7)
def ink_box(mask):
    ys, xs = np.where(mask)
    h, w = mask.shape
    return dict(l=xs.min()/w, t=ys.min()/h, r=(xs.max()+1)/w, b=(ys.max()+1)/h)
for kind in ('clean', 'rough'):
    pages, truth = [], []
    for f in sorted(glob.glob('scan/p-*.png')):
        g = Image.open(f).convert('L')
        ink = Image.eval(g, lambda v: 255 - v)                       # ink as white on black
        angle = random.uniform(-1.2, 1.2) if kind == 'rough' else random.uniform(-0.4, 0.4)
        dx, dy = (random.randint(-25, 25), random.randint(-20, 20)) if kind == 'rough' else (0, 0)
        ink = ink.rotate(angle, resample=Image.BICUBIC, translate=(dx, dy))
        a = np.asarray(ink, dtype=np.float32) / 255
        truth.append(ink_box(a > 0.5))
        h, w = a.shape
        paper = 232 if kind == 'clean' else 205                      # grey / yellowed paper
        img = paper - a * (paper - 40)                               # faded ink, not pure black
        img += np.random.normal(0, 6 if kind == 'clean' else 10, a.shape)
        if kind == 'rough':
            for _ in range(60):                                      # specks
                y, x = random.randrange(h), random.randrange(w)
                img[y:y+random.randint(1, 3), x:x+random.randint(1, 3)] = random.randint(40, 110)
            gut = np.linspace(1, 0, int(w * 0.06)) ** 2               # gutter shadow on the binding side
            side = len(pages) % 2
            if side: img[:, :len(gut)] -= gut * 120
            else: img[:, w-len(gut):] -= gut[::-1] * 120
            b = int(w * 0.012)                                       # black scanner bed around the sheet
            img[:b, :] = 25; img[:, :b] = 25
        im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
        if kind == 'rough':
            im = Image.merge('RGB', (im, im.point(lambda v: int(v * 0.97)), im.point(lambda v: int(v * 0.85))))
        pages.append(im.convert('RGB'))
    pages[0].save(f'pdfs/scan-{kind}.pdf', save_all=True, append_images=pages[1:], resolution=150, quality=70)
    json.dump(truth, open(f'scan/truth-{kind}.json', 'w'))
    print(kind, len(pages))
