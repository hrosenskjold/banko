/* Ciffer-genkendelse (håndskrift + tryk) med et lille neuralt netværk trænet på
   MNIST + mange skrifttyper. Vægtene ligger i js/digit-model.js (window.DIGIT_MODEL).
   normalizeDigit() SKAL matche digitnorm.py, som modellen er trænet med. */
window.Digits = (() => {
  let net = null;
  function model() {
    if (net) return net;
    const M = window.DIGIT_MODEL;
    if (!M) throw new Error('Ciffer-modellen mangler');
    net = M.layers.map(L => {
      const raw = atob(L.w);
      const W = new Float32Array(L.in * L.out);
      for (let i = 0; i < W.length; i++) { let v = raw.charCodeAt(i); if (v > 127) v -= 256; W[i] = v * L.scale; }
      return { in: L.in, out: L.out, W, b: Float32Array.from(L.b) };
    });
    return net;
  }

  function classify(x) {
    let a = x;
    const layers = model();
    layers.forEach((L, li) => {
      const o = Float32Array.from(L.b);
      for (let i = 0; i < L.in; i++) {
        const v = a[i]; if (!v) continue;
        const row = i * L.out;
        for (let j = 0; j < L.out; j++) o[j] += v * L.W[row + j];
      }
      if (li < layers.length - 1) for (let j = 0; j < o.length; j++) if (o[j] < 0) o[j] = 0;
      a = o;
    });
    const mx = Math.max(...a);
    const e = Array.from(a, v => Math.exp(v - mx));
    const s = e.reduce((p, q) => p + q, 0);
    return e.map(v => v / s);
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
  // læs cifret med normal, lidt tykkere og lidt tyndere streg og tag gennemsnittet
  function probsOf(g, W) {
    const { m, w, h } = glyphMask(g, W);
    const variants = [0, 1, 2].map(e => classify(normalizeDigit(m, w, h, e)));
    return variants[0].map((_, k) => (variants[0][k] * 2 + variants[1][k] + variants[2][k]) / 4);
  }

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
      const P = h.glyphs.map(g => probsOf(g, W).map(p => Math.log(Math.max(p, 1e-4))));
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
