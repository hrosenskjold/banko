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
    for (let i = 0; i < bin.length; i++) if (bin[i] && a[i] + b[i] - 1 >= L) erase[i] = 1;
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
    for (let i = 0; i < bin.length; i++) if (bin[i] && a[i] + b[i] - 1 >= L) erase[i] = 1;
    for (let i = 0; i < bin.length; i++) if (erase[i]) bin[i] = 0;
  }

  // Finder alle tal på hele den udrettede plade og placerer hvert tal i præcis ét felt
  // ud fra tallets midtpunkt. Det tåler, at hjørnerne er sat lidt skævt.
  // Returnerer [{r, c, img}] hvor img er et sort/hvidt canvas klar til OCR.
  function extractNumbers(gray, W, H) {
    const ink = percentile(gray, 0.02);           // de mørkeste pixels ≈ trykte tal
    // lokal tærskel pr. felt: midt mellem blæk og feltets papirfarve,
    // så farvede tomme felter og skygger ikke tæller som blæk
    const thr = new Float32Array(ROWS * COLS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const px = new Uint8ClampedArray(CELL * CELL);
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) px[y * CELL + x] = gray[(r * CELL + y) * W + c * CELL + x];
      const paper = percentile(px, 0.9);
      thr[r * COLS + c] = paper - ink < 60 ? -1 : ink + 0.5 * (paper - ink);  // for lav kontrast = intet blæk
    }
    const bin = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = thr[Math.min(ROWS - 1, (y / CELL) | 0) * COLS + Math.min(COLS - 1, (x / CELL) | 0)];
      if (gray[y * W + x] < t) bin[y * W + x] = 1;
    }

    removeGridLines(bin, W, H);

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
    if (nums.length >= 4) {
      const [ax, bx] = searchAxis(nums.map(n => n.x), COLS);
      const [ay, by] = searchAxis(nums.map(n => n.y), ROWS);
      T = [ax, 0, bx, 0, ay, by];
    }
    // 2) finjustering med fuld affin afbildning
    const apply = (t, x, y) => [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
    const cellOf = (x, y) => [
      Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL))),
      Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))),
    ];
    if (nums.length >= 6) {
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
    return { grid, unsure, rowCounts };
  }

  return { loadImage, warp, CropUI, recognize, colOf, colRange, ROWS, COLS };
})();
