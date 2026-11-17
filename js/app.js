/* Banko-hjælper – app-logik */
(() => {
  const { colOf, colRange, ROWS, COLS } = Scanner;
  const STORE_KEY = 'banko-hjaelper-v1';
  const PLATE_COLORS = ['#d62828', '#1d4ed8', '#15803d', '#ea8a00', '#7e22ce', '#0f766e', '#db2777', '#334155'];
  const LEVEL_NAMES = ['', '1 række', '2 rækker', 'Fuld plade'];

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ================= tilstand ================= */
  let state = { plates: [], called: [], celebrated: {}, sound: true, stage: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && Array.isArray(saved.plates)) state = Object.assign(state, saved);
  } catch (e) { /* privat browsing e.l. – kør uden gemning */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} };

  let calledSet = new Set(state.called);
  let freshNumber = null;   // til stempel-animation

  /* ================= beregninger ================= */
  function plateInfo(p) {
    const remaining = p.grid.map(row => row.filter(n => n != null && !calledSet.has(n)));
    const rowDone = p.grid.map((row, i) => row.some(n => n != null) && remaining[i].length === 0);
    const level = rowDone.filter(Boolean).length;
    const sorted = remaining.map(r => r.length).sort((a, b) => a - b);
    // mangler til 1, 2 og 3 rækker = summen af de L korteste rester
    const missing = [0, sorted[0], sorted[0] + sorted[1], sorted[0] + sorted[1] + sorted[2]];
    const target = Math.max(level + 1, state.stage || 1);
    let waitingFor = [];
    if (target <= 3 && missing[target] === 1) {
      waitingFor = remaining.filter(r => r.length === 1).map(r => r[0]).sort((a, b) => a - b);
    }
    return { remaining, rowDone, level, missing, waitingFor, target };
  }

  const dabStyle = n => {
    const h = (n * 2654435761) >>> 0;
    const dx = ((h & 7) - 3.5) * 0.9, dy = (((h >> 3) & 7) - 3.5) * 0.9;
    const rot = ((h >> 6) % 40) - 20, sc = 0.9 + ((h >> 11) % 15) / 100;
    return `--dx:${dx.toFixed(1)}%;--dy:${dy.toFixed(1)}%;--rot:${rot}deg;--sc:${sc}`;
  };

  /* ================= rendering ================= */
  const boardEl = $('#board');
  for (let n = 1; n <= 90; n++) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = n; b.dataset.n = n;
    b.style.setProperty('--ball', `var(--c${colOf(n)})`);
    boardEl.appendChild(b);
  }

  function render() {
    calledSet = new Set(state.called);
    const mine = new Set(state.plates.flatMap(p => p.grid.flat().filter(n => n != null)));

    // sidste tal
    const last = state.called[state.called.length - 1];
    const lb = $('#lastBall');
    const newText = last ? String(last) : '?';
    if (lb.textContent !== newText) {
      lb.textContent = newText;
      lb.className = 'ball ball-xl ' + (last ? `c${colOf(last)} pop` : 'empty');
    }
    $('#calledCount').textContent = `${state.called.length} / 90 råbt`;
    $('#undoBtn').disabled = !state.called.length;

    // historik
    const prev = state.called.slice(0, -1).slice(-14).reverse();
    $('#history').innerHTML = prev.length
      ? prev.map(n => `<span class="ball ball-sm c${colOf(n)}">${n}</span>`).join('')
      : `<span class="hint">${last ? 'Første tal er råbt!' : 'Skriv det opråbte tal ovenfor.'}</span>`;

    // tavle
    boardEl.querySelectorAll('button').forEach(b => {
      const n = +b.dataset.n;
      b.classList.toggle('on', calledSet.has(n));
      b.classList.toggle('mine', mine.has(n));
    });

    document.querySelectorAll('#stageBtns [data-stage]').forEach(b => {
      const on = +b.dataset.stage === state.stage;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    });

    // plader
    const infos = state.plates.map(plateInfo);
    $('#plates').innerHTML = state.plates.map((p, i) => plateHTML(p, infos[i], i)).join('');
    $('#plateCount').textContent = state.plates.length;
    $('#emptyState').hidden = state.plates.length > 0;

    renderStatus(infos);
    freshNumber = null;
  }

  function plateHTML(p, info, idx) {
    const tilt = (((idx * 7919) % 9) - 4) * 0.12;
    const nextMissing = info.target <= 3 ? info.missing[info.target] : 0;
    const cls = ['plate', info.level === 3 ? 'full' : nextMissing === 1 ? 'hot' : ''].join(' ');
    let cells = '';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const n = p.grid[r][c];
      const done = info.rowDone[r] ? ' row-done' : '';
      if (n == null) { cells += `<div class="cell blank${done}"></div>`; continue; }
      const hit = calledSet.has(n);
      cells += `<div class="cell num${hit ? ' hit' : ''}${hit && n === freshNumber ? ' fresh' : ''}${done}" data-n="${n}" style="${hit ? dabStyle(n) : ''}" role="button" aria-pressed="${hit}" aria-label="${n}"><span class="n">${n}</span></div>`;
    }
    const chips = [1, 2, 3].map(L => {
      if (info.level >= L) return `<span class="chip done">✓ ${LEVEL_NAMES[L]}</span>`;
      if (L < state.stage) return `<span class="chip past">${LEVEL_NAMES[L]}: gået</span>`;
      const m = info.missing[L];
      return `<span class="chip${m === 1 && L === info.target ? ' one' : ''}">${LEVEL_NAMES[L]}: mangler ${m}</span>`;
    }).join('');
    const waiting = info.waitingFor.length
      ? `<div class="waiting">Venter på: ${info.waitingFor.map(n => `<b>${n}</b>`).join(', ')}</div>` : '';
    return `
      <article class="${cls}" style="--pc:${p.color};--tilt:${tilt}deg" data-id="${p.id}">
        <div class="plate-head">
          <span class="plate-name">${esc(p.name)}</span>
          <span class="plate-tools">
            <button data-act="edit" title="Ret plade" aria-label="Ret plade">✏️</button>
            <button data-act="delete" title="Fjern plade" aria-label="Fjern plade">🗑️</button>
          </span>
        </div>
        <div class="plate-grid">${cells}</div>
        <div class="plate-status">${chips}</div>
        ${waiting}
      </article>`;
  }

  function renderStatus(infos) {
    const bar = $('#statusBar');
    if (!state.plates.length) { bar.innerHTML = ''; return; }
    const chips = [];
    const best = Math.max(0, ...infos.map(i => i.level));
    if (best > 0 && best >= state.stage) {
      const names = state.plates.filter((p, i) => infos[i].level === best).map(p => esc(p.name)).join(', ');
      chips.push(`<span class="status-chip win">🏆 ${LEVEL_NAMES[best]}: ${names}</span>`);
    }
    state.plates.forEach((p, i) => {
      const inf = infos[i];
      if (inf.target <= 3 && inf.waitingFor.length) {
        chips.push(`<span class="status-chip hot">🔥 ${esc(p.name)} mangler 1 til ${LEVEL_NAMES[inf.target].toLowerCase()} – venter på ${inf.waitingFor.join(', ')}</span>`);
      }
    });
    if (!chips.length) {
      if (!state.called.length) chips.push('<span class="status-chip">Klar! Skriv det første opråbte tal 🎤</span>');
      else {
        const open = infos.filter(i => i.target <= 3);
        if (open.length) {
          const closest = Math.min(...open.map(i => i.missing[i.target]));
          chips.push(`<span class="status-chip">Tættest på ${LEVEL_NAMES[state.stage].toLowerCase()}: mangler ${closest}</span>`);
        }
      }
    }
    bar.innerHTML = chips.join('');
  }

  /* ================= gevinst ================= */
  function checkWins() {
    const wins = [];
    state.plates.forEach(p => {
      const lvl = plateInfo(p).level;
      const had = state.celebrated[p.id] || 0;
      if (lvl > had && lvl >= state.stage) wins.push({ plate: p, level: lvl });
      state.celebrated[p.id] = lvl;   // falder også, hvis et tal fjernes igen
    });
    if (!wins.length) return;
    const top = Math.max(...wins.map(w => w.level));
    const names = wins.filter(w => w.level === top).map(w => esc(w.plate.name));
    $('#winTitle').textContent = top === 3 ? 'BANKO!' : 'GEVINST!';
    $('#winText').innerHTML = `<span class="lvl">${LEVEL_NAMES[top]}</span>på ${names.join(' og ')}`
      + (top < 3 ? '<br><small>Råb op – og spil videre!</small>' : '<br><small>Hele pladen er fuld!</small>');
    const nb = $('#winNext');
    nb.hidden = top >= 3 || state.stage > top;
    if (!nb.hidden) nb.textContent = `Spil videre om ${LEVEL_NAMES[top + 1].toLowerCase()} →`;
    nb.dataset.stage = top + 1;
    $('#winOverlay').hidden = false;
    Celebrate.confetti(top === 3 ? 320 : top === 2 ? 200 : 130);
    if (top === 3) setTimeout(() => Celebrate.confetti(220), 700);
    if (state.sound) Celebrate.fanfare(top);
    if (navigator.vibrate) navigator.vibrate(top === 3 ? [200, 80, 200, 80, 400] : [150, 60, 150]);
    $('#winClose').focus();
  }
  $('#winClose').addEventListener('click', () => { $('#winOverlay').hidden = true; $('#callInput').focus(); });
  $('#winNext').addEventListener('click', () => {
    $('#winOverlay').hidden = true;
    setStage(+$('#winNext').dataset.stage);
  });

  /* ================= der spilles om ================= */
  function setStage(n) {
    state.stage = n;
    // gevinster under det nye niveau skal ikke fejres; dem der allerede er nået, er set
    save(); render();
    toast(`Der spilles nu om ${LEVEL_NAMES[n].toLowerCase()}`);
  }
  $('#stageBtns').addEventListener('click', e => {
    const b = e.target.closest('[data-stage]');
    if (b && +b.dataset.stage !== state.stage) setStage(+b.dataset.stage);
  });

  /* ================= opråb ================= */
  function commit() { save(); render(); checkWins(); }

  function callNumber(n) {
    if (calledSet.has(n)) return false;
    state.called.push(n);
    freshNumber = n;
    const on = state.plates.filter(p => p.grid.flat().includes(n)).map(p => p.name);
    toast(on.length ? `✔ ${n} – står på ${on.join(', ')}` : `${n} – ikke på dine plader`);
    if (state.sound && on.length) Celebrate.click();
    commit();
    return true;
  }
  function uncallNumber(n) {
    state.called = state.called.filter(x => x !== n);
    toast(`${n} er fjernet igen`);
    commit();
  }
  const toggleNumber = n => (calledSet.has(n) ? uncallNumber(n) : callNumber(n));

  $('#callForm').addEventListener('submit', e => {
    e.preventDefault();
    Celebrate.unlock();
    const inp = $('#callInput');
    const n = parseInt(inp.value, 10);
    if (!(n >= 1 && n <= 90)) { shake(inp); toast('Skriv et tal fra 1 til 90'); return; }
    if (calledSet.has(n)) { shake(inp); toast(`${n} er allerede råbt`); inp.select(); return; }
    callNumber(n);
    inp.value = '';
    inp.focus();
  });
  function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  $('#undoBtn').addEventListener('click', () => {
    const n = state.called.pop();
    if (n == null) return;
    toast(`Fortrudt: ${n}`);
    commit();
  });
  boardEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-n]');
    if (b) { Celebrate.unlock(); toggleNumber(+b.dataset.n); }
  });

  $('#plates').addEventListener('click', async e => {
    const card = e.target.closest('.plate');
    if (!card) return;
    const plate = state.plates.find(p => p.id === card.dataset.id);
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'edit') return openEditor({ plate });
    if (act && act.dataset.act === 'delete') {
      if (await confirmBox('Fjern plade?', `Vil du fjerne „${plate.name}“?`, 'Fjern')) {
        state.plates = state.plates.filter(p => p !== plate);
        delete state.celebrated[plate.id];
        commit();
        toast('Pladen er fjernet');
      }
      return;
    }
    const cell = e.target.closest('.cell.num');
    if (cell) { Celebrate.unlock(); toggleNumber(+cell.dataset.n); }
  });

  $('#resetBtn').addEventListener('click', async () => {
    if (!state.called.length) { toast('Der er ingen råbte tal at nulstille'); return; }
    if (await confirmBox('Nulstil runden?', `Alle ${state.called.length} råbte tal bliver ryddet, og der spilles igen om 1 række. Dine plader bliver liggende.`, 'Nulstil')) {
      state.called = []; state.celebrated = {}; state.stage = 1;
      commit();
      toast('Ny runde – held og lykke! 🍀');
    }
  });

  $('#soundBtn').addEventListener('click', () => {
    state.sound = !state.sound; save(); updateSoundBtn();
    if (state.sound) Celebrate.click();
  });
  const updateSoundBtn = () => { $('#soundBtn').textContent = state.sound ? '🔊' : '🔇'; };
  updateSoundBtn();

  /* ================= toast & bekræft ================= */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function confirmBox(title, text, yesLabel = 'Ja') {
    const d = $('#confirmDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = yesLabel;
    d.showModal();
    return new Promise(res => {
      const done = v => { d.close(); d.removeEventListener('click', onClick); d.removeEventListener('cancel', onCancel); res(v); };
      const onClick = e => { const b = e.target.closest('[data-answer]'); if (b) done(b.dataset.answer === 'yes'); };
      const onCancel = () => done(false);
      d.addEventListener('click', onClick);
      d.addEventListener('cancel', onCancel);
    });
  }

  document.querySelectorAll('dialog [data-close]').forEach(b =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  /* ================= scanning ================= */
  const scanDialog = $('#scanDialog');
  const crop = new Scanner.CropUI($('#cropCanvas'));
  let currentImage = null;

  function showStep(step) {
    scanDialog.querySelectorAll('.scan-step').forEach(s => { s.hidden = s.dataset.step !== step; });
    scanDialog.classList.toggle('live-mode', step === 'live');
    if (step !== 'live') live.stop();
  }
  $('#scanBtn').addEventListener('click', () => {
    scanDialog.showModal();
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { showStep('live'); live.start(); }
    else showStep('pick');
  });
  scanDialog.addEventListener('close', () => live.stop());
  $('#manualBtn').addEventListener('click', () => openEditor());
  scanDialog.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => showStep(b.dataset.goto)));

  // find pladen automatisk og sæt hjørnerne; ellers standardhjørner til manuel justering
  function autoCorners(announce) {
    let q = null;
    try { q = Scanner.detectPlate(currentImage); } catch (err) { console.error(err); }
    if (q) {
      crop.setCorners(q);
      if (announce) toast('Pladen er fundet ✓ – ret hjørnerne, hvis de ikke passer');
    } else {
      crop.resetCorners();
      if (announce) toast('Kunne ikke finde pladen – træk hjørnerne på plads');
    }
    return !!q;
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      currentImage = await Scanner.loadImage(file);
      showStep('crop');
      crop.setImage(currentImage);
      autoCorners(true);
    } catch (err) { toast(err.message); }
  }
  $('#cameraInput').addEventListener('change', onFile);
  $('#galleryInput').addEventListener('change', onFile);
  $('#autoCornersBtn').addEventListener('click', () => autoCorners(true));
  function rotateImage(dir) {
    if (!currentImage) return;
    const src = currentImage, c = document.createElement('canvas');
    c.width = src.height; c.height = src.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    currentImage = c;
    crop.setImage(c);
    autoCorners(false);
  }
  $('#rotLeftBtn').addEventListener('click', () => rotateImage(-1));
  $('#rotRightBtn').addEventListener('click', () => rotateImage(1));

  // Læs pladen begge veje (den kan ligge på hovedet) og brug den læsning, der giver mest mening.
  async function readPlate(img, corners, onProgress) {
    let q = corners.map(p => p.slice());
    // står firkanten på højkant, er langsiden (9 kolonner) lodret: drej hjørnerækkefølgen
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d(q[0], q[1]) + d(q[2], q[3]) < d(q[1], q[2]) + d(q[3], q[0])) q = [q[1], q[2], q[3], q[0]];
    let best = null;
    const tries = [q, [q[2], q[3], q[0], q[1]]];
    for (let t = 0; t < tries.length; t++) {
      const warped = Scanner.warp(img, tries[t]);
      const res = await Scanner.recognize(warped, (p, msg) => onProgress && onProgress((t + p) / tries.length, msg));
      if (!best || res.quality > best.res.quality) best = { res, warped };
    }
    return best;
  }

  $('#runOcrBtn').addEventListener('click', async () => {
    if (!currentImage) return;
    showStep('ocr');
    const bar = $('#ocrBar'), status = $('#ocrStatus');
    bar.style.width = '0%';
    try {
      const best = await readPlate(currentImage, crop.corners, (p, msg) => {
        bar.style.width = Math.round(p * 100) + '%';
        if (msg) status.textContent = msg;
      });
      scanDialog.close();
      openEditor({ grid: best.res.grid, unsure: best.res.unsure, preview: best.warped.toDataURL('image/jpeg', 0.85) });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Scanningen fejlede');
      showStep('crop');
    }
  });

  /* ================= live-scanner ================= */
  // Kameraet kører; pladen findes løbende. Når den står stille, læses tallene automatisk.
  // Er nogle felter usikre, læses op til 3 billeder, og tallene stemmes sammen pr. felt.
  const live = (() => {
    const video = $('#liveVideo'), overlay = $('#liveOverlay'), statusEl = $('#liveStatus');
    const work = document.createElement('canvas');
    let stream = null, timer = null, running = false, busy = false;
    let lastQ = null, stable = 0, reads = [], torchOn = false, wanted = false;

    function setStatus(text, found) { statusEl.textContent = text; statusEl.classList.toggle('found', !!found); }

    async function start() {
      reads = []; lastQ = null; stable = 0; busy = false; wanted = true;
      setStatus('Starter kameraet …');
      draw(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
        });
      } catch (err) {
        console.warn(err);
        if (wanted) { toast('Kameraet kunne ikke startes – tag eller vælg et billede i stedet'); showStep('pick'); }
        return;
      }
      // brugeren kan være gået videre (galleri/luk), mens kameraet startede
      if (!wanted || !scanDialog.open) { stream.getTracks().forEach(t => t.stop()); stream = null; return; }
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* autoplay kan kræve brugerhandling */ }
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      $('#torchBtn').hidden = !caps.torch;
      running = true;
      setStatus('Ret kameraet mod én plade');
      loop();
    }

    function stop() {
      running = false; wanted = false;
      clearTimeout(timer);
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      video.srcObject = null;
      torchOn = false;
      $('#torchBtn').classList.remove('on');
      overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    }

    // hvor vises videoen (object-fit: cover)?
    function viewRect() {
      const W = overlay.clientWidth, H = overlay.clientHeight;
      const vw = video.videoWidth || W, vh = video.videoHeight || H;
      const s = Math.max(W / vw, H / vh);   // object-fit: cover
      return { s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2, W, H };
    }

    function draw(q, progress = 0) {
      const dpr = window.devicePixelRatio || 1;
      const { s, ox, oy, W, H } = viewRect();
      if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(H * dpr)) {
        overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr);
      }
      const ctx = overlay.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!q) {
        // sigtehjælp: en bred ramme i bankopladens format
        const gw = Math.min(W * 0.9, Math.max(120, H - 240) * 2.8), gh = gw / 2.8;
        const gx = (W - gw) / 2, gy = (H - gh) / 2, L = 26;
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (const [x, y, dx, dy] of [[gx, gy, 1, 1], [gx + gw, gy, -1, 1], [gx + gw, gy + gh, -1, -1], [gx, gy + gh, 1, -1]]) {
          ctx.beginPath(); ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke();
        }
        return;
      }
      const p = q.map(([x, y]) => [ox + x * s, oy + y * s]);
      ctx.fillStyle = 'rgba(255, 201, 60, .14)';
      ctx.strokeStyle = '#ffc93c'; ctx.lineWidth = 4; ctx.shadowColor = '#ffc93c'; ctx.shadowBlur = 12;
      ctx.beginPath(); p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      if (progress > 0) {   // fremdriftsring midt på pladen
        const cx = p.reduce((a, v) => a + v[0], 0) / 4, cy = p.reduce((a, v) => a + v[1], 0) / 4;
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffc93c';
        ctx.beginPath(); ctx.arc(cx, cy, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress)); ctx.stroke();
      }
    }

    function grabFrame(maxDim) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const k = Math.min(1, maxDim / Math.max(vw, vh));
      work.width = Math.round(vw * k); work.height = Math.round(vh * k);
      work.getContext('2d').drawImage(video, 0, 0, work.width, work.height);
      return { canvas: work, k };
    }

    const STABLE_FRAMES = 3;
    async function loop() {
      if (!running) return;
      timer = setTimeout(loop, 180);
      if (busy || !video.videoWidth) return;
      busy = true;
      try {
        const { canvas, k } = grabFrame(720);
        let q = Scanner.detectPlate(canvas, 720);
        q = q && q.map(([x, y]) => [x / k, y / k]);
        const diag = Math.hypot(video.videoWidth, video.videoHeight);
        const moved = q && lastQ ? Math.max(...q.map((p, i) => Math.hypot(p[0] - lastQ[i][0], p[1] - lastQ[i][1]))) : Infinity;
        stable = q ? (moved < diag * 0.015 ? stable + 1 : 1) : 0;
        lastQ = q;
        draw(q, q ? stable / STABLE_FRAMES : 0);
        if (!q) setStatus(reads.length ? 'Hold pladen i billedet …' : 'Ret kameraet mod én plade – hele pladen skal være med');
        else if (stable < STABLE_FRAMES) setStatus('Plade fundet – hold stille …', true);
        else await capture(q);
      } catch (err) { console.error(err); }
      busy = false;
    }

    async function capture(qLive) {
      // fuld opløsning til aflæsningen; find hjørnerne igen præcist
      const full = document.createElement('canvas');
      full.width = video.videoWidth; full.height = video.videoHeight;
      full.getContext('2d').drawImage(video, 0, 0);
      const q = Scanner.detectPlate(full) || qLive;
      if (navigator.vibrate) navigator.vibrate(30);
      setStatus(reads.length ? `Læser tallene … (billede ${reads.length + 1})` : 'Læser tallene …', true);
      const best = await readPlate(full, q);
      if (!running) return;
      reads.push(best);
      stable = 0;
      const unsureCount = best.res.unsure.flat().filter(Boolean).length;
      if (unsureCount === 0 || reads.length >= 3) finish();
      else setStatus(`${unsureCount} usikre felter – læser et billede mere …`, true);
    }

    // stem flere aflæsninger sammen pr. felt (summen af sikkerhed for hvert bud)
    function merge(list) {
      const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      const unsure = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const votes = new Map();
        let empty = 0, anyUnsure = false;
        for (const { res } of list) {
          const v = res.grid[r][c];
          if (res.unsure[r][c]) anyUnsure = true;
          if (v == null) { empty += res.unsure[r][c] ? 0.3 : 1; continue; }
          votes.set(v, (votes.get(v) || 0) + Math.max(0.05, res.conf[r][c] || 0.5));
        }
        let bv = null, bs = empty;
        for (const [v, sc] of votes) if (sc > bs) { bv = v; bs = sc; }
        grid[r][c] = bv;
        const agree = list.every(({ res }) => res.grid[r][c] === bv);
        unsure[r][c] = !agree || (anyUnsure && bs / list.length < 0.9);
      }
      return { grid, unsure };
    }

    function finish() {
      const best = reads.reduce((a, b) => (b.res.quality > a.res.quality ? b : a));
      const merged = reads.length > 1 ? merge(reads) : best.res;
      stop();
      scanDialog.close();
      openEditor({ grid: merged.grid, unsure: merged.unsure, preview: best.warped.toDataURL('image/jpeg', 0.85) });
    }

    // udløser: tag billedet nu og gå til manuel justering af hjørnerne
    $('#shutterBtn').addEventListener('click', () => {
      if (!video.videoWidth) return;
      if (reads.length) { finish(); return; }      // vi har allerede en aflæsning – brug den
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      stop();
      currentImage = c;
      showStep('crop');
      crop.setImage(c);
      autoCorners(true);
    });
    $('#liveGallery').addEventListener('change', e => { stop(); onFile(e); });
    $('#torchBtn').addEventListener('click', async () => {
      const track = stream && stream.getVideoTracks()[0];
      if (!track) return;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = false; }
      $('#torchBtn').classList.toggle('on', torchOn);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && running) scanDialog.close(); });

    return { start, stop };
  })();

  /* ================= editor ================= */
  const editDialog = $('#editDialog');
  const editGrid = $('#editGrid');
  let editing = null, chosenColor = PLATE_COLORS[0];

  function nextPlateName() {
    let i = state.plates.length + 1;
    while (state.plates.some(p => p.name === `Plade ${i}`)) i++;
    return `Plade ${i}`;
  }

  function openEditor({ plate = null, grid = null, unsure = null, preview = null } = {}) {
    editing = plate;
    const g = plate ? plate.grid : grid || Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    $('#editTitle').textContent = plate ? 'Ret plade' : preview ? 'Tjek de scannede tal' : 'Indtast plade';
    $('#plateName').value = plate ? plate.name : nextPlateName();
    chosenColor = plate ? plate.color : PLATE_COLORS[state.plates.length % PLATE_COLORS.length];
    const pv = $('#editPreview');
    if (preview) { pv.src = preview; pv.hidden = false; } else { pv.hidden = true; pv.removeAttribute('src'); }
    $('#editHint').textContent = preview
      ? 'Sammenlign med billedet. Gule felter er usikre – ret dem, hvis de er forkerte.'
      : 'Skriv tallene i de rigtige kolonner. Tomme felter lades tomme.';

    let html = '';
    for (let c = 0; c < COLS; c++) { const [lo, hi] = colRange(c); html += `<div class="col-head">${lo}–${hi}</div>`; }
    html += '<div></div>';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = g[r][c];
        const u = unsure && unsure[r][c] ? ' unsure' : '';
        html += `<input class="${u}" data-r="${r}" data-c="${c}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${v ?? ''}" aria-label="Række ${r + 1}, kolonne ${c + 1}">`;
      }
      html += `<div class="row-count" data-row="${r}"></div>`;
    }
    editGrid.innerHTML = html;
    renderColors();
    validateEditor();
    editDialog.showModal();
    if (!preview) editGrid.querySelector('input').focus();
  }

  function renderColors() {
    $('#colorPicker').innerHTML = PLATE_COLORS.map(c =>
      `<button type="button" data-color="${c}" class="${c === chosenColor ? 'sel' : ''}" style="background:${c}" aria-label="Farve"></button>`).join('');
  }
  $('#colorPicker').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (b) { chosenColor = b.dataset.color; renderColors(); }
  });

  function readEditor() {
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    editGrid.querySelectorAll('input').forEach(inp => {
      const v = inp.value.trim();
      grid[+inp.dataset.r][+inp.dataset.c] = v === '' ? null : parseInt(v, 10);
    });
    return grid;
  }

  function validateEditor() {
    const grid = readEditor();
    const errors = [], warnings = [];
    const seen = new Map();
    editGrid.querySelectorAll('input').forEach(inp => {
      const r = +inp.dataset.r, c = +inp.dataset.c, v = grid[r][c];
      let bad = false;
      if (inp.value.trim() !== '' && (isNaN(v) || v < 1 || v > 90)) bad = true;
      else if (v != null && colOf(v) !== c) bad = true;
      if (v != null && !bad) {
        if (seen.has(v)) { bad = true; seen.get(v).classList.add('bad'); errors.push(`${v} står flere gange`); }
        else seen.set(v, inp);
      }
      inp.classList.toggle('bad', bad);
      if (bad && v != null && !isNaN(v) && v >= 1 && v <= 90 && colOf(v) !== c) {
        const [lo, hi] = colRange(c);
        errors.push(`${v} hører ikke til i kolonnen ${lo}–${hi}`);
      } else if (bad && (isNaN(v) || v < 1 || v > 90)) errors.push('Tal skal være mellem 1 og 90');
    });
    let total = 0;
    for (let r = 0; r < ROWS; r++) {
      const cnt = grid[r].filter(v => v != null).length;
      total += cnt;
      const el = editGrid.querySelector(`[data-row="${r}"]`);
      el.textContent = `${cnt}/5`;
      el.classList.toggle('ok', cnt === 5);
      if (cnt && cnt !== 5) warnings.push(`Række ${r + 1} har ${cnt} tal (normalt 5)`);
    }
    // tallene stiger normalt nedad i hver kolonne (fx 33 over 34)
    for (let c = 0; c < COLS; c++) {
      const col = grid.map(row => row[c]).filter(v => v != null && !isNaN(v));
      if (col.some((v, i) => i && v <= col[i - 1])) {
        const [lo, hi] = colRange(c);
        warnings.push(`Kolonne ${lo}–${hi}: tallene plejer at stige nedad – tjek dem`);
      }
    }
    if (!total) errors.push('Pladen har ingen tal endnu');
    const box = $('#editErrors');
    const uniq = [...new Set(errors)];
    box.innerHTML = uniq.length
      ? uniq.map(esc).join(' · ')
      : warnings.length ? `<span style="color:#ffd866">${warnings.map(esc).join(' · ')}</span>` : '<span class="ok">✓ Pladen ser rigtig ud – 15 tal</span>';
    $('#savePlateBtn').disabled = uniq.length > 0;
    return { ok: !uniq.length, grid };
  }

  editGrid.addEventListener('input', e => {
    const inp = e.target;
    inp.value = inp.value.replace(/\D/g, '');
    inp.classList.remove('unsure');
    validateEditor();
    // hop videre når kolonnen er fyldt ud
    const c = +inp.dataset.c;
    const full = c === 0 ? inp.value.length === 1 : inp.value.length === 2;
    if (full) {
      const all = [...editGrid.querySelectorAll('input')];
      const nxt = all[all.indexOf(inp) + 1];
      if (nxt) nxt.focus();
    }
  });
  editGrid.addEventListener('focusin', e => { if (e.target.select) e.target.select(); });

  $('#savePlateBtn').addEventListener('click', () => {
    const { ok, grid } = validateEditor();
    if (!ok) return;
    const name = $('#plateName').value.trim() || nextPlateName();
    if (editing) {
      Object.assign(editing, { name, grid, color: chosenColor });
      toast('Pladen er opdateret');
    } else {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const plate = { id, name, grid, color: chosenColor };
      state.plates.push(plate);
      // allerede råbte tal tæller med, men en ny plade skal ikke fejres for gamle gevinster
      state.celebrated[id] = plateInfo(plate).level;
      toast(`${name} er tilføjet 🎉`);
    }
    editDialog.close();
    commit();
  });

  /* ================= skærmen tændt ================= */
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } } catch (e) {}
  }
  document.addEventListener('visibilitychange', keepAwake);
  document.addEventListener('pointerdown', keepAwake, { once: true });

  render();
  // markér eksisterende gevinster som allerede fejret ved opstart
  state.plates.forEach(p => { if (state.celebrated[p.id] == null) state.celebrated[p.id] = plateInfo(p).level; });

  // til test/fejlsøgning
  window.BankoApp = { get state() { return state; }, callNumber, render, crop };
})();
