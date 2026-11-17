/* Ciffer-genkendelse (håndskrift + tryk) med et lille neuralt netværk trænet på
   MNIST + mange skrifttyper. Vægtene ligger i js/digit-model.js (window.DIGIT_MODEL).
   normalizeDigit() SKAL matche digitnorm.py, som modellen er trænet med. */
window.Digits = (() => {
  // Model: CNN (conv 3x3 + ReLU, 2x2 max-pool, tætte lag). 11 klasser: 0-9 og 10 = "ikke et ciffer".
  let net = null;
  function model() {
    if (net) return net;
    const M = window.DIGIT_MODEL;
    if (!M) throw new Error('Ciffer-modellen mangler');
    net = M.layers.map(L => {
      if (L.type === 'pool') return L;
      const raw = atob(L.w), W = new Float32Array(raw.length);
      for (let i = 0; i < W.length; i++) { let v = raw.charCodeAt(i); if (v > 127) v -= 256; W[i] = v * L.scale; }
      return { ...L, W, b: Float32Array.from(L.b) };
    });
    return net;
  }

  // x: Float32Array(784) -> sandsynligheder for 11 klasser
  function classify(x) {
    let a = x, C = 1, H = 28, Wd = 28;
    for (const L of model()) {
      if (L.type === 'conv') {
        const o = new Float32Array(L.out * H * Wd);
        for (let oc = 0; oc < L.out; oc++) {
          const ob = oc * H * Wd;
          o.fill(L.b[oc], ob, ob + H * Wd);
          for (let ic = 0; ic < C; ic++) {
            const ib = ic * H * Wd, wb = (oc * C + ic) * 9;
            for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
              const wv = L.W[wb + (ky + 1) * 3 + kx + 1];
              if (!wv) continue;
              const y0 = Math.max(0, -ky), y1 = Math.min(H, H - ky), x0 = Math.max(0, -kx), x1 = Math.min(Wd, Wd - kx);
              for (let y = y0; y < y1; y++) {
                const orow = ob + y * Wd, irow = ib + (y + ky) * Wd + kx;
                for (let xx = x0; xx < x1; xx++) o[orow + xx] += wv * a[irow + xx];
              }
            }
          }
        }
        for (let i = 0; i < o.length; i++) if (o[i] < 0) o[i] = 0;
        a = o; C = L.out;
      } else if (L.type === 'pool') {
        const h2 = H >> 1, w2 = Wd >> 1, o = new Float32Array(C * h2 * w2);
        for (let c = 0; c < C; c++) for (let y = 0; y < h2; y++) for (let xx = 0; xx < w2; xx++) {
          const i = c * H * Wd + 2 * y * Wd + 2 * xx;
          o[c * h2 * w2 + y * w2 + xx] = Math.max(a[i], a[i + 1], a[i + Wd], a[i + Wd + 1]);
        }
        a = o; H = h2; Wd = w2;
      } else {
        const o = Float32Array.from(L.b);
        for (let j = 0; j < L.out; j++) {
          let sum = o[j]; const row = j * L.in;
          for (let i = 0; i < L.in; i++) sum += a[i] * L.W[row + i];
          o[j] = L.relu && sum < 0 ? 0 : sum;
        }
        a = o;
      }
    }
    const mx = Math.max(...a);
    const e = Array.from(a, v => Math.exp(v - mx));
    const sm = e.reduce((p, q) => p + q, 0);
    return e.map(v => v / sm);
  }

  // mask: Uint8Array (1 = blæk), w x h  ->  Float32Array(784)
  function normalizeDigit(mask, w, h, extra = 0) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const out = new Float32Array(784);
    if (x1 < 0) return out;
    let bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    let m = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) m[y * bw + x] = mask[(y0 + y) * w + x0 + x];

    // stregtykkelse ≈ 2·areal / omkreds; tynde streger (kuglepen) gøres tykkere
    const at = (x, y) => (x >= 0 && y >= 0 && x < bw && y < bh ? m[y * bw + x] : 0);
    let area = 0, inner = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m[y * bw + x]) {
      area++;
      if (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)) inner++;
    }
    const sw = 2 * area / Math.max(area - inner, 1);
    const target = 0.12 * Math.max(bw, bh);
    const r = (sw < target ? Math.round((target - sw) / 2) : 0) + extra;
    if (r >= 1) {
      const nw = bw + 2 * r, nh = bh + 2 * r;
      const hor = new Uint8Array(nw * nh), d = new Uint8Array(nw * nh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m[y * bw + x])
        for (let dx = -r; dx <= r; dx++) hor[(y + r) * nw + x + r + dx] = 1;
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) if (hor[y * nw + x])
        for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy >= 0 && yy < nh) d[yy * nw + x] = 1; }
      m = d; bw = nw; bh = nh;
    }

    // skalér længste side til 20 px (4x4 supersampling) og centrér efter tyngdepunkt i 28x28
    const s = 20 / Math.max(bw, bh);
    const th = Math.max(1, Math.round(bh * s)), tw = Math.max(1, Math.round(bw * s));
    const small = new Float32Array(th * tw);
    for (let i = 0; i < th; i++) for (let j = 0; j < tw; j++) {
      let acc = 0;
      for (let a = 0; a < 4; a++) {
        const sy = Math.min(bh - 1, Math.floor((i + (a + 0.5) / 4) / th * bh));
        for (let b = 0; b < 4; b++) {
          const sx = Math.min(bw - 1, Math.floor((j + (b + 0.5) / 4) / tw * bw));
          acc += m[sy * bw + sx];
        }
      }
      small[i * tw + j] = acc / 16;
    }
    let tot = 0, cy = 0, cx = 0;
    for (let i = 0; i < th; i++) for (let j = 0; j < tw; j++) { const v = small[i * tw + j]; tot += v; cy += (i + 0.5) * v; cx += (j + 0.5) * v; }
    cy /= tot; cx /= tot;
    const oy = Math.min(Math.max(Math.round(14 - cy), 0), 28 - th);
    const ox = Math.min(Math.max(Math.round(14 - cx), 0), 28 - tw);
    for (let i = 0; i < th; i++) for (let j = 0; j < tw; j++) out[(oy + i) * 28 + ox + j] = small[i * tw + j];
    return out;
  }

  /* ---------- fra komponenter til tal ---------- */
  // parts: [{pixels:[idx...], mnx, mxx, mny, mxy}] i et billede med bredde W
  function glyphOf(parts, W) {
    const x0 = Math.min(...parts.map(p => p.mnx)), x1 = Math.max(...parts.map(p => p.mxx));
    const y0 = Math.min(...parts.map(p => p.mny)), y1 = Math.max(...parts.map(p => p.mxy));
    return { parts, x0, x1, y0, y1 };
  }
  function glyphMask(g, W) {
    const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1, m = new Uint8Array(w * h);
    for (const p of g.parts) for (const i of p.pixels) {
      const x = i % W, y = (i / W) | 0;
      if (x >= g.x0 && x <= g.x1) m[(y - g.y0) * w + x - g.x0] = 1;
    }
    return { m, w, h };
  }
  // læs tegnet med normal og lidt tykkere streg og tag gennemsnittet (11 klasser)
  const cache = new WeakMap();
  function probsOf(g, W) {
    if (cache.has(g)) return cache.get(g);
    const { m, w, h } = glyphMask(g, W);
    const a = classify(normalizeDigit(m, w, h, 0)), b = classify(normalizeDigit(m, w, h, 1));
    const p = a.map((v, k) => (2 * v + b[k]) / 3);
    cache.set(g, p);
    return p;
  }
  const NOT_DIGIT = 10;

  // del et bredt tegn (to sammenskrevne cifre) ved den tyndeste lodrette søjle
  function splitGlyph(g, W) {
    const { m, w, h } = glyphMask(g, W);
    const proj = new Array(w).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) proj[x] += m[y * w + x];
    let best = -1, bv = Infinity;
    for (let x = Math.floor(w * 0.3); x <= Math.ceil(w * 0.7); x++) if (proj[x] < bv) { bv = proj[x]; best = x; }
    if (best < 1 || best >= w - 1) return null;
    const cut = g.x0 + best;
    const L = { ...g, x1: cut - 1 }, R = { ...g, x0: cut + 1 };
    // stram lodret afgrænsning
    for (const s of [L, R]) {
      const mm = glyphMask(s, W); let a = mm.h, b = -1;
      for (let y = 0; y < mm.h; y++) for (let x = 0; x < mm.w; x++) if (mm.m[y * mm.w + x]) { if (y < a) a = y; if (y > b) b = y; }
      if (b < 0) return null;
      s.y1 = s.y0 + b; s.y0 = s.y0 + a;
    }
    return [L, R];
  }

  const colOf = n => (n === 90 ? 8 : Math.floor(n / 10));

  // Returnerer {value, confidence (0-1), col} eller null
  function readNumber(parts, W, posCol) {
    // saml stykker, der overlapper vandret (fx et 4-tal skrevet i to streger)
    const sorted = [...parts].sort((a, b) => a.mnx - b.mnx);
    let glyphs = [];
    for (const p of sorted) {
      const last = glyphs[glyphs.length - 1];
      if (last) {
        const ov = Math.min(last.x1, p.mxx) - Math.max(last.x0, p.mnx);
        if (ov > 0.5 * Math.min(last.x1 - last.x0 + 1, p.mxx - p.mnx + 1)) { glyphs[glyphs.length - 1] = glyphOf([...last.parts, p], W); continue; }
      }
      glyphs.push(glyphOf([p], W));
    }
    // smid tegn væk, som tydeligt ikke er cifre (linjerester, klatter, hjørner)
    if (glyphs.length > 1) {
      const keep = glyphs.filter(g => probsOf(g, W)[NOT_DIGIT] < 0.6);
      if (keep.length) glyphs = keep;
    }
    if (glyphs.length === 1 && probsOf(glyphs[0], W)[NOT_DIGIT] > 0.8) return null;
    // mere end 2 tegn: slå de tætteste sammen
    while (glyphs.length > 2) {
      let bi = 0, bg = Infinity;
      for (let i = 0; i < glyphs.length - 1; i++) { const gap = glyphs[i + 1].x0 - glyphs[i].x1; if (gap < bg) { bg = gap; bi = i; } }
      const merged = glyphOf([...glyphs[bi].parts, ...glyphs[bi + 1].parts], W);
      glyphs.splice(bi, 2, merged);
    }

    const hyps = [{ glyphs, prior: 0 }];
    if (glyphs.length === 1) {
      const g = glyphs[0];
      if ((g.x1 - g.x0 + 1) / (g.y1 - g.y0 + 1) > 0.7) {
        const sp = splitGlyph(g, W);
        if (sp) hyps.push({ glyphs: sp, prior: Math.log(0.5) });
      }
    } else if (glyphs.length === 2) {
      hyps.push({ glyphs: [glyphOf([...glyphs[0].parts, ...glyphs[1].parts], W)], prior: Math.log(0.15) });
    }

    const scores = [];
    for (const h of hyps) {
      const P = h.glyphs.map(g => {
        const p = probsOf(g, W), z = 1 - p[NOT_DIGIT] * 0.5;   // fordel lidt af "ikke-ciffer" ud
        return p.slice(0, 10).map(v => Math.log(Math.max(v / z, 1e-4)));
      });
      for (let n = 1; n <= 90; n++) {
        const ds = String(n);
        if (ds.length !== P.length) continue;
        let s = h.prior;
        for (let i = 0; i < ds.length; i++) s += P[i][+ds[i]];
        const dc = Math.abs(colOf(n) - posCol);
        s += dc === 0 ? 0 : dc === 1 ? Math.log(0.15) : Math.log(1e-6);
        scores.push([n, s]);
      }
    }
    if (!scores.length) return null;
    const mx = Math.max(...scores.map(x => x[1]));
    const z = scores.reduce((a, x) => a + Math.exp(x[1] - mx), 0);
    const [value, sc] = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
    return { value, confidence: Math.exp(sc - mx) / z, col: colOf(value) };
  }

  return { readNumber, normalizeDigit, classify };
})();
