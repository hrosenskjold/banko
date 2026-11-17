"""Genererer træningsdata til ciffer-CNN'en: MNIST med kraftig augmentering, europæiske
1/7-taller, cifre i skrifttyper og en 'ikke-ciffer'-klasse (10). Alt køres gennem
digitnorm.normalize, så det matcher normalizeDigit() i js/digits.js.

Brug: python tools/make_digit_data.py <mnist-mappe> <ud.npz>
"""
import os, sys
import numpy as np
from multiprocessing import Pool
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter, map_coordinates, binary_erosion, binary_dilation
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from digitnorm import normalize

S = 84  # arbejdsopløsning
FONTS = ['Candara', 'Candarab', 'Gabriola', 'Inkfree', 'arial', 'arialbd', 'ariblk', 'bahnschrift', 'calibri', 'calibrib',
         'cambriab', 'comic', 'comicbd', 'consola', 'consolab', 'constan', 'corbel', 'corbelb', 'cour', 'courbd', 'ebrima',
         'framd', 'gadugi', 'georgia', 'georgiab', 'impact', 'javatext', 'lucon', 'micross', 'pala', 'palab', 'segoepr',
         'segoeprb', 'segoesc', 'segoescb', 'segoeui', 'segoeuib', 'segoeuil', 'seguisb', 'sylfaen', 'tahoma', 'tahomabd',
         'times', 'timesbd', 'trebuc', 'trebucbd', 'verdana', 'verdanab', 'mvboli']


def load_idx(path):
    d = open(path, 'rb').read()
    if d[3] == 3:
        return np.frombuffer(d[16:], np.uint8).reshape(-1, 28, 28)
    return np.frombuffer(d[8:], np.uint8)


def elastic(m, rng):
    alpha, sigma = rng.uniform(4, 12), rng.uniform(3, 5)
    dx = gaussian_filter(rng.uniform(-1, 1, m.shape), sigma) * alpha
    dy = gaussian_filter(rng.uniform(-1, 1, m.shape), sigma) * alpha
    y, x = np.meshgrid(np.arange(m.shape[0]), np.arange(m.shape[1]), indexing='ij')
    return map_coordinates(m.astype(np.float32), [y + dy, x + dx], order=1) > 0.5


def affine(im, rng):
    im = im.rotate(rng.uniform(-14, 14), resample=Image.BILINEAR)
    sh, sx = rng.uniform(-0.3, 0.3), rng.uniform(0.75, 1.15)
    return im.transform(im.size, Image.AFFINE, (1 / sx, sh, -sh * S / 2 + (1 - 1 / sx) * S / 2, 0, 1, 0), Image.BILINEAR)


def thickness(m, rng):
    t = rng.rand()
    if t < 0.3 and m.sum() > 400:
        return binary_erosion(m, iterations=rng.randint(1, 4))   # tynd kuglepen
    if t < 0.5:
        return binary_dilation(m, iterations=rng.randint(1, 3))  # tusch
    return m


def gaps(m, rng):
    if rng.rand() < 0.2:
        ys, xs = np.nonzero(m)
        if len(ys) == 0:
            return m
        for _ in range(rng.randint(1, 3)):
            i, r = rng.randint(len(ys)), rng.randint(2, 4)
            m[max(0, ys[i] - r):ys[i] + r, max(0, xs[i] - r):xs[i] + r] = False
    return m


def finish(m, rng):
    m = thickness(m, rng)
    if rng.rand() < 0.6:
        m = elastic(m, rng)
    m = gaps(m, rng)
    return normalize(m) if m.sum() > 15 else None


def mnist_sample(args):
    img, seed = args
    rng = np.random.RandomState(seed)
    im = affine(Image.fromarray(img).resize((S, S), Image.BILINEAR), rng)
    return finish(np.array(im) > 100, rng)


def seven_cross(args):
    """MNIST-7 med europæisk tværstreg."""
    img, seed = args
    rng = np.random.RandomState(seed)
    m = np.array(Image.fromarray(img).resize((S, S), Image.BILINEAR)) > 100
    ys, xs = np.nonzero(m)
    if len(ys) < 20:
        return None
    y = int(ys.min() + (ys.max() - ys.min()) * rng.uniform(0.45, 0.62))
    row = np.nonzero(m[y])[0]
    if len(row) == 0:
        return None
    cx, half = row.mean(), (xs.max() - xs.min()) * rng.uniform(0.2, 0.35)
    th = max(2, int(m.sum() / max(1, ys.max() - ys.min()) / 3))
    im = Image.fromarray(m.astype(np.uint8) * 255)
    ImageDraw.Draw(im).line([(cx - half, y + rng.randint(-2, 3)), (cx + half, y + rng.randint(-2, 3))], fill=255, width=th)
    return finish(np.array(affine(im, rng)) > 100, rng)


