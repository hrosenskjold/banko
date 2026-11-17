/* Scanning af bankoplader: beskæring med 4 hjørner, perspektiv-udretning,
   opdeling i 3x9 felter og tal-genkendelse med et lille neuralt netværk (js/digits.js) – alt sker i browseren. */
window.Scanner = (() => {
  const ROWS = 3, COLS = 9, CELL = 120;          // udrettet plade: 1080 x 360 px

  /* ---------- hjælpere ---------- */
  const colOf = n => (n === 90 ? 8 : Math.floor(n / 10));
  const colRange = c => (c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9]);

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 2000;
        const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kunne ikke læse billedet')); };
      img.src = url;
    });
  }

  /* ---------- homografi (perspektiv) ---------- */
  // Finder H så (u,v) i dst-rektanglet afbildes til (x,y) i kildebilledet.
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = from[i], [x, y] = to[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    // gauss-elimination
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return (u, v) => {
      const w = h[6] * u + h[7] * v + 1;
      return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
    };
  }

  function warp(src, quad, W = COLS * CELL, H = ROWS * CELL) {
    const map = homography([[0, 0], [W, 0], [W, H], [0, H]], quad);
    const sctx = src.getContext('2d', { willReadFrequently: true });
    const sd = sctx.getImageData(0, 0, src.width, src.height).data;
    const sw = src.width, sh = src.height;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    const od = octx.createImageData(W, H);
    const d = od.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let [sx, sy] = map(x + 0.5, y + 0.5);
        sx -= 0.5; sy -= 0.5;
        const x0 = Math.max(0, Math.min(sw - 2, Math.floor(sx)));
        const y0 = Math.max(0, Math.min(sh - 2, Math.floor(sy)));
        const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const o = (y * W + x) * 4;
        for (let k = 0; k < 3; k++) {
          const top = sd[i00 + k] * (1 - fx) + sd[i10 + k] * fx;
          const bot = sd[i01 + k] * (1 - fx) + sd[i11 + k] * fx;
          d[o + k] = top * (1 - fy) + bot * fy;
        }
        d[o + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  /* ---------- automatisk hjørnefinding ---------- */
  // Finder pladens gitter: mørke streger findes med lokal tærskel (tåler skygger), gitteret er
  // en stor sammenhængende figur af tynde streger. Dens omrids reduceres til en firkant, siderne
  // tilpasses rette linjer, og kandidater scores efter om der ligger linjer på de indre
  // gitterpositioner (8 lodrette + 2 vandrette). Returnerer 4 hjørner (TL,TR,BR,BL – langsiden
  // øverst, dvs. 9 kolonner langs TL→TR) i kildebilledets koordinater, eller null.
  function detectPlate(src) {
    // 1. forsøg: gråtoner (virker også med farvede trykte gitre). 2. forsøg: lysstyrke (største
    // farvekanal) – her forsvinder farvet tusch-skravering næsten, mens sorte/blyantslinjer bliver.
    return detectWith(src, 'gray') || detectWith(src, 'value');
  }

  function detectWith(src, mode) {
    const s = Math.min(1, 1000 / Math.max(src.width, src.height));
    const w = Math.round(src.width * s), h = Math.round(src.height * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, 0, 0, w, h);
    let g;
    if (mode === 'gray') g = grayOf(c);
    else {
      const d = c.getContext('2d').getImageData(0, 0, w, h).data;
      g = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = Math.max(d[i], d[i + 1], d[i + 2]);
    }

    // lokal (adaptiv) tærskel med integralbillede
    const W1 = w + 1, I = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
    const R = Math.max(5, Math.round(Math.max(w, h) / 30));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
        const mean = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((y1 - y0) * (x1 - x0));
        if (g[y * w + x] < mean - Math.max(8, mean * 0.07)) bin[y * w + x] = 1;
      }
    }

    // luk små huller i tynde kuglepensstreger (kun til at finde den sammenhængende figur)
    const closed = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * w + x])
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) closed[yy * w + xx] = 1;
      }
    // komponenter
    const label = new Int32Array(w * h), comps = [], stack = [];
    for (let st = 0; st < closed.length; st++) {
      if (!closed[st] || label[st]) continue;
      const id = comps.length + 1;
      let n = 0, mnx = w, mny = h, mxx = 0, mxy = 0;
      stack.push(st); label[st] = id;
      while (stack.length) {
        const p = stack.pop(); n++;
        const x = p % w, y = (p / w) | 0;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (closed[q] && !label[q]) { label[q] = id; stack.push(q); }
        }
      }
      comps.push({ id, n, mnx, mny, mxx, mxy, area: (mxx - mnx + 1) * (mxy - mny + 1) });
    }
    const cands = comps.filter(k => k.area > w * h * 0.03 && k.n < k.area * 0.5 && k.n > w * h * 0.002)
      .sort((a, b) => b.area - a.area).slice(0, 6);

    let best = null;
    for (const k of cands) {
      // yderpunkter pr. række og søjle -> konveks hylster
      const pts = [];
      for (let y = k.mny; y <= k.mxy; y++) {
        let a = -1, b = -1;
        for (let x = k.mnx; x <= k.mxx; x++) if (label[y * w + x] === k.id) { if (a < 0) a = x; b = x; }
        if (a >= 0) { pts.push([a, y]); if (b !== a) pts.push([b, y]); }
      }
      for (let x = k.mnx; x <= k.mxx; x++) {
        let a = -1, b = -1;
        for (let y = k.mny; y <= k.mxy; y++) if (label[y * w + x] === k.id) { if (a < 0) a = y; b = y; }
        if (a >= 0) { pts.push([x, a]); if (b !== a) pts.push([x, b]); }
      }
      const quad = quadFromPoints(pts, w, h);
      if (!quad) continue;
      // prøv begge tolkninger af hvilken side der er langsiden (9 kolonner)
      for (const q0 of [quad, [quad[1], quad[2], quad[3], quad[0]]]) {
        if (gridScore(bin, w, h, q0) < 0.1) continue;
        const q = snapSides(bin, w, h, q0);
        const ev = gridEvidence(bin, w, h, q);
        if (!best || ev.score > best.score) best = { ...ev, q };
      }
    }
    // en rigtig plade har (næsten) alle 14 gitterlinjer; kasser, brikker og rod har få
    if (!best || best.lines < 11) return null;
    return best.q.map(([x, y]) => [x / s, y / s]);
  }

  function convexHull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  // hylster -> firkant: fjern det hjørne der koster mindst areal, til der er 4 tilbage;
  // tilpas så hver side en ret linje gennem randpunkterne og skær linjerne.
  function quadFromPoints(pts, w, h) {
    let hull = convexHull(pts);
    if (hull.length < 4) return null;
    const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    while (hull.length > 4) {
      let bi = 0, ba = Infinity;
      for (let i = 0; i < hull.length; i++) {
        const a = tri(hull[(i - 1 + hull.length) % hull.length], hull[i], hull[(i + 1) % hull.length]);
        if (a < ba) { ba = a; bi = i; }
      }
      hull.splice(bi, 1);
    }
    // linjetilpasning pr. side
    const diag = Math.hypot(w, h), tol = diag * 0.02;
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const A = hull[i], B = hull[(i + 1) % 4];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]); if (len < 1) return null;
      const nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len;
      const near = pts.filter(p => {
        const t = ((p[0] - A[0]) * (B[0] - A[0]) + (p[1] - A[1]) * (B[1] - A[1])) / (len * len);
        return t > 0.1 && t < 0.9 && Math.abs((p[0] - A[0]) * nx + (p[1] - A[1]) * ny) < tol;
      });
      if (near.length < 5) { lines.push([A, B]); continue; }
      let mx = 0, my = 0; for (const p of near) { mx += p[0]; my += p[1]; } mx /= near.length; my /= near.length;
      let sxx = 0, sxy = 0, syy = 0;
      for (const p of near) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      lines.push([[mx, my], [mx + Math.cos(ang), my + Math.sin(ang)]]);
    }
    const inter = (L1, L2) => {
      const [[x1, y1], [x2, y2]] = L1, [[x3, y3], [x4, y4]] = L2;
      const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(d) < 1e-9) return null;
      const a = x1 * y2 - y1 * x2, b = x3 * y4 - y3 * x4;
      return [(a * (x3 - x4) - (x1 - x2) * b) / d, (a * (y3 - y4) - (y1 - y2) * b) / d];
    };
    let q = [];
    for (let i = 0; i < 4; i++) { const p = inter(lines[(i + 3) % 4], lines[i]); if (!p) return null; q.push(p); }
    if (q.some(([x, y]) => x < -w * 0.05 || y < -h * 0.05 || x > w * 1.05 || y > h * 1.05)) q = hull.slice();
    // ordn med uret startende øverst til venstre
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    q.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let tl = 0; q.forEach((p, i) => { if (p[0] + p[1] < q[tl][0] + q[tl][1]) tl = i; });
    q = [0, 1, 2, 3].map(i => q[(tl + i) % 4]);
    // langsiden øverst
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d(q[0], q[1]) + d(q[2], q[3]) < d(q[1], q[2]) + d(q[3], q[0])) q = [q[1], q[2], q[3], q[0]];
    const area = Math.abs(q.reduce((a, p, i) => { const n = q[(i + 1) % 4]; return a + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
    if (area < w * h * 0.03) return null;
    return q;
  }

  // Hvor godt passer et 3x9-gitter på firkanten? (blæk på indre linjer minus blæk midt i felterne)
  function gridScore(bin, w, h, q) {
    const map = homography([[0, 0], [COLS, 0], [COLS, ROWS], [0, ROWS]], q);
    const ink = (u, v) => {
      const [x, y] = map(u, v); const xi = Math.round(x), yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = xi + dx, yy = yi + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && bin[yy * w + xx]) return 1;
      }
      return 0;
    };
    let on = 0, nOn = 0, off = 0, nOff = 0;
    for (let i = 0; i <= COLS; i++) for (let t = 0.04; t < ROWS; t += 0.06) { on += ink(i, t); nOn++; if (i) { off += ink(i - 0.5, t); nOff++; } }
    for (let j = 0; j <= ROWS; j++) for (let t = 0.04; t < COLS; t += 0.06) { on += ink(t, j); nOn++; if (j) { off += ink(t, j - 0.5); nOff++; } }
    return on / nOn - 0.5 * off / nOff;
  }

  // Hvor mange af gitterets 14 linjer (10 lodrette, 4 vandrette) findes som gennemgående
  // streger? Hver linje må forskydes lidt (håndtegnede gitre er ujævne).
  function gridEvidence(bin, w, h, q) {
    const map = homography([[0, 0], [COLS, 0], [COLS, ROWS], [0, ROWS]], q);
    const ink = (u, v) => {
      const [x, y] = map(u, v); const xi = Math.round(x), yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = xi + dx, yy = yi + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && bin[yy * w + xx]) return 1;
      }
      return 0;
    };
    const cover = (vertical, pos, maxOff) => {
      let best = 0;
      for (let off = -maxOff; off <= maxOff + 1e-9; off += 0.04) {
        let hit = 0, n = 0;
        const len = vertical ? ROWS : COLS;
        for (let t = 0.05; t < len - 0.05; t += 0.05) { hit += vertical ? ink(pos + off, t) : ink(t, pos + off); n++; }
        best = Math.max(best, hit / n);
      }
      return best;
    };
    // baggrund: dækning midt i felterne (rod giver blæk overalt, en ren plade næsten ingen)
    let base = 0;
    for (let i = 0; i < COLS; i++) base += cover(true, i + 0.5, 0) / (COLS + ROWS);
    for (let j = 0; j < ROWS; j++) base += cover(false, j + 0.5, 0) / (COLS + ROWS);
    const cov = [];
    for (let i = 0; i <= COLS; i++) cov.push(cover(true, i, i === 0 || i === COLS ? 0.08 : 0.3));
    for (let j = 0; j <= ROWS; j++) cov.push(cover(false, j, j === 0 || j === ROWS ? 0.06 : 0.15));
    const lines = cov.filter(c => c >= 0.45 && c - base >= 0.3).length;
    const sum = cov.reduce((a, c) => a + c, 0);
    return { lines, score: lines + sum / 14 - 3 * base, cov, base };
  }

  // Flyt hver side ud til den yderste rigtige streg. For hver side afprøves parallelle og let
  // drejede placeringer; den yderste, hvor stregen dækker næsten lige så godt som den bedste,
  // vælges. Hjørnerne bliver skæringerne mellem de fire sider. Virker også for håndtegnede
  // gitre med ujævne kolonner og linjer, der stikker ud over gitteret.
  function snapSides(bin, w, h, q) {
    const ink = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = xi + dx, yy = yi + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && bin[yy * w + xx]) return 1;
      }
      return 0;
    };
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const longSide = (len(q[0], q[1]) + len(q[2], q[3])) / 2, shortSide = (len(q[1], q[2]) + len(q[3], q[0])) / 2;
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const A = q[i], B = q[(i + 1) % 4], L = len(A, B);
      let nx = -(B[1] - A[1]) / L, ny = (B[0] - A[0]) / L;
      if ((A[0] + B[0]) / 2 * nx + (A[1] + B[1]) / 2 * ny < cx * nx + cy * ny) { nx = -nx; ny = -ny; }  // udad
      const cell = i % 2 === 0 ? shortSide / ROWS : longSide / COLS;   // top/bund: rækkehøjde, sider: kolonnebredde
      const inward = Math.round(cell * 1.2), outward = Math.max(2, Math.round(cell * 0.06));
      const step = Math.max(1, Math.round((inward + outward) / 60));
      const n = Math.max(40, Math.round(L / 3));
      let res = [];
      for (let da = -inward; da <= outward; da += step) for (let db = -inward; db <= outward; db += step) {
        if (Math.abs(da - db) > cell * 0.5) continue;
        const ax = A[0] + nx * da, ay = A[1] + ny * da, bx = B[0] + nx * db, by = B[1] + ny * db;
        let hit = 0;
        for (let k = 0; k < n; k++) { const t = 0.03 + 0.94 * k / (n - 1); hit += ink(ax + (bx - ax) * t, ay + (by - ay) * t); }
        res.push([hit / n, da + db, [[ax, ay], [bx, by]]]);
      }
      const mx = Math.max(...res.map(r => r[0]));
      if (mx < 0.35) { lines.push([A, B]); continue; }
      const good = res.filter(r => r[0] >= mx * 0.8);
      const outer = Math.max(...good.map(r => r[1]));
      // blandt de yderste: tag den med bedst dækning
      const pick = good.filter(r => r[1] >= outer - 2 * step).sort((a, b) => b[0] - a[0])[0];
      lines.push(pick[2]);
    }
    const inter = (L1, L2) => {
      const [[x1, y1], [x2, y2]] = L1, [[x3, y3], [x4, y4]] = L2;
      const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(d) < 1e-9) return null;
      const a = x1 * y2 - y1 * x2, b = x3 * y4 - y3 * x4;
      return [(a * (x3 - x4) - (x1 - x2) * b) / d, (a * (y3 - y4) - (y1 - y2) * b) / d];
    };
    const out = [];
    for (let i = 0; i < 4; i++) { const p = inter(lines[(i + 3) % 4], lines[i]); if (!p) return q; out.push(p); }
    return out;
  }

  // Flyt hjørnerne lidt ad gangen, så længe gitteret passer bedre på stregerne.
  function refineQuad(bin, w, h, q) {
    q = q.map(p => p.slice());
    let best = gridScore(bin, w, h, q);
    const size = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    for (let step = Math.max(2, Math.round(size * 0.03)); step >= 1; step = step > 1 ? Math.floor(step / 2) : 0) {
      let improved = true, guard = 0;
      while (improved && guard++ < 30) {
        improved = false;
        for (let i = 0; i < 4; i++) for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
          q[i][0] += dx; q[i][1] += dy;
          const sc = gridScore(bin, w, h, q);
          if (sc > best + 1e-4) { best = sc; improved = true; } else { q[i][0] -= dx; q[i][1] -= dy; }
        }
      }
    }
    return q;
  }

  /* ---------- beskærings-UI ---------- */
  class CropUI {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.drag = null;
      canvas.addEventListener('pointerdown', e => this.down(e));
      canvas.addEventListener('pointermove', e => this.move(e));
      ['pointerup', 'pointercancel'].forEach(t => canvas.addEventListener(t, e => this.up(e)));
      this._onResize = () => this.layout();
      window.addEventListener('resize', this._onResize);
    }
    setImage(img) {
      this.img = img;
      this.resetCorners();
      this.layout();
    }
    resetCorners() {
      const { width: w, height: h } = this.img;
      const mx = w * 0.06, my = h * 0.06;
      // forsøg at gætte pladens form (bredde:højde ≈ 9:3,2) midt i billedet
      let pw = w - 2 * mx, ph = pw / 2.8;
      if (ph > h - 2 * my) { ph = h - 2 * my; pw = ph * 2.8; }
      const x0 = (w - pw) / 2, y0 = (h - ph) / 2;
      this.corners = [[x0, y0], [x0 + pw, y0], [x0 + pw, y0 + ph], [x0, y0 + ph]];
      this.draw();
    }
    setCorners(q) {
      this.corners = q.map(p => p.slice());
      this.draw();
    }
    layout() {
      if (!this.img) return;
      const wrap = this.canvas.parentElement;
      const maxW = wrap.clientWidth || 600;
      const maxH = Math.max(240, window.innerHeight * 0.58);
      const s = Math.min(maxW / this.img.width, maxH / this.img.height);
      this.scale = s;
      const dpr = window.devicePixelRatio || 1;
      this.cssW = Math.round(this.img.width * s);
      this.cssH = Math.round(this.img.height * s);
      this.canvas.style.width = this.cssW + 'px';
      this.canvas.style.height = this.cssH + 'px';
      this.canvas.width = this.cssW * dpr;
      this.canvas.height = this.cssH * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }
    toImg(e) {
      const r = this.canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale];
    }
    down(e) {
      if (!this.img) return;
      e.preventDefault();
      const p = this.toImg(e);
      let best = 0, bd = Infinity;
      this.corners.forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      const grab = 44 / this.scale;
      const c = this.corners[best];
      this.drag = { i: best, off: bd < grab ? [c[0] - p[0], c[1] - p[1]] : [0, 0] };
      if (bd >= grab) this.corners[best] = p;
      this.canvas.setPointerCapture(e.pointerId);
      this.draw();
    }
    move(e) {
      if (!this.drag) return;
      e.preventDefault();
      const p = this.toImg(e);
      const { width: w, height: h } = this.img;
      this.corners[this.drag.i] = [
        Math.max(0, Math.min(w, p[0] + this.drag.off[0])),
        Math.max(0, Math.min(h, p[1] + this.drag.off[1])),
      ];
      this.draw();
    }
    up() { this.drag = null; this.draw(); }

    draw() {
      if (!this.img || !this.scale) return;
      const ctx = this.ctx, s = this.scale;
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      ctx.drawImage(this.img, 0, 0, this.cssW, this.cssH);
      const q = this.corners.map(([x, y]) => [x * s, y * s]);

      // mørkt udenfor pladen
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.rect(0, 0, this.cssW, this.cssH);
      ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath();
      ctx.fill('evenodd');
      ctx.restore();

      // gitter 3x9
      const map = homography([[0, 0], [COLS, 0], [COLS, ROWS], [0, ROWS]], q);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,201,60,.9)';
      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) { const a = map(i, 0), b = map(i, ROWS); ctx.moveTo(...a); ctx.lineTo(...b); }
      for (let j = 0; j <= ROWS; j++) { const a = map(0, j), b = map(COLS, j); ctx.moveTo(...a); ctx.lineTo(...b); }
      ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = '#ffc93c';
      ctx.beginPath(); ctx.moveTo(...q[0]); q.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.stroke();

      // hjørne-håndtag
      q.forEach(([x, y], i) => {
        ctx.beginPath(); ctx.arc(x, y, this.drag && this.drag.i === i ? 16 : 13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,201,60,.55)'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#e63946'; ctx.fill();
      });

      // lup mens man trækker
      if (this.drag) {
        const [cx, cy] = this.corners[this.drag.i];
        const R = Math.min(70, this.cssW * 0.18), Z = 3;
        const lx = cx * s < this.cssW / 2 ? this.cssW - R - 10 : R + 10, ly = R + 10;
        ctx.save();
        ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.clip();
        const srcR = R / (s * Z);
        ctx.drawImage(this.img, cx - srcR, cy - srcR, srcR * 2, srcR * 2, lx - R, ly - R, R * 2, R * 2);
        ctx.strokeStyle = '#e63946'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(lx - R, ly); ctx.lineTo(lx + R, ly); ctx.moveTo(lx, ly - R); ctx.lineTo(lx, ly + R); ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = '#ffc93c'; ctx.stroke();
      }
    }
  }

  /* ---------- billedbehandling pr. felt ---------- */
  function grayOf(canvas) {
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const g = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return g;
  }

  function percentile(arr, q) {
    const hist = new Uint32Array(256);
    for (const v of arr) hist[v]++;
    let acc = 0; const target = arr.length * q;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }

  // mindste kvadraters affine afbildning (x,y) -> (u,v) ud fra punkter [x, y, u, v]
  function fitAffine(pts) {
    const solve3 = (M, v) => {
      const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(M);
      if (Math.abs(D) < 1e-6) return null;
      return [0, 1, 2].map(i => det(M.map((row, r) => row.map((x, c) => (c === i ? v[r] : x)))) / D);
    };
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bu = [0, 0, 0], bv = [0, 0, 0];
    for (const [x, y, u, v] of pts) {
      const a = [x, y, 1];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) S[i][j] += a[i] * a[j]; bu[i] += a[i] * u; bv[i] += a[i] * v; }
    }
    const p = solve3(S, bu), q = solve3(S, bv);
    return p && q ? [...p, ...q] : null;
  }

  // Fjerner gitterlinjer: en pixel hører til en linje, hvis der går en sammenhængende sti
  // på mindst én feltlængde igennem den (højst 1 px drift pr. række – tåler skæve og
  // håndtegnede linjer). Et ciffer er aldrig så langt, så kun linjerne fjernes, og tal
  // der rører en linje, skilles fra gitteret.
  function removeGridLines(bin, W, H) {
    const L = CELL;
    const erase = new Uint8Array(W * H);
    const a = new Int16Array(W * H), b = new Int16Array(W * H);
    // lodrette linjer: længste sti oppefra (a) og nedefra (b)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!bin[i]) continue;
      let m = 0;
      if (y > 0) for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < W && a[i - W + d] > m) m = a[i - W + d]; }
      a[i] = m + 1;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!bin[i]) continue;
      let m = 0;
      if (y < H - 1) for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < W && b[i + W + d] > m) m = b[i + W + d]; }
      b[i] = m + 1;
    }
    const vproj = new Float32Array(W);
    for (let i = 0; i < bin.length; i++) if (bin[i] && a[i] + b[i] - 1 >= L) { erase[i] = 1; vproj[i % W]++; }
    // vandrette linjer: længste sti fra venstre (a) og fra højre (b)
    a.fill(0); b.fill(0);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const i = y * W + x; if (!bin[i]) continue;
      let m = 0;
      if (x > 0) for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < H && a[i - 1 + d * W] > m) m = a[i - 1 + d * W]; }
      a[i] = m + 1;
    }
    for (let x = W - 1; x >= 0; x--) for (let y = 0; y < H; y++) {
      const i = y * W + x; if (!bin[i]) continue;
      let m = 0;
      if (x < W - 1) for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < H && b[i + 1 + d * W] > m) m = b[i + 1 + d * W]; }
      b[i] = m + 1;
    }
    const hproj = new Float32Array(H);
    for (let i = 0; i < bin.length; i++) if (bin[i] && a[i] + b[i] - 1 >= L) { erase[i] = 1; hproj[(i / W) | 0]++; }
    for (let i = 0; i < bin.length; i++) if (erase[i]) bin[i] = 0;
    return { vproj, hproj };
  }

  // Find de rigtige skillelinjer mellem kolonner/rækker (håndtegnede gitre er ujævne).
  // proj: antal linjepixels pr. søjle (eller række), n: antal felter, span: linjens fulde længde.
  function findBounds(proj, n, span) {
    const sm = proj.map((_, i) => { let s = 0; for (let d = -2; d <= 2; d++) s += proj[i + d] || 0; return s / 5; });
    const bounds = [0];
    let found = 0;
    for (let k = 1; k < n; k++) {
      let best = -1, bv = 0;
      for (let x = Math.round((k - 0.45) * CELL); x <= Math.round((k + 0.45) * CELL); x++) if (sm[x] > bv) { bv = sm[x]; best = x; }
      if (best > bounds[bounds.length - 1] + CELL * 0.3 && bv >= span * 0.25) { bounds.push(best); found++; }
      else bounds.push(k * CELL);
    }
    bounds.push(n * CELL);
    return { bounds, found };
  }

  // Finder alle tal på hele den udrettede plade og placerer hvert tal i præcis ét felt
  // ud fra tallets midtpunkt. Det tåler, at hjørnerne er sat lidt skævt.
  // Returnerer [{r, c, img}] hvor img er et sort/hvidt canvas klar til OCR.
  function extractNumbers(gray, W, H) {
    // lokal (adaptiv) tærskel: blæk = tydeligt mørkere end omgivelserne. Tåler skygger,
    // lysforskelle hen over pladen og tynde, svage kuglepens- og blyantsstreger.
    const W1 = W + 1, I = new Float64Array(W1 * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += gray[y * W + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
    const R = Math.round(CELL * 0.2);
    const bin = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
        const mean = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((y1 - y0) * (x1 - x0));
        if (gray[y * W + x] < mean - Math.max(10, mean * 0.1)) bin[y * W + x] = 1;
      }
    }

    const lines = removeGridLines(bin, W, H);
    const vb = findBounds(lines.vproj, COLS, H), hb = findBounds(lines.hproj, ROWS, W);
    const useBounds = vb.found >= 5 && hb.found >= 1;

    // Skraverede felter (tomme felter, som er streget over med tusch): mange parallelle streger,
    // så næsten hver vandret OG lodret scanlinje krydser blæk mange gange. Et tal krydser højst
    // 6-8 gange og kun på nogle linjer. Skraverede felter tømmes, så de ikke læses som tal.
    const cb = useBounds ? vb.bounds : [...Array(COLS + 1).keys()].map(k => k * CELL);
    const rb = useBounds ? hb.bounds : [...Array(ROWS + 1).keys()].map(k => k * CELL);
    const cellStats = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cw = cb[c + 1] - cb[c], ch = rb[r + 1] - rb[r];
      const x0 = Math.round(cb[c] + cw * 0.1), x1 = Math.round(cb[c + 1] - cw * 0.1);
      const y0 = Math.round(rb[r] + ch * 0.1), y1 = Math.round(rb[r + 1] - ch * 0.1);
      let ink = 0, blocks = 0;
      const blk = new Array(16).fill(0), bn = new Array(16).fill(0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const k = Math.min(3, ((y - y0) * 4 / (y1 - y0)) | 0) * 4 + Math.min(3, ((x - x0) * 4 / (x1 - x0)) | 0);
        bn[k]++; if (bin[y * W + x]) { ink++; blk[k]++; }
      }
      for (let k = 0; k < 16; k++) if (blk[k] > bn[k] * 0.04) blocks++;
      const frac = ink / Math.max(1, (x1 - x0) * (y1 - y0));
      // andel af rækker/søjler med mindst 9 skift mellem blæk og papir
      let busyRows = 0, busyCols = 0;
      for (let y = y0; y < y1; y++) { let t = 0; for (let x = x0 + 1; x < x1; x++) if (bin[y * W + x] !== bin[y * W + x - 1]) t++; if (t >= 9) busyRows++; }
      for (let x = x0; x < x1; x++) { let t = 0; for (let y = y0 + 1; y < y1; y++) if (bin[y * W + x] !== bin[(y - 1) * W + x]) t++; if (t >= 9) busyCols++; }
      const rowsF = busyRows / (y1 - y0), colsF = busyCols / (x1 - x0);
      const hatched = blocks >= 13 && rowsF > 0.5 && colsF > 0.5;
      cellStats.push({ r, c, frac: +frac.toFixed(3), blocks, rowsF: +rowsF.toFixed(2), colsF: +colsF.toFixed(2), hatched });
      if (hatched) for (let y = Math.round(rb[r]); y < Math.round(rb[r + 1]); y++) for (let x = Math.round(cb[c]); x < Math.round(cb[c + 1]); x++) bin[y * W + x] = 0;
    }

    // sammenhængende komponenter (8-naboskab)
    const label = new Int32Array(W * H);
    const comps = [], stack = [];
    for (let s = 0; s < bin.length; s++) {
      if (!bin[s] || label[s]) continue;
      const id = comps.length + 1, pixels = [];
      let mnx = W, mny = H, mxx = -1, mxy = -1;
      stack.push(s); label[s] = id;
      while (stack.length) {
        const p = stack.pop(); pixels.push(p);
        const x = p % W, y = (p / W) | 0;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (bin[q] && !label[q]) { label[q] = id; stack.push(q); }
        }
      }
      comps.push({ pixels, mnx, mny, mxx, mxy, bw: mxx - mnx + 1, bh: mxy - mny + 1 });
    }
    // ciffer-lignende: rimelig højde, ikke gitterlinjer, ikke støj
    const digits = comps.filter(k =>
      k.pixels.length >= CELL * CELL * 0.003 &&
      k.bh >= CELL * 0.2 && k.bh <= CELL * 0.92 && k.bw <= CELL * 1.0 && k.bw > 2 &&
      // tynd stump ved billedkanten = rest af pladens kant, ikke et ciffer
      !((k.mnx === 0 || k.mny === 0 || k.mxx === W - 1 || k.mxy === H - 1) && (k.bw < CELL * 0.15 || k.bh < CELL * 0.15)) &&
      k.pixels.length / (k.bw * k.bh) > 0.05);
    // små stykker (fx 5-tallets top-streg eller en løs streg i håndskrift)
    const frags = comps.filter(k => !digits.includes(k) &&
      k.pixels.length >= CELL * CELL * 0.0012 && k.bh < CELL * 0.35 && k.bw < CELL * 0.5);

    // saml cifre, der står side om side, til ét tal (union-find)
    const parent = digits.map((_, i) => i);
    const box = digits.map(d => [d.mnx, d.mxx]);        // gruppens vandrette udstrækning
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const pairs = [];
    for (let i = 0; i < digits.length; i++) for (let j = i + 1; j < digits.length; j++) {
      const a = digits[i], b = digits[j];
      const gap = Math.max(a.mnx - b.mxx, b.mnx - a.mxx);
      const vOverlap = Math.min(a.mxy, b.mxy) - Math.max(a.mny, b.mny);
      const similar = Math.min(a.bh, b.bh) / Math.max(a.bh, b.bh) > 0.45;
      if (gap < CELL * 0.2 && vOverlap > Math.min(a.bh, b.bh) * 0.4 && similar) pairs.push([gap, i, j]);
    }
    pairs.sort((p, q) => p[0] - q[0]);                   // tætteste par først
    for (const [, i, j] of pairs) {
      const ri = find(i), rj = find(j);
      if (ri === rj) continue;
      const lo = Math.min(box[ri][0], box[rj][0]), hi = Math.max(box[ri][1], box[rj][1]);
      if (hi - lo > CELL * 1.05) continue;                // et tal er aldrig bredere end et felt
      parent[ri] = rj; box[rj] = [lo, hi];
    }
    const groups = new Map();
    digits.forEach((d, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); });

    // hæng små stykker på det tal, de sidder i
    const groupList = [...groups.values()];
    for (const f of frags) {
      const fx = (f.mnx + f.mxx) / 2, fy = (f.mny + f.mxy) / 2;
      const g = groupList.find(parts => {
        const x0 = Math.min(...parts.map(k => k.mnx)), x1 = Math.max(...parts.map(k => k.mxx));
        const y0 = Math.min(...parts.map(k => k.mny)), y1 = Math.max(...parts.map(k => k.mxy));
        return fx >= x0 - CELL * 0.08 && fx <= x1 + CELL * 0.08 && fy >= y0 - CELL * 0.12 && fy <= y1 + CELL * 0.12;
      });
      if (g) g.push(f);
    }

    const nums = [];
    for (const parts of groupList) {
      const bx0 = Math.min(...parts.map(k => k.mnx)), bx1 = Math.max(...parts.map(k => k.mxx));
      const by0 = Math.min(...parts.map(k => k.mny)), by1 = Math.max(...parts.map(k => k.mxy));
      const area = parts.reduce((s, k) => s + k.pixels.length, 0);
      if (area < CELL * CELL * 0.008 || bx1 - bx0 > CELL * 1.15) continue;
      nums.push({ parts, bx0, bx1, by0, by1, area, x: (bx0 + bx1) / 2, y: (by0 + by1) / 2 });
    }

    // selvjustering: tal står normalt midt i felterne. Find den affine korrektion,
    // der bedst lægger tallenes midtpunkter i feltmidter (retter skævt satte hjørner).
    // 1) grov søgning pr. akse: skalering a og forskydning b, så x' = a·x + b rammer feltmidter
    const searchAxis = (vals, n) => {
      let bestA = 1, bestB = 0, bestS = -Infinity;
      const sigma = CELL * 0.12;
      for (let a = 0.85; a <= 1.1501; a += 0.01) {
        for (let b = -CELL * 0.5; b <= CELL * 0.5; b += 2) {
          let s = 0;
          for (const v of vals) {
            const t = a * v + b;
            const k = Math.max(0, Math.min(n - 1, Math.floor(t / CELL)));
            const d = t - (k + 0.5) * CELL;
            s += Math.exp(-(d * d) / (2 * sigma * sigma));
          }
          s -= 0.15 * (Math.abs(a - 1) / 0.15 + Math.abs(b) / (CELL * 0.5)); // foretræk lille korrektion
          if (s > bestS) { bestS = s; bestA = a; bestB = b; }
        }
      }
      return [bestA, bestB];
    };
    let T = [1, 0, 0, 0, 1, 0];
    if (nums.length >= 4 && !useBounds) {
      const [ax, bx] = searchAxis(nums.map(n => n.x), COLS);
      const [ay, by] = searchAxis(nums.map(n => n.y), ROWS);
      T = [ax, 0, bx, 0, ay, by];
    }
    // 2) finjustering med fuld affin afbildning
    const apply = (t, x, y) => [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
    const idxIn = (bounds, v) => { let k = 0; while (k < bounds.length - 2 && v >= bounds[k + 1]) k++; return k; };
    const cellOf = useBounds
      ? (x, y) => [idxIn(hb.bounds, y), idxIn(vb.bounds, x)]
      : (x, y) => [
          Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))),
          Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))),
        ];
    if (nums.length >= 6 && !useBounds) {
      for (let it = 0; it < 6; it++) {
        const pts = nums.map(n => {
          const [tx, ty] = apply(T, n.x, n.y);
          const [r, c] = cellOf(tx, ty);
          return [n.x, n.y, (c + 0.5) * CELL, (r + 0.5) * CELL];
        });
        const next = fitAffine(pts);
        if (!next || Math.abs(next[0] - 1) > 0.3 || Math.abs(next[4] - 1) > 0.3 ||
            Math.abs(next[1]) > 0.3 || Math.abs(next[3]) > 0.3) break;
        const moved = Math.abs(next[2] - T[2]) + Math.abs(next[5] - T[5]);
        T = next;
        if (moved < 0.5) break;
      }
    }

    // positionsbaseret felt for hvert tal (bruges til række og som kontrol af kolonnen)
    const placed = [];
    for (const n of nums) {
      const [tx, ty] = apply(T, n.x, n.y);
      if (tx < -CELL * 0.5 || ty < -CELL * 0.5 || tx > W + CELL * 0.5 || ty > H + CELL * 0.5) continue;
      const [r, c] = cellOf(tx, ty);
      placed.push(Object.assign(n, { r, c }));
    }

    return placed;
  }

  async function recognize(warped, onProgress) {
    const gray = grayOf(warped);
    const W = warped.width;
    onProgress && onProgress(0.1, 'Finder tallene …');
    await new Promise(r => setTimeout(r, 30));          // lad UI'et nå at tegne
    const found = extractNumbers(gray, W, warped.height);

    // læs hvert tal; tallets værdi bestemmer kolonnen, positionen er kontrol
    const cand = [];
    let done = 0;
    for (const f of found) {
      const res = Digits.readNumber(f.parts, W, f.c);
      if (res) cand.push({ r: f.r, c: res.col, value: res.value, unsure: res.confidence < 0.93 || res.col !== f.c, score: res.confidence + (res.col === f.c ? 1 : 0) + f.area / 1e5 });
      done++;
      onProgress && onProgress(0.1 + 0.9 * done / found.length, `Læser tal ${done} af ${found.length} …`);
      if (done % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const unsure = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const score = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
    for (const k of cand.sort((a, b) => b.score - a.score)) {
      if (score[k.r][k.c] >= 0) { unsure[k.r][k.c] = true; continue; }   // to tal i samme felt
      grid[k.r][k.c] = k.value; unsure[k.r][k.c] = k.unsure; score[k.r][k.c] = k.score;
    }
    // samme tal to steder: behold det sikreste
    const seen = new Map();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = grid[r][c]; if (v == null) continue;
      if (seen.has(v)) {
        const [pr, pc] = seen.get(v);
        const [lr, lc] = score[pr][pc] >= score[r][c] ? [r, c] : [pr, pc];
        grid[lr][lc] = null; unsure[lr][lc] = true;
        if (lr === pr && lc === pc) seen.set(v, [r, c]);
      } else seen.set(v, [r, c]);
    }
    // der var noget i feltet, men intet tal endte der: markér som usikkert
    for (const f of found) if (grid[f.r][f.c] == null) unsure[f.r][f.c] = true;
    const rowCounts = grid.map(row => row.filter(v => v != null).length);
    // kvalitet: sikre tal tæller op, usikre ned, rækker med præcis 5 tal giver bonus
    let quality = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (grid[r][c] != null) quality += Math.max(0, score[r][c] - (score[r][c] >= 1 ? 1 : 0));
      if (unsure[r][c]) quality -= 0.3;
    }
    quality += rowCounts.filter(n => n === 5).length * 0.5;
    return { grid, unsure, rowCounts, quality };
  }

  return { loadImage, warp, CropUI, recognize, detectPlate, colOf, colRange, ROWS, COLS };
})();
