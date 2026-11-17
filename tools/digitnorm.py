"""Normalisering af et binært ciffer til 28x28 – SKAL matche normalizeDigit() i js/digits.js."""
import numpy as np

def dilate(m, r):
    if r <= 0: return m
    h, w = m.shape
    p = np.zeros((h + 2*r, w + 2*r), bool); p[r:r+h, r:r+w] = m
    out = np.zeros_like(p)
    # firkantet kerne (2r+1): max over forskydninger
    acc = np.zeros((h + 2*r, w + 4*r), bool)
    pp = np.zeros((h + 2*r, w + 4*r), bool); pp[:, r:r+w+2*r] = p
    for dx in range(-r, r+1): acc[:, r:r+w+2*r] |= pp[:, r+dx:r+dx+w+2*r]
    horiz = acc[:, r:r+w+2*r]
    pv = np.zeros((h + 4*r, w + 2*r), bool); pv[r:r+h+2*r] = horiz
    for dy in range(-r, r+1): out |= pv[r+dy:r+dy+h+2*r]
    return out

def normalize(mask):
    ys, xs = np.nonzero(mask)
    if len(ys) == 0: return np.zeros((28, 28), np.float32)
    m = mask[ys.min():ys.max()+1, xs.min():xs.max()+1]
    h, w = m.shape
    area = m.sum()
    p = np.pad(m, 1)
    inner = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    P = area - inner.sum()
    sw = 2.0 * area / max(P, 1)
    target = 0.12 * max(h, w)
    r = int(round((target - sw) / 2)) if sw < target else 0
    if r >= 1: m = dilate(m, r)
    h, w = m.shape
    s = 20.0 / max(h, w)
    nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
    # supersampling 4x4 pr. målpixel
    k = (np.arange(4) + 0.5) / 4
    sy = np.clip(((np.arange(nh)[:, None] + k[None, :]) / nh * h).astype(int), 0, h-1)  # (nh,4)
    sx = np.clip(((np.arange(nw)[:, None] + k[None, :]) / nw * w).astype(int), 0, w-1)  # (nw,4)
    sub = m[sy.reshape(-1)][:, sx.reshape(-1)].reshape(nh, 4, nw, 4).astype(np.float32)
    small = sub.mean(axis=(1, 3))
    tot = small.sum()
    cy = ((np.arange(nh) + 0.5)[:, None] * small).sum() / tot
    cx = ((np.arange(nw) + 0.5)[None, :] * small).sum() / tot
    oy = int(min(max(round(14 - cy), 0), 28 - nh))
    ox = int(min(max(round(14 - cx), 0), 28 - nw))
    out = np.zeros((28, 28), np.float32)
    out[oy:oy+nh, ox:ox+nw] = small
    return out