def euro_one(seed):
    """1-tal med lang opstreg (og evt. fod), som man skriver det i Danmark."""
    rng = np.random.RandomState(seed)
    im = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(im)
    h = rng.uniform(45, 65)
    top, x, slant = (S - h) / 2, S / 2 + rng.uniform(-6, 6), rng.uniform(-8, 8)
    flag, ang, w = h * rng.uniform(0.25, 0.6), np.radians(rng.uniform(20, 55)), int(rng.randint(3, 9))
    d.line([(x - flag * np.cos(ang), top + flag * np.sin(ang)), (x, top), (x + slant, top + h)], fill=255, width=w, joint='curve')
    if rng.rand() < 0.25:
        d.line([(x + slant - h * 0.2, top + h), (x + slant + h * 0.2, top + h)], fill=255, width=w)
    return finish(np.array(affine(im, rng)) > 100, rng)


def font_sample(args):
    fname, dgt, seed = args
    rng = np.random.RandomState(seed)
    f = ImageFont.truetype(f'C:/Windows/Fonts/{fname}.ttf', 60)
    im = Image.new('L', (S, S), 0)
    ImageDraw.Draw(im).text((S / 2, S / 2), str(dgt), fill=255, font=f, anchor='mm',
                            stroke_width=int(rng.randint(0, 3)), stroke_fill=255)
    return finish(np.array(affine(im, rng)) > 100, rng)


def negative(seed):
    """Linjer, hjørner, kryds og klatter = ikke et ciffer (klasse 10)."""
    rng = np.random.RandomState(seed)
    im = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(im)
    k, w, c = rng.randint(5), int(rng.randint(2, 9)), S / 2
    if k == 0:
        L, a = rng.uniform(25, 70), np.radians(rng.uniform(-12, 12))
        d.line([(c - L / 2 * np.cos(a), c - L / 2 * np.sin(a)), (c + L / 2 * np.cos(a), c + L / 2 * np.sin(a))], fill=255, width=w)
    elif k == 1:
        a, b, sx, sy = rng.uniform(20, 50), rng.uniform(20, 50), rng.choice([-1, 1]), rng.choice([-1, 1])
        d.line([(c + sx * a, c), (c, c), (c, c + sy * b)], fill=255, width=w)
    elif k == 2:
        a = rng.uniform(20, 40)
        d.line([(c - a, c), (c + a, c)], fill=255, width=w)
        d.line([(c, c - (a if rng.rand() < 0.5 else 0)), (c, c + a)], fill=255, width=w)
    elif k == 3:
        rx, ry = rng.uniform(5, 22), rng.uniform(5, 22)
        d.ellipse([c - rx, c - ry, c + rx, c + ry], fill=255)
    else:
        L, gp = rng.uniform(30, 70), rng.uniform(6, 20)
        d.line([(c - L / 2, c - gp / 2), (c + L / 2, c - gp / 2)], fill=255, width=w)
        d.line([(c - L / 2, c + gp / 2), (c + L / 2, c + gp / 2)], fill=255, width=w)
    m = thickness(np.array(im.rotate(rng.uniform(-10, 10), resample=Image.BILINEAR)) > 100, rng)
    return normalize(m) if m.sum() > 15 else None


if __name__ == '__main__':
    mn, out = sys.argv[1], sys.argv[2]
    Xtr, ytr = load_idx(mn + '/train-images-idx3-ubyte'), load_idx(mn + '/train-labels-idx1-ubyte')
    X, y = [], []

    def add(results, labels):
        for r, l in zip(results, labels):
            if r is not None:
                X.append((r * 255).astype(np.uint8))
                y.append(int(l))

    with Pool(18) as pool:
        for rep in range(4):  # 4 augmenterede versioner af hvert MNIST-ciffer
            add(pool.map(mnist_sample, [(Xtr[i], rep * 100000 + i) for i in range(len(Xtr))], chunksize=500), ytr)
            print('mnist', rep, len(X), flush=True)
        sevens = np.nonzero(ytr == 7)[0]
        res = pool.map(seven_cross, [(Xtr[i], 900000 + j) for j, i in enumerate(list(sevens) * 2)], chunksize=200)
        add(res, [7] * len(res))
        res = pool.map(euro_one, range(1000000, 1015000), chunksize=200)
        add(res, [1] * len(res))
        print('euro', len(X), flush=True)
        jobs = [(f, dg, 2000000 + i) for i, (f, dg) in enumerate([(f, dg) for f in FONTS for dg in range(10)] * 60)]
        add(pool.map(font_sample, jobs, chunksize=200), [j[1] for j in jobs])
        print('fonte', len(X), flush=True)
        res = pool.map(negative, range(3000000, 3030000), chunksize=200)
        add(res, [10] * len(res))
        print('negative', len(X), flush=True)
    np.savez_compressed(out, X=np.array(X), y=np.array(y, np.int64))
    print('gemt', out, np.bincount(y))
