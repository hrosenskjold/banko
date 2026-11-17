/* Konfetti + lyd – ingen eksterne biblioteker */
window.Celebrate = (() => {
  const COLORS = ['#e63946', '#ffc93c', '#2a9d8f', '#277da1', '#9d4edd', '#f77f00', '#ffffff', '#d63384'];
  let ctx = null, canvas = null, parts = [], raf = null;

  function confetti(amount = 160) {
    canvas = canvas || document.getElementById('confetti');
    if (!canvas) return;
    ctx = ctx || canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < amount; i++) {
      const fromLeft = i % 2 === 0;
      parts.push({
        x: fromLeft ? -10 : innerWidth + 10,
        y: innerHeight * (0.55 + Math.random() * 0.35),
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9),
        vy: -(9 + Math.random() * 11),
        w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < 0.3, life: 0,
      });
    }
    if (!raf) tick();
  }

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.y < innerHeight + 40 && p.life < 400);
    for (const p of parts) {
      p.life++; p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.scale(1, Math.cos(p.life * 0.15)); ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(tick);
    else { raf = null; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  // ---------- lyd ----------
  let ac = null;
  function audio() {
    if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function note(freq, start, dur, type = 'triangle', vol = 0.18) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    const t = a.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // C-dur fanfarer – større jo bedre gevinst
  const C = 523.25, E = 659.25, G = 783.99, C2 = 1046.5, E2 = 1318.5, G2 = 1568;
  function fanfare(level) {
    if (level === 1) {
      [[C, 0], [E, .12], [G, .24], [C2, .36]].forEach(([f, s]) => note(f, s, .25));
      note(C2, .5, .6, 'square', .08);
    } else if (level === 2) {
      [[G, 0], [G, .1], [G, .2], [E2, .32], [C2, .55], [E2, .7], [G2, .85]].forEach(([f, s]) => note(f, s, .3));
      [C, E, G].forEach(f => note(f, .85, .9, 'square', .05));
    } else {
      const seq = [C, E, G, C2, G, C2, E2, G2, E2, G2];
      seq.forEach((f, i) => note(f, i * 0.11, .3, 'square', .09));
      [C, E, G, C2].forEach(f => note(f, 1.15, 1.6, 'sawtooth', .04));
      [C2, E2, G2].forEach(f => note(f, 1.15, 1.6, 'triangle', .12));
    }
  }
  function tick2() { note(880, 0, .08, 'sine', .07); }

  return { confetti, fanfare, click: tick2, unlock: audio };
})();
