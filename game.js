(function () {
  'use strict';

  // ============================================================
  // Setup
  // ============================================================
  const canvas = document.getElementById('game');
  const screenCtx = canvas.getContext('2d');
  screenCtx.imageSmoothingEnabled = false;
  const W = canvas.width, H = canvas.height;

  // Render into a low-res buffer, then blit it up with smoothing off --
  // that's what gives the genuine chunky-pixel look.
  const PIXEL_SCALE = 2;
  const BW = Math.round(W / PIXEL_SCALE), BH = Math.round(H / PIXEL_SCALE);
  const buf = document.createElement('canvas');
  buf.width = BW; buf.height = BH;
  const ctx = buf.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.scale(1 / PIXEL_SCALE, 1 / PIXEL_SCALE);

  const GROUND_Y = 400;
  const BAND_TOP = GROUND_Y - 60;
  const BAND_BOTTOM = GROUND_Y + 70;
  const GRAVITY = 0.7;
  const MAX_ENGAGED = 2;

  // --- Depth rules (the heart of "slick" beat-'em-up feel) --------------
  // Deliberately asymmetric, exactly like Turtles in Time: YOUR attacks
  // connect on a forgiving depth band so you rarely whiff by a hair, while
  // enemy fire uses a tight band so a small step up or down slips the line.
  const DEPTH_PLAYER_ATTACK = 42;
  const DEPTH_ENEMY_MELEE = 26;
  const DEPTH_PROJECTILE = 14;   // a ~15px nudge is enough to dodge
  const DEPTH_GRAB = 32;

  // ============================================================
  // Sound (procedural Web Audio -- no asset files needed)
  // ============================================================
  const SFX = (() => {
    let actx = null, master = null, enabled = true;
    function ensure() {
      if (!actx) {
        try {
          actx = new (window.AudioContext || window.webkitAudioContext)();
          master = actx.createGain();
          master.gain.value = 0.35;
          master.connect(actx.destination);
        } catch (e) { enabled = false; }
      }
      if (actx && actx.state === 'suspended') actx.resume();
    }
    function tone(freq, dur, type, vol, slideTo) {
      if (!enabled || !actx) return;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, actx.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), actx.currentTime + dur);
      g.gain.setValueAtTime(vol == null ? 0.2 : vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g); g.connect(master);
      o.start(); o.stop(actx.currentTime + dur + 0.02);
    }
    function noise(dur, vol, freq) {
      if (!enabled || !actx) return;
      const n = Math.floor(actx.sampleRate * dur);
      const b = actx.createBuffer(1, n, actx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = actx.createBufferSource(); s.buffer = b;
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 900;
      const g = actx.createGain(); g.gain.value = vol == null ? 0.25 : vol;
      s.connect(f); f.connect(g); g.connect(master);
      s.start();
    }
    return {
      ensure,
      getCtx: () => actx,
      whiff() { noise(0.09, 0.07, 1600); },
      hit() { noise(0.10, 0.30, 700); tone(150, 0.09, 'square', 0.18, 70); },
      heavy() { noise(0.16, 0.36, 420); tone(95, 0.16, 'square', 0.24, 45); },
      ko() { tone(320, 0.30, 'square', 0.20, 70); noise(0.20, 0.20, 500); },
      hurt() { tone(220, 0.16, 'sawtooth', 0.18, 110); },
      jump() { tone(380, 0.10, 'square', 0.10, 640); },
      dash() { noise(0.12, 0.10, 2200); },
      grab() { tone(500, 0.06, 'square', 0.12); },
      throwIt() { tone(260, 0.22, 'square', 0.18, 780); noise(0.10, 0.14, 1400); },
      pickup() { tone(660, 0.07, 'square', 0.16); setTimeout(() => tone(880, 0.09, 'square', 0.16), 70); },
      special() { tone(180, 0.34, 'sawtooth', 0.22, 900); noise(0.22, 0.18, 1800); },
      slam() { tone(70, 0.34, 'square', 0.28, 35); noise(0.30, 0.30, 300); },
      fire() { tone(420, 0.13, 'sawtooth', 0.12, 200); },
      levelUp() { [520, 660, 780, 1040].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'square', 0.16), i * 90)); },

      // --- the three real bits, each with its own signature sound ---
      // Andy: "Welcome In" -- a rising crowd-hype swell, like a host bringing
      // the room up before the intro music hits.
      welcomeIn() {
        noise(0.5, 0.14, 2600);
        [260, 330, 415, 520].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.16), i * 60));
      },
      // Jason: #FootClan Mailbag -- a quick paper-shuffle sting then a chime,
      // like flipping open a letter before he "answers" it.
      mailbag() {
        noise(0.14, 0.12, 3400);
        setTimeout(() => tone(740, 0.1, 'square', 0.14), 90);
        setTimeout(() => tone(980, 0.12, 'square', 0.15), 170);
      },
      // Mike: an actual power-chord riff -- root + fifth, two quick chugs.
      riff() {
        [110, 165].forEach((f) => tone(f, 0.14, 'sawtooth', 0.16));
        setTimeout(() => { [110, 165].forEach((f) => tone(f, 0.14, 'sawtooth', 0.16)); }, 150);
        setTimeout(() => { [147, 220].forEach((f) => tone(f, 0.22, 'sawtooth', 0.18, 90)); }, 320);
      },
      // every regular Mike hit lands as a muted guitar-body thwack, not a fist thud
      guitarHit() { noise(0.08, 0.16, 1100); tone(180, 0.08, 'sawtooth', 0.14, 90); },
    };
  })();

  // ============================================================
  // Music (procedural step-sequenced loops, one per theme -- shares
  // SFX's AudioContext so there's a single audio graph and a single
  // browser-autoplay unlock gate)
  // ============================================================
  const Music = (() => {
    let master = null, timer = null, nextTime = 0, step = 0, track = null, trackKey = null, started = false;
    const LOOKAHEAD = 0.12, POLL_MS = 30;

    function note(n) { return 440 * Math.pow(2, n / 12); }

    function ensureMaster() {
      const c = SFX.getCtx();
      if (!c) return null;
      if (!master) {
        master = c.createGain();
        master.gain.value = 0.14;
        master.connect(c.destination);
      }
      return c;
    }

    function toneAt(c, time, freq, dur, type, vol) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(vol, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      o.connect(g); g.connect(master);
      o.start(time); o.stop(time + dur + 0.02);
    }

    function hatAt(c, time, vol) {
      const n = Math.floor(c.sampleRate * 0.045);
      const b = c.createBuffer(1, n, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
      const g = c.createGain(); g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(master);
      s.start(time);
    }

    // Semitone offsets from A4. Each pattern is one 16-step (4/4, 16th-note) bar.
    const TRACKS = {
      title: { bpm: 96, bassWave: 'triangle', leadWave: 'square', bassDur: 0.5, leadDur: 0.22,
        bass: [-24,null,null,null, -24,null,-21,null, -19,null,null,null, -19,null,-17,null],
        lead: [null,null,-12,null, null,-9,null,null, null,null,-7,null, -5,null,null,null],
        hats: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], hatVol: 0.045 },
      draft: { bpm: 132, bassWave: 'square', leadWave: 'sawtooth', bassDur: 0.16, leadDur: 0.14,
        bass: [-19,null,-19,null, -16,null,-19,null, -14,null,-14,null, -16,null,-19,null],
        lead: [null,-7,null,null, -5,null,null,-7, null,-2,null,null, -4,null,null,-7],
        hats: [1,1,0,1, 1,0,1,1, 1,1,0,1, 1,0,1,1], hatVol: 0.05 },
      swamp: { bpm: 88, bassWave: 'sine', leadWave: 'triangle', bassDur: 0.6, leadDur: 0.5,
        bass: [-24,null,null,null, null,null,-21,null, null,null,null,null, -22,null,null,null],
        lead: [null,null,null,-12, null,null,null,null, -13,null,null,null, null,null,-9,null],
        hats: [0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,1,0], hatVol: 0.03 },
      vegas: { bpm: 118, bassWave: 'square', leadWave: 'sawtooth', bassDur: 0.16, leadDur: 0.14,
        bass: [-14,null,-12,null, -9,null,-12,null, -7,null,-9,null, -12,null,-14,null],
        lead: [null,0,null,3, null,0,null,null, 5,null,3,null, null,0,null,7],
        hats: [1,0,1,1, 0,1,0,1, 1,0,1,0, 1,1,0,1], hatVol: 0.05 },
      colosseum: { bpm: 110, bassWave: 'triangle', leadWave: 'square', bassDur: 0.3, leadDur: 0.24,
        bass: [-14,null,null,-14, null,null,-9,null, -14,null,null,-14, null,-7,null,null],
        lead: [null,null,2,null, null,null,7,null, null,null,2,null, 5,null,7,null],
        hats: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0], hatVol: 0.05 },
      boss: { bpm: 144, bassWave: 'sawtooth', leadWave: 'square', bassDur: 0.13, leadDur: 0.12,
        bass: [-22,-22,null,-22, null,-19,null,-22, -17,-17,null,-17, null,-19,null,-22],
        lead: [-10,null,-7,null, -3,null,-7,null, -10,null,-5,null, -2,null,-7,null],
        hats: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1], hatVol: 0.04 },
    };

    function scheduler() {
      const c = SFX.getCtx();
      if (!c || !track) return;
      const stepDur = 60 / track.bpm / 4;
      while (nextTime < c.currentTime + LOOKAHEAD) {
        const i = step % 16;
        const b = track.bass[i];
        if (b != null) toneAt(c, nextTime, note(b), track.bassDur, track.bassWave, 0.5);
        const l = track.lead[i];
        if (l != null) toneAt(c, nextTime, note(l), track.leadDur, track.leadWave, 0.22);
        if (track.hats[i]) hatAt(c, nextTime, track.hatVol);
        nextTime += stepDur;
        step++;
      }
      timer = setTimeout(scheduler, POLL_MS);
    }

    function play(key) {
      const c = ensureMaster();
      if (!c || !TRACKS[key]) return;
      if (trackKey === key && started) return;
      stop();
      track = TRACKS[key];
      trackKey = key; started = true;
      step = 0; nextTime = c.currentTime + 0.05;
      scheduler();
    }

    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      started = false; trackKey = null;
    }

    function setVolume(v) { if (master) master.gain.value = v; }

    return { play, stop, setVolume };
  })();

  // ============================================================
  // Input (with double-tap detection for dashes)
  // ============================================================
  const keys = new Set();
  const justPressed = new Set();
  const lastTapAt = {};
  const lastKeyDownAt = {};
  let doubleTapDir = 0, doubleTapAt = 0;
  let jkComboReady = false, jkComboAt = 0;

  const HANDLED = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
    'KeyJ', 'KeyK', 'KeyL', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];

  window.addEventListener('keydown', (e) => {
    SFX.ensure();
    if (!keys.has(e.code)) {
      justPressed.add(e.code);
      const now = performance.now();
      const dir = (e.code === 'ArrowRight' || e.code === 'KeyD') ? 1
        : (e.code === 'ArrowLeft' || e.code === 'KeyA') ? -1 : 0;
      if (dir !== 0) {
        if (lastTapAt[dir] && now - lastTapAt[dir] < 260) { doubleTapDir = dir; doubleTapAt = now; }
        lastTapAt[dir] = now;
      }
      // J+K near-simultaneous, detected here (not per-frame) so a human's two
      // presses landing a frame or two apart -- or even the first one already
      // having fired a solo jab -- still register as the signature-move input.
      if (e.code === 'KeyJ' || e.code === 'KeyK') {
        const other = e.code === 'KeyJ' ? 'KeyK' : 'KeyJ';
        if (lastKeyDownAt[other] !== undefined && now - lastKeyDownAt[other] < 160) {
          jkComboReady = true; jkComboAt = now;
        }
        lastKeyDownAt[e.code] = now;
      }
    }
    keys.add(e.code);
    if (HANDLED.includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  function pressed(code) { return keys.has(code); }
  function tapped(code) { return justPressed.has(code); }
  function consumeDoubleTap() {
    if (doubleTapDir !== 0 && performance.now() - doubleTapAt < 200) {
      const d = doubleTapDir; doubleTapDir = 0; return d;
    }
    return 0;
  }
  function consumeJkCombo() {
    if (jkComboReady && performance.now() - jkComboAt < 260) { jkComboReady = false; return true; }
    jkComboReady = false;
    return false;
  }

  // ============================================================
  // Utility
  // ============================================================
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(min, max) { return Math.random() * (max - min) + min; }

  // Directional melee test: target must be in front, within range, and in depth band.
  function meleeHits(ax, ay, facing, tx, ty, range, depth) {
    const dx = (tx - ax) * facing;
    return dx > -16 && dx < range && Math.abs(ty - ay) <= depth;
  }
  function pointHits(px_, py_, tx, ty, xTol, depth) {
    return Math.abs(px_ - tx) <= xTol && Math.abs(py_ - ty) <= depth;
  }

  // ============================================================
  // Sprites (real hand-drawn CC0 pixel-art frames)
  // ============================================================
  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  // Speech/callout bubble: targets 5x baseSize for punchy short lines, but
  // auto-shrinks (down to a 2x floor) and word-wraps rather than blindly
  // scaling -- a literal 5x on a full-sentence boss line would run well
  // past the edges of the render buffer.
  function drawBubble(ctx, cx, cy, text, opts) {
    const { baseSize = 10, maxWidth = 300, fg = '#fff', bg = '#0d0d18', stroke = '#5c6480', pad = 6 } = opts || {};
    let size = baseSize * 5;
    const floor = baseSize * 2;
    ctx.textAlign = 'center';
    ctx.font = 'bold ' + size + 'px monospace';
    while (size > floor && ctx.measureText(text).width > maxWidth) {
      size -= 2;
      ctx.font = 'bold ' + size + 'px monospace';
    }
    let lines;
    if (ctx.measureText(text).width <= maxWidth) lines = [text];
    else {
      const words = text.split(' ');
      let line = ''; lines = [];
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
        else line = test;
      }
      if (line) lines.push(line);
    }
    const lh = size * 1.2;
    let maxLineW = 0;
    for (const l of lines) maxLineW = Math.max(maxLineW, ctx.measureText(l).width);
    const boxW = maxLineW + pad * 2, boxH = lines.length * lh + pad * 1.4;
    // clamp so a tall/wide box near a level edge or a big enemy never clips
    // off-screen -- better to slide over a little than lose the text
    const margin = 10;
    let ecx = clamp(cx, margin + boxW / 2, W - margin - boxW / 2);
    const boxTop = Math.max(88, cy - boxH + lh * 0.3);
    if (bg) px(ctx, ecx - boxW / 2, boxTop, boxW, boxH, bg);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(ecx - boxW / 2, boxTop, boxW, boxH); }
    ctx.fillStyle = fg;
    lines.forEach((l, i) => ctx.fillText(l, ecx, boxTop + pad * 0.9 + (i + 1) * lh - lh * 0.25));
    ctx.textAlign = 'left';
  }

  // Two free "Brawler Series" rigs by chasersgaming (CC0, opengameart.org),
  // explicitly built in the Double Dragon / Streets of Rage mold.
  const SPRITE_SETS = {
    ranger: {
      idle: { src: 'assets/ranger/idle_strip4.png', frames: 4, fps: 4.5 },
      walk: { src: 'assets/ranger/walk_strip4.png', frames: 4, fps: 10 },
      punch1: { src: 'assets/ranger/punch_1.png', frames: 1 },
      punch2: { src: 'assets/ranger/punch_2.png', frames: 1 },
      kick1: { src: 'assets/ranger/kick_1.png', frames: 1 },
      kick2: { src: 'assets/ranger/kick_2.png', frames: 1 },
      hurt: { src: 'assets/ranger/hurt.png', frames: 1 },
      knockdown: { src: 'assets/ranger/knockdown.png', frames: 1 },
      special: { src: 'assets/ranger/special_strip2.png', frames: 2, fps: 8 },
    },
    renegade: {
      idle: { src: 'assets/renegade/idle_strip4.png', frames: 4, fps: 4.5 },
      walk: { src: 'assets/renegade/walk_strip4.png', frames: 4, fps: 10 },
      punch1: { src: 'assets/renegade/punch_1.png', frames: 1 },
      punch2: { src: 'assets/renegade/punch_2.png', frames: 1 },
      kick1: { src: 'assets/renegade/kick_1.png', frames: 1 },
      kick2: { src: 'assets/renegade/kick_2.png', frames: 1 },
      hurt: { src: 'assets/renegade/hurt.png', frames: 1 },
      knockdown: { src: 'assets/renegade/knockdown.png', frames: 1 },
      special: { src: 'assets/renegade/special_strip2.png', frames: 2, fps: 8 },
    },
  };

  const IMAGES = {};
  function loadSprites() {
    const promises = [];
    for (const setKey in SPRITE_SETS) {
      for (const animKey in SPRITE_SETS[setKey]) {
        const def = SPRITE_SETS[setKey][animKey];
        if (IMAGES[def.src]) continue;
        const img = new Image();
        const rec = { img, loaded: false, frameW: 0, frameH: 0 };
        IMAGES[def.src] = rec;
        promises.push(new Promise((resolve) => {
          img.onload = () => {
            rec.frameW = img.naturalWidth / def.frames;
            rec.frameH = img.naturalHeight;
            rec.loaded = true;
            resolve();
          };
          img.onerror = resolve;
        }));
        img.src = def.src;
      }
    }
    return Promise.all(promises);
  }

  function pickAnim(spriteKey, pose, progress, t, comboStep, variant) {
    const set = SPRITE_SETS[spriteKey];
    switch (pose) {
      case 'walk': {
        const d = set.walk;
        return { def: d, frame: Math.floor((t / 1000) * d.fps) % d.frames };
      }
      case 'dash': {
        const d = set.walk;
        return { def: d, frame: Math.floor((t / 1000) * (d.fps * 1.8)) % d.frames };
      }
      case 'punch':
        // combo finisher reads as a big kick; jabs alternate hands
        if (comboStep === 2) return { def: progress < 0.4 ? set.kick1 : set.kick2, frame: 0 };
        if (comboStep === 1) return { def: progress < 0.4 ? set.punch2 : set.punch1, frame: 0 };
        return { def: progress < 0.4 ? set.punch1 : set.punch2, frame: 0 };
      case 'kick': return { def: progress < 0.4 ? set.kick1 : set.kick2, frame: 0 };
      case 'dashatk': return { def: set.punch2, frame: 0 };
      // jump attacks read differently per host: Andy dives fist-first, Jason
      // is mid-spin (rotation applied by the caller), Mike swings the guitar
      // (the kick frame just gives his arms the right silhouette for it).
      case 'jumpatk':
        if (variant === 'andy') return { def: progress < 0.5 ? set.punch1 : set.punch2, frame: 0 };
        if (variant === 'jason') return { def: set.kick1, frame: 0 };
        return { def: set.kick2, frame: 0 };
      case 'grab': return { def: set.punch1, frame: 0 };
      case 'throw': return { def: set.kick1, frame: 0 };
      case 'special':
        // Andy's special is a spinning kick, not the generic flourish --
        // the spin itself is a render-time-only rotation (see render()).
        if (variant === 'andy') return { def: progress < 0.5 ? set.kick1 : set.kick2, frame: 0 };
        return { def: set.special, frame: progress < 0.5 ? 0 : 1 };
      // the J+K signature move: Andy's rapid-cycling flurry frames, Jason's
      // leap-then-slam reusing the lunge strip, Mike's big overhead swing.
      case 'signature':
        if (variant === 'andy') return { def: Math.floor(t / 60) % 2 ? set.punch1 : set.punch2, frame: 0 };
        if (variant === 'jason') return { def: set.special, frame: progress < 0.55 ? 0 : 1 };
        return { def: set.punch2, frame: 0 };
      case 'hurt': return { def: set.hurt, frame: 0 };
      case 'knockdown': return { def: set.knockdown, frame: 0 };
      default: {
        const d = set.idle;
        return { def: d, frame: Math.floor((t / 1000) * d.fps) % d.frames };
      }
    }
  }

  const SPRITE_DISPLAY_SCALE = 3;

  // Attack poses swing the guitar as a weapon; everything else keeps it slung.
  const ATTACK_POSES = new Set(['punch', 'kick', 'dashatk', 'jumpatk', 'signature', 'special']);

  // Canvas rotate(θ) sends a local point (0, L) -- "straight down" before any
  // spin -- to parent-space position (-L·sinθ, L·cosθ). Every angle below was
  // picked by solving that equation for the direction I actually wanted, not
  // by eyeballing a number, after the first version turned out to swing the
  // guitar backward at the exact moment it was supposed to connect.
  function drawGuitar(ctx, scale, mode, progress) {
    const s = scale;
    ctx.save();
    if (mode === 'slung') {
      // strapped across his back: pivot near the shoulder blade, whole
      // instrument hangs down and BACKWARD (θ = +0.55 -> parent x is negative)
      ctx.translate(-4 * s, -50 * s);
      ctx.rotate(0.55);
      px(ctx, -3.5 * s, -10 * s, 7 * s, 26 * s, '#5a3018');   // neck
      px(ctx, -3.5 * s, -10 * s, 7 * s, 4 * s, '#e8d9b8');    // headstock, peeks over the shoulder
      px(ctx, -9 * s, 14 * s, 18 * s, 20 * s, '#a6521f');     // body, hangs behind his hip
      px(ctx, -3 * s, 21 * s, 6 * s, 6 * s, '#241408');       // sound hole
    } else {
      // three real keyframes -- cocked back-and-up, full extension forward,
      // settle to a forward-down rest. Timed to the exact same breakpoints
      // (0.22 / 0.42) as the body's own anticipation/snap/settle transform
      // in drawSprite, so the guitar snaps forward in the same instant the
      // body does -- it reads as part of his arm, not a separate pendulum.
      const BACK_UP = 2.35;    // -> parent (-0.71L, -0.71L): behind him, raised
      const FORWARD = -1.25;   // -> parent (+0.95L, +0.32L): out in front, low
      const REST = -0.30;      // -> parent (+0.30L, +0.95L): hanging, slight forward lean
      const p = clamp(progress, 0, 1);
      let ang, reach;
      if (p < 0.22) {
        const q = p / 0.22;
        ang = BACK_UP; reach = 1 - 0.15 * q; // slight pull-in during anticipation
      } else if (p < 0.42) {
        const q = (p - 0.22) / 0.2;
        const e = q * q * (3 - 2 * q); // smoothstep -- a whip, not a linear crawl
        ang = BACK_UP + (FORWARD - BACK_UP) * e;
        reach = 0.85 + 0.3 * e; // thrusts outward as it snaps -- an extension, not a hinge
      } else {
        const q = clamp((p - 0.42) / 0.58, 0, 1);
        ang = FORWARD + (REST - FORWARD) * q;
        reach = 1.15 - 0.15 * q;
      }
      ctx.translate(11 * s * reach, -58 * s);
      ctx.rotate(ang);
      px(ctx, -3.5 * s, 0, 7 * s, 26 * s, '#5a3018');         // neck, grip end
      px(ctx, -3.5 * s, -5 * s, 7 * s, 5 * s, '#e8d9b8');
      px(ctx, -10 * s, 22 * s, 20 * s, 22 * s, '#c2551c');    // body -- the business end
      px(ctx, -3 * s, 30 * s, 6 * s, 6 * s, '#241408');
      ctx.strokeStyle = '#f2e9d0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-1.5 * s, 2); ctx.lineTo(-1.5 * s, 44 * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1.5 * s, 2); ctx.lineTo(1.5 * s, 44 * s); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSprite(ctx, footX, footY, opts) {
    const {
      facing = 1, scale = 1, spriteKey = 'ranger', tint = '', pose = 'idle', t = 0, progress = 0,
      hurt = false, jumpZ = 0, flash = false, glasses = false, cap = false, guitar = false,
      vikingHat = false, beard = false, comboStep = 0, spin = 0, variant = null,
    } = opts;

    const { def, frame } = pickAnim(spriteKey, pose, progress, t, comboStep, variant);
    const rec = IMAGES[def.src];
    if (!rec || !rec.loaded) return;

    const s = scale * SPRITE_DISPLAY_SCALE;
    const dispW = rec.frameW * s, dispH = rec.frameH * s;

    ctx.save();
    ctx.translate(footX, footY - jumpZ);

    // ground shadow shrinks as you rise -- cheap but sells the height
    const shrink = clamp(1 - jumpZ / 260, 0.45, 1);
    ctx.globalAlpha = 0.35 * shrink;
    ctx.beginPath();
    ctx.ellipse(0, 2 + jumpZ, 15 * scale * shrink, 5 * scale * shrink, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.globalAlpha = 1;

    if (facing < 0) ctx.scale(-1, 1);
    if (spin) ctx.rotate(spin);

    // --- secondary procedural motion ------------------------------------
    // The sprite pack only ships 4-frame idle/walk and single-frame attack
    // poses. Rather than fake extra in-between frames (which mushes crisp
    // pixel art), layer squash/stretch and a lean onto the transform: real
    // anticipation and follow-through on top of the same source frames.
    let bobY = 0, sx = 1, sy = 1, lean = 0;
    if (pose === 'walk') {
      bobY = -Math.abs(Math.sin(t * 0.012)) * 2.4 * scale;
    } else if (pose === 'idle') {
      sy = 1 + Math.sin(t * 0.004) * 0.015;
    } else if (ATTACK_POSES.has(pose)) {
      const p = clamp(progress, 0, 1);
      if (p < 0.22) {
        const q = p / 0.22;
        sx = 1 - 0.09 * q; sy = 1 + 0.04 * q;
      } else if (p < 0.42) {
        const q = (p - 0.22) / 0.2, e = q * (2 - q);
        sx = 0.91 + 0.27 * e; sy = 0.95 - 0.05 * e; lean = 0.05 * e;
      } else {
        const q = clamp((p - 0.42) / 0.3, 0, 1);
        sx = 1.18 - 0.18 * q; sy = 0.90 + 0.10 * q; lean = 0.05 * (1 - q);
      }
    }
    if (hurt) lean += Math.sin(t * 0.09) * 0.05;
    ctx.translate(0, bobY);
    ctx.scale(sx, sy);
    if (lean) ctx.rotate(lean);

    if (guitar && !ATTACK_POSES.has(pose)) drawGuitar(ctx, scale, 'slung', progress);

    let filter = tint || '';
    if (flash) filter = (filter + ' brightness(2.6) saturate(0.15)').trim();
    else if (hurt) filter = (filter + ' brightness(1.8) saturate(0.4)').trim();
    if (filter) ctx.filter = filter;

    ctx.drawImage(rec.img, frame * rec.frameW, 0, rec.frameW, rec.frameH, -dispW / 2, -dispH, dispW, dispH);
    ctx.filter = 'none';

    if (glasses) {
      const gy = -dispH + 9 * scale;
      px(ctx, -9 * scale, gy, 7 * scale, 5 * scale, '#141414');   // left lens
      px(ctx, 2 * scale, gy, 7 * scale, 5 * scale, '#141414');    // right lens
      px(ctx, -2 * scale, gy + 1 * scale, 4 * scale, 2 * scale, '#141414'); // bridge
    }
    if (cap) {
      // Ball cap. First pass only perched above the head and read as a thin
      // line, because Andy's rig has genuinely voluminous hair -- confirmed
      // by actually looking at a screenshot, not guessed. The crown now has
      // to reach deep enough to cover that hair mass, not just sit on top of
      // it, or it never reads as "wearing a hat" at all. Brim only projects
      // toward local +x (the facing direction) -- the canvas is already
      // mirrored for left-facing by this point, so no manual flip needed.
      const top = -dispH;
      px(ctx, -8 * scale, top - 2 * scale, 16 * scale, 6 * scale, '#1f3a8a');   // crown, upper
      px(ctx, -11 * scale, top + 3 * scale, 22 * scale, 8 * scale, '#1f3a8a');  // crown, base -- deep coverage
      px(ctx, -6 * scale, top + 4 * scale, 11 * scale, 3 * scale, '#ffd23f');   // accent band
      px(ctx, 4 * scale, top + 8 * scale, 13 * scale, 4 * scale, '#16296b');    // brim, forward only
    }
    if (vikingHat) {
      // metal dome (deep enough to fully cover the hair mass, not just
      // perch on top) + a nose guard so it unmistakably reads as a helmet,
      // not a hat, plus BIG three-segment horns clear of the head.
      const top = -dispH;
      px(ctx, -8 * scale, top - 1 * scale, 16 * scale, 12 * scale, '#8a94a3');  // dome, deep coverage
      px(ctx, -8 * scale, top - 1 * scale, 16 * scale, 3 * scale, '#b8c2d1');   // highlight
      px(ctx, -6 * scale, top + 10 * scale, 12 * scale, 3 * scale, '#5a6472');  // rim
      px(ctx, -1.5 * scale, top + 11 * scale, 3 * scale, 9 * scale, '#5a6472'); // nose guard
      px(ctx, -13 * scale, top, 5 * scale, 7 * scale, '#e8dcc0');              // horn L: base
      px(ctx, -17 * scale, top - 6 * scale, 5 * scale, 7 * scale, '#e8dcc0');  //         mid
      px(ctx, -21 * scale, top - 12 * scale, 5 * scale, 6 * scale, '#d9cba8'); //         tip
      px(ctx, 8 * scale, top, 5 * scale, 7 * scale, '#e8dcc0');                // horn R: base
      px(ctx, 12 * scale, top - 6 * scale, 5 * scale, 7 * scale, '#e8dcc0');   //         mid
      px(ctx, 16 * scale, top - 12 * scale, 5 * scale, 6 * scale, '#d9cba8');  //         tip
    }
    if (beard) {
      const top = -dispH;
      const c = opts.beardColor || '#241408';
      px(ctx, -7 * scale, top + 13 * scale, 14 * scale, 9 * scale, c);   // jawline mass
      px(ctx, -5 * scale, top + 20 * scale, 10 * scale, 7 * scale, c);   // chin taper
      px(ctx, -3 * scale, top + 25 * scale, 6 * scale, 4 * scale, c);    // point
      if (opts.beardLong) {
        // an old man's beard: keeps going well past the chin
        px(ctx, -4 * scale, top + 28 * scale, 8 * scale, 8 * scale, c);
        px(ctx, -2.5 * scale, top + 35 * scale, 5 * scale, 6 * scale, c);
      }
    }
    if (opts.bolt) {
      // a lightning bolt on the chest -- a simple zigzag of small blocks
      const top = -dispH;
      const bc = '#f4e04d';
      px(ctx, -1 * scale, top + 18 * scale, 5 * scale, 4 * scale, bc);
      px(ctx, -4 * scale, top + 21 * scale, 5 * scale, 4 * scale, bc);
      px(ctx, -1 * scale, top + 24 * scale, 5 * scale, 4 * scale, bc);
      px(ctx, -3 * scale, top + 27 * scale, 4 * scale, 3 * scale, bc);
    }

    if (guitar && ATTACK_POSES.has(pose)) drawGuitar(ctx, scale, 'swing', progress);

    if (pose === 'special') {
      ctx.globalAlpha = 0.2 + (0.5 + Math.sin(t * 0.03) * 0.5) * 0.25;
      ctx.beginPath();
      ctx.arc(0, -dispH * 0.6, 30 * scale, 0, Math.PI * 2);
      ctx.fillStyle = opts.accent || '#ffd23f';
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawVulture(ctx, x, y, t, facing) {
    ctx.save();
    ctx.translate(x, y);
    if (facing < 0) ctx.scale(-1, 1);
    const flap = Math.sin(t * 0.03) * 10;
    ctx.globalAlpha = 0.3;
    px(ctx, -16, 30, 32, 5, '#000');
    ctx.globalAlpha = 1;
    px(ctx, -18, -flap, 16, 5, '#4a3b2a');
    px(ctx, 2, -flap, 16, 5, '#4a3b2a');
    px(ctx, -6, -4, 12, 14, '#5c4a35');
    px(ctx, -3, -14, 8, 10, '#c9b896');
    px(ctx, 2, -12, 4, 3, '#d94f4f');
    ctx.restore();
  }

  // Fourth boss is a giant shark -- no sprite pack has one, so he's drawn
  // from scratch out of primitives, same technique as the final boss.
  function drawSharkBoss(ctx, e, camX) {
    const x = e.x - camX, y = e.y - (e.jumpZ || 0);
    const s = e.def.size || 1;
    ctx.save();
    ctx.translate(x, y);
    if (e.facing < 0) ctx.scale(-1, 1);

    ctx.globalAlpha = 0.35;
    px(ctx, -46 * s, 4, 92 * s, 12, '#000');
    ctx.globalAlpha = 1;

    if (e.flashTimer > 0) ctx.filter = 'brightness(2.4) saturate(0.3)';
    else if (e.hurtTimer > 0 && Math.floor(e.t / 70) % 2 === 0) ctx.filter = 'brightness(1.8) saturate(0.4)';

    ctx.translate(0, Math.sin(e.t * 0.006) * 3 * s);

    const top = '#5c6b78', belly = '#c9d4d8', fin = '#3f4c56';

    px(ctx, -46 * s, -22 * s, 10 * s, 16 * s, top);       // tail base
    px(ctx, -52 * s, -32 * s, 9 * s, 12 * s, fin);         // tail fin, upper lobe
    px(ctx, -52 * s, -12 * s, 9 * s, 9 * s, fin);          // tail fin, lower lobe
    px(ctx, -36 * s, -30 * s, 60 * s, 30 * s, top);        // body
    px(ctx, -36 * s, -6 * s, 60 * s, 10 * s, belly);       // pale belly
    px(ctx, -14 * s, -47 * s, 6 * s, 11 * s, fin);          // dorsal fin, spine
    px(ctx, -19 * s, -40 * s, 15 * s, 8 * s, fin);          // dorsal fin, sail
    px(ctx, 4 * s, -9 * s, 17 * s, 9 * s, fin);             // pectoral fin
    px(ctx, 18 * s, -28 * s, 24 * s, 24 * s, top);          // head
    px(ctx, 38 * s, -22 * s, 11 * s, 15 * s, top);          // snout tip

    for (const gx of [20, 25, 30]) px(ctx, gx * s, -22 * s, 2 * s, 14 * s, '#2a333a'); // gill slits

    px(ctx, 30 * s, -24 * s, 4 * s, 4 * s, '#fff'); // eye white
    px(ctx, 31 * s, -23 * s, 2 * s, 2 * s, '#000'); // eye pupil

    // mouth -- yawns open wide for the bite attack, otherwise a narrow line
    const jaw = (e.biting ? 11 : 3) * s;
    px(ctx, 18 * s, -6 * s, 31 * s, jaw, '#8c2020');
    for (let i = 0; i < 5; i++) {
      px(ctx, (20 + i * 6) * s, -6 * s, 3 * s, 3 * s, '#fff');            // upper teeth
      px(ctx, (20 + i * 6) * s, -6 * s + jaw - 3 * s, 3 * s, 3 * s, '#fff'); // lower teeth
    }

    ctx.filter = 'none';
    ctx.restore();
  }

  // The final boss's body IS a giant "2" -- and, for the finale, two "5"s.
  // Both drawn from the same local origin so callers just translate first.
  function draw2Glyph(ctx, bodyColor, outline) {
    px(ctx, -34, -84, 68, 16, bodyColor);   // top bar
    px(ctx, 14, -70, 20, 18, bodyColor);    // right shoulder
    px(ctx, -2, -54, 20, 18, bodyColor);    // diagonal, upper
    px(ctx, -18, -38, 20, 18, bodyColor);   // diagonal, lower
    px(ctx, -34, -14, 68, 16, bodyColor);   // bottom bar
    if (outline) {
      ctx.globalAlpha = 0.25;
      px(ctx, -34, -84, 68, 4, outline);
      ctx.globalAlpha = 1;
    }
  }
  function draw5Glyph(ctx, bodyColor) {
    px(ctx, -34, -84, 68, 16, bodyColor);   // top bar
    px(ctx, -34, -70, 20, 18, bodyColor);   // left, top-to-middle
    px(ctx, -34, -54, 50, 16, bodyColor);   // middle bar
    px(ctx, 14, -40, 20, 18, bodyColor);    // right, middle-to-bottom
    px(ctx, -34, -14, 68, 16, bodyColor);   // bottom bar
  }

  function drawRunnerUpBoss(ctx, boss, camX, scale) {
    const x = boss.x - camX, y = boss.y - boss.jumpZ;
    const shake = boss.enraged ? rand(-2, 2) : 0;
    const hpRatio = clamp(boss.hp / boss.maxHp, 0, 1);

    ctx.save();
    ctx.translate(x + shake + (boss.recoil || 0), y);
    if (scale && scale !== 1) ctx.scale(scale, scale);

    // shadow tracks the squash so he reads as planted
    ctx.globalAlpha = 0.35;
    px(ctx, -34 * (boss.sx || 1), 4, 68 * (boss.sx || 1), 12, '#000');
    ctx.globalAlpha = 1;

    if (boss.flashTimer > 0) ctx.filter = 'brightness(2.4) saturate(0.3)';

    // idle: heavier, slower breathing as he tires. Beaten down = he sags.
    const tired = 1 - hpRatio;
    const breathe = Math.sin(boss.t * (0.008 + tired * 0.006)) * (2.5 + tired * 2.5);
    const sag = tired * 7;

    const telegraphing = !!boss.attackTelegraph;
    const bodyColor = telegraphing ? '#ff7043' : (boss.enraged ? '#c0392b' : '#3b5bdb');
    const outline = '#1b2a66';

    // squash & stretch drives the whole silhouette
    const sx = boss.sx || 1, sy = boss.sy || 1;
    ctx.translate(0, breathe + sag);
    ctx.scale(sx, sy);

    draw2Glyph(ctx, bodyColor, outline);

    // face plate
    px(ctx, -20, -80, 40, 22, '#f2d9b1');

    // glasses -- frames crack as he loses phases
    px(ctx, -24, -78, 18, 8, '#1a1a1a');
    px(ctx, 6, -78, 18, 8, '#1a1a1a');
    px(ctx, -6, -76, 12, 3, '#1a1a1a');
    px(ctx, -22, -80, 4, 8, '#1a1a1a');
    px(ctx, 22, -80, 4, 8, '#1a1a1a');

    const eye = boss.enraged ? '#ff3b3b' : '#dff';
    px(ctx, -21, -76, 14, 3, eye);
    px(ctx, 7, -76, 14, 3, eye);

    // phase 2: left lens cracked. phase 3: both, and a chip out of the frame.
    if (boss.phase >= 2) {
      px(ctx, -18, -78, 2, 8, '#6d6d6d');
      px(ctx, -14, -76, 2, 5, '#6d6d6d');
    }
    if (boss.phase >= 3) {
      px(ctx, 11, -78, 2, 8, '#6d6d6d');
      px(ctx, 15, -75, 2, 4, '#6d6d6d');
      px(ctx, 20, -80, 4, 3, '#f2d9b1'); // chipped corner
    }

    // arms come out for the slam windup
    if (boss.attackTelegraph === 'slam') {
      px(ctx, -60, -60, 22, 14, bodyColor);
      px(ctx, 38, -60, 22, 14, bodyColor);
    }

    ctx.filter = 'none';
    ctx.restore();

    // trash talk, rendered unscaled above his head
    if (boss.sayTimer > 0 && boss.sayText) {
      ctx.save();
      ctx.globalAlpha = clamp(boss.sayTimer / 400, 0, 1);
      drawBubble(ctx, x, y - 170, boss.sayText, { baseSize: 13, maxWidth: 420, fg: '#ff8c8c', stroke: '#ff4d4d' });
      ctx.restore();
    }
  }

  // ============================================================
  // Backgrounds
  // ============================================================
  const BG_THEMES = {
    draft: { sky: ['#1b2038', '#2c3560'], deco: '#3d4a80', accent: '#f4c542' },
    swamp: { sky: ['#16241c', '#28402f'], deco: '#325a3f', accent: '#7fbf6a' },
    vegas: { sky: ['#1a0f2b', '#3a1a4d'], deco: '#5c2a72', accent: '#ff4fa3' },
    colosseum: { sky: ['#241914', '#3d2a1d'], deco: '#5c3f28', accent: '#d98f3c' },
    boss: { sky: ['#0d0d18', '#1f1030'], deco: '#2a1840', accent: '#ff4d4d' },
  };

  function bgLabel(x, y, w, h, bg, text, textColor) {
    px(ctx, x, y, w, h, bg);
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.fillText(text, x + w / 2, y + h / 2 + 3);
    ctx.textAlign = 'left';
  }

  function loopX(camX, parallax, spacing, worldWidth) {
    const parX = -camX * parallax;
    const n = Math.ceil(worldWidth / spacing) + 4;
    const arr = [];
    for (let i = 0; i < n; i++) arr.push({ i, bx: (i * spacing + (parX % spacing)) - spacing });
    return arr;
  }

  // Each stage gets real silhouettes, not a recolored rectangle -- SOR3/TiT
  // brightness: more going on per screen, punchier accent pops.
  function drawDraftBg(camX, worldWidth, th) {
    for (const { i, bx } of loopX(camX, 0.3, 220, worldWidth)) {
      px(ctx, bx, 150, 96, 230, th.deco);                       // cubicle wall
      px(ctx, bx + 18, 186, 60, 40, '#0a1428');                 // monitor screen
      px(ctx, bx + 22, 193, 44 * (0.5 + 0.5 * Math.sin(i)), 4, th.accent);
      px(ctx, bx + 22, 200, 30, 4, '#5cc8f5');
      px(ctx, bx + 22, 207, 38, 4, th.accent);
      if (i % 3 === 1) px(ctx, bx + 74, 190, 4, 4, '#ff4d4d');  // rec light
      if (i % 4 === 0) bgLabel(bx + 14, 158, 68, 18, '#12182e', 'UDK', th.accent);
    }
    for (const { i, bx } of loopX(camX, 0.6, 150, worldWidth)) {
      ctx.globalAlpha = 0.75;
      px(ctx, bx, 300, 54, 130, th.deco);
      ctx.globalAlpha = 1;
      if (i % 3 === 0) {
        px(ctx, bx + 6, 312, 42, 8, '#f0e3c4');                 // stacked draft boards
        px(ctx, bx + 6, 322, 42, 8, '#f0e3c4');
        px(ctx, bx + 10, 314, 22, 3, '#1b2038');
        px(ctx, bx + 10, 324, 28, 3, '#1b2038');
      } else if (i % 3 === 1) {
        bgLabel(bx + 4, 304, 46, 16, '#3d1f1f', 'FC', '#ff8c8c');
      }
    }
  }

  function drawSwampBg(camX, worldWidth, th) {
    // distant tree-line silhouette so the far layer isn't just bare sky
    ctx.globalAlpha = 0.4;
    for (const { i, bx } of loopX(camX, 0.2, 100, worldWidth)) {
      px(ctx, bx, 210 + (i % 3) * 8, 60, 170, '#0f1a10');
    }
    ctx.globalAlpha = 1;
    const BARK = '#6b5a3f', BARK_HI = '#8a7452'; // warm, desaturated -- reads against the green
    for (const { i, bx } of loopX(camX, 0.3, 240, worldWidth)) {
      px(ctx, bx + 40, 200, 10, 180, BARK);                       // trunk
      px(ctx, bx + 40, 200, 3, 180, BARK_HI);                     // lit edge
      ctx.save(); ctx.translate(bx + 45, 220); ctx.rotate(-0.5);
      px(ctx, 0, 0, 36, 8, BARK); ctx.restore();                  // branch L
      ctx.save(); ctx.translate(bx + 45, 245); ctx.rotate(0.45);
      px(ctx, 0, 0, 32, 7, BARK); ctx.restore();                  // branch R
      ctx.globalAlpha = 0.6;
      for (let m = 0; m < 3; m++) px(ctx, bx + 30 + m * 14, 210 + (i % 3) * 6, 4, 34 + m * 10, '#8fae7c'); // moss
      ctx.globalAlpha = 1;
      if (i % 4 === 2) { // a vulture perched up in the canopy
        px(ctx, bx + 20, 205, 14, 4, '#3a2f22'); px(ctx, bx + 40, 205, 14, 4, '#3a2f22');
        px(ctx, bx + 30, 198, 10, 10, '#4a3b2a');
      }
    }
    for (const { i, bx } of loopX(camX, 0.6, 160, worldWidth)) {
      ctx.globalAlpha = 0.5;
      px(ctx, bx, 330, 60, 100, '#16241c');                      // reed clump backdrop
      ctx.globalAlpha = 1;
      if (i % 2 === 0) {
        ctx.globalAlpha = 0.6 + 0.2 * Math.sin(i * 3);
        px(ctx, bx + 16, 400, 10, 10, '#a9e08a');                // glowing mushroom
        px(ctx, bx + 14, 396, 14, 4, '#7fbf6a');
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 0.3;
      px(ctx, bx, 420, 58, 6, '#8fd3ff');                        // water sheen at the base
      ctx.globalAlpha = 1;
    }
  }

  function drawVegasBg(camX, worldWidth, th) {
    for (const { i, bx } of loopX(camX, 0.3, 210, worldWidth)) {
      if (i % 2 === 0) {
        px(ctx, bx, 170, 70, 210, th.deco);                      // slot machine cabinet
        px(ctx, bx + 10, 190, 50, 34, '#1a0f2b');
        ctx.beginPath(); ctx.arc(bx + 35, 207, 14, 0, Math.PI * 2);
        ctx.fillStyle = i % 4 === 0 ? '#ffd23f' : '#5cc8f5'; ctx.fill();
        px(ctx, bx + 60, 200, 6, 20, '#ff4fa3');                 // lever
        if (i % 6 === 0) bgLabel(bx + 6, 240, 58, 16, '#3a1a4d', 'DFS', th.accent);
      } else {
        px(ctx, bx + 30, 140, 8, 240, '#3a1a4d');                // neon sign pole
        for (let d = 0; d < 5; d++) {
          ctx.globalAlpha = 0.85;
          px(ctx, bx + 26, 150 + d * 20, 16, 4, d % 2 === 0 ? '#ff4fa3' : '#5cc8f5');
          ctx.globalAlpha = 1;
        }
      }
    }
    for (const { i, bx } of loopX(camX, 0.6, 150, worldWidth)) {
      ctx.globalAlpha = 0.7;
      px(ctx, bx, 320, 56, 110, '#2a1533');
      ctx.globalAlpha = 1;
      if (i % 3 === 0) {
        px(ctx, bx + 6, 330, 44, 20, '#123d2b');                 // card table felt
        px(ctx, bx + 12, 322, 10, 14, '#f2e9d0'); px(ctx, bx + 26, 320, 10, 16, '#f2e9d0'); // cards
      } else {
        for (let c = 0; c < 3; c++) px(ctx, bx + 10, 400 - c * 6, 30, 5, c % 2 ? '#ffd23f' : '#ff4fa3'); // chip stack
      }
    }
  }

  function drawColosseumBg(camX, worldWidth, th) {
    for (const { i, bx } of loopX(camX, 0.3, 230, worldWidth)) {
      px(ctx, bx, 190, 100, 190, th.deco);                       // stone tier
      px(ctx, bx, 170, 100, 22, '#4a3320');                      // upper step
      ctx.globalAlpha = 0.6;
      for (let c = 0; c < 10; c++) {
        px(ctx, bx + 6 + (c % 5) * 18, 176 + Math.floor(c / 5) * 200, 5, 6,
          ['#d98f3c', '#c0392b', '#f4c542', '#8a4a2a'][c % 4]);  // crowd dots
      }
      ctx.globalAlpha = 1;
      if (i % 3 === 1) {
        px(ctx, bx + 20, 196, 60, 46, '#6a1414');                 // banner
        bgLabel(bx + 20, 196, 60, 20, '#6a1414', 'MEGA', th.accent);
        bgLabel(bx + 20, 218, 60, 20, '#6a1414', 'BOWL', th.accent);
      }
    }
    for (const { i, bx } of loopX(camX, 0.6, 150, worldWidth)) {
      ctx.globalAlpha = 0.75;
      px(ctx, bx + 18, 260, 18, 170, '#3d2a1d');                  // column shaft
      px(ctx, bx + 12, 254, 30, 10, '#4a3320');                   // capital
      ctx.globalAlpha = 1;
      if (i % 2 === 0) {
        const flick = 0.6 + 0.4 * Math.sin(performance.now() * 0.01 + i);
        ctx.globalAlpha = flick;
        px(ctx, bx + 6, 272, 8, 12, '#ff8c3c');                   // torch flame
        px(ctx, bx + 8, 266, 4, 8, '#ffd23f');
        ctx.globalAlpha = 1;
        px(ctx, bx + 5, 284, 10, 6, '#241408');                   // sconce
      }
    }
  }

  function drawGateBg(camX, worldWidth, th) {
    for (const { i, bx } of loopX(camX, 0.3, 130, worldWidth)) {
      ctx.globalAlpha = 0.55;
      px(ctx, bx, 140, 8, 250, '#1b2a66');                        // iron gate bar
      ctx.globalAlpha = 1;
    }
    for (const { i, bx } of loopX(camX, 0.55, 220, worldWidth)) {
      px(ctx, bx, 160, 70, 230, th.deco);                         // arch pillar
      px(ctx, bx - 6, 150, 82, 14, '#1b2a66');                    // pillar cap
      const flick = 0.5 + 0.4 * Math.sin(performance.now() * 0.008 + i * 2);
      ctx.globalAlpha = flick;
      px(ctx, bx + 28, 190, 10, 14, '#ff4d4d');                   // ember sconce
      ctx.globalAlpha = 1;
    }
  }

  function drawBackground(theme, camX, worldWidth) {
    const th = BG_THEMES[theme];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.sky[0]);
    grad.addColorStop(1, th.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (theme === 'draft') drawDraftBg(camX, worldWidth, th);
    else if (theme === 'swamp') drawSwampBg(camX, worldWidth, th);
    else if (theme === 'vegas') drawVegasBg(camX, worldWidth, th);
    else if (theme === 'colosseum') drawColosseumBg(camX, worldWidth, th);
    else drawGateBg(camX, worldWidth, th);

    // floor band + subtle depth lines so up/down movement reads visually
    px(ctx, 0, GROUND_Y + 76, W, H - (GROUND_Y + 76), '#0c0c14');
    px(ctx, 0, GROUND_Y + 70, W, 8, th.accent);
    ctx.globalAlpha = 0.10;
    for (let yy = BAND_TOP; yy <= BAND_BOTTOM; yy += 22) {
      px(ctx, 0, yy + 72, W, 1, '#fff');
    }
    ctx.globalAlpha = 1;
  }

  // ============================================================
  // Character & enemy definitions
  // ============================================================
  // Combo strings: tap punch repeatedly to chain. Third hit is a finisher
  // that knocks down and leaves the enemy dazed (= grabbable).
  function comboSet(a, b, finish) {
    return [
      { dmg: a, range: 46, dur: 175, strike: 0.22, knock: 7 },
      { dmg: b, range: 48, dur: 180, strike: 0.22, knock: 9 },
      { dmg: finish, range: 56, dur: 290, strike: 0.28, knock: 26, knockdown: true, heavy: true },
    ];
  }

  // Voice, not just stats -- each kit is built around one real, documented bit:
  // Andy opens every show with "Welcome in," Jason hosts the real #FootClan
  // Mailbag segment, and Mike releases the show's actual guitar-driven intro
  // themes (see "TFFB Intros" on Bandcamp). The nicknames are their real ones.
  const CHAR_DEFS = {
    andy: {
      name: 'Andy "Welcome In" Holloway',
      tag: 'Fastest hands. J+K unleashes the Zinger Flurry.',
      spriteKey: 'ranger', tint: '', glasses: false, cap: true, accent: '#ffd23f',
      speed: 3.9, jumpPow: 13.5, maxHealth: 105,
      combo: comboSet(7, 8, 15),
      kick: { dmg: 12, range: 54, dur: 300, strike: 0.28, cd: 340, knock: 20, knockdown: true, heavy: true },
      special: { name: 'Welcome In!', cost: 30, dmg: 26, range: 105, cd: 700, aoe: true, voice: 'welcomeIn' },
      // rapid-fire multi-hit jab burst -- fits "fastest hands" mechanically, not just numerically
      signature: { name: 'Zinger Flurry', dur: 560, strike: 0.05, dmg: 5, range: 50, knock: 4,
        multiHit: true, tickMs: 82, hitboxLife: 470, cd: 1300 },
      throwDmg: 20,
      catch: 'WELCOME IN!',
      victory: '"Welcome in" — to the Listener League.',
    },
    jason: {
      name: 'Jason "Mailbag" Moore',
      tag: 'All-rounder. J+K is a leaping Impression Slam.',
      spriteKey: 'renegade', tint: 'hue-rotate(280deg) saturate(1.3)', glasses: true, accent: '#ffb703',
      speed: 3.4, jumpPow: 14.5, maxHealth: 115,
      combo: comboSet(8, 9, 17),
      kick: { dmg: 13, range: 56, dur: 310, strike: 0.28, cd: 360, knock: 22, knockdown: true, heavy: true },
      special: { name: '#FootClan Mailbag', cost: 35, dmg: 30, range: 999, cd: 800, projectile: true, envelope: true, voice: 'mailbag' },
      // leaps, comes down with a wide AOE slam -- the only move in the game with airtime
      signature: { name: 'Impression Slam', dur: 620, strike: 0.56, dmg: 22, range: 88, knock: 26,
        knockdown: true, heavy: true, aoe: true, cd: 1400 },
      throwDmg: 23,
      catch: '#FOOTCLAN MAILBAG',
      victory: 'That one goes straight to the top of the Mailbag.',
    },
    mike: {
      name: 'Mike "The Fantasy Hitman" Wright',
      tag: 'Heaviest hits, longest reach. J+K drops a Power Chord Smash.',
      spriteKey: 'ranger', tint: 'hue-rotate(190deg) saturate(0.55) brightness(0.7)', glasses: false, beard: true, guitar: true, accent: '#ff3b3b',
      speed: 3.0, jumpPow: 12.5, maxHealth: 135,
      // the guitar is a real weapon: longer reach on every melee hit than fists give Andy/Jason
      combo: comboSet(10, 11, 21).map((h) => ({ ...h, range: h.range + 10 })),
      kick: { dmg: 16, range: 66, dur: 330, strike: 0.30, cd: 400, knock: 26, knockdown: true, heavy: true },
      special: { name: 'The Riff', cost: 40, dmg: 38, range: 999, cd: 900, projectile: true, voice: 'riff' },
      // one huge two-handed overhead smash -- biggest single number in the game
      signature: { name: 'Power Chord Smash', dur: 480, strike: 0.40, dmg: 34, range: 76, knock: 32,
        knockdown: true, heavy: true, cd: 1500 },
      throwDmg: 28,
      catch: 'DROP THE RIFF',
      victory: 'Cue the outro riff. The Hitman clocks out.',
    },
  };

  // Real #FootClan Mailbag-style questions -- Jason "answers" one every time
  // his special fires.
  const MAILBAG_QUESTIONS = [
    'Q: IS IT TOO LATE TO PANIC-DROP?',
    'Q: SHOULD I START MY TE ON A BYE?',
    'Q: CAN I TRADE FOR YOUR RB1?',
    'Q: WHY DID MY KICKER SCORE ZERO?',
    'Q: IS THIS A BUY-LOW OR A DODGE?',
    'Q: HIM, OR A GUY WHO\'S ON BYE?',
  ];

  // Every enemy carries a `trait` -- a behaviour that dramatises its name.
  // The name alone is a setup; the trait is the punchline.
  const ENEMY_DEFS = {
    draftee: { name: 'Rogue Mock-Draftee', hp: 24, speed: 1.7, dmg: 5, atkRange: 44, atkCd: 1000, size: 1,
      spriteKey: 'renegade', tint: 'saturate(0.6) brightness(0.85)', projColor: '#aaa',
      trait: 'reach', points: 100 },
    zombie: { name: 'Waiver-Wire Zombie', hp: 36, speed: 1.0, dmg: 7, atkRange: 42, atkCd: 1300, size: 1.05,
      spriteKey: 'renegade', tint: 'hue-rotate(80deg) saturate(0.8) brightness(0.7)', projColor: '#6a8a52',
      trait: 'scavenge', points: 150 },
    vulture: { name: 'Stat-Vulture', hp: 18, speed: 2.4, dmg: 5, atkRange: 34, atkCd: 950, size: 1, flyer: true,
      trait: 'vulture', points: 120 },
    bookie: { name: 'Shady Bookie', hp: 28, speed: 2.0, dmg: 6, atkRange: 44, atkCd: 950, size: 1,
      spriteKey: 'ranger', tint: 'hue-rotate(250deg) saturate(0.9) brightness(0.8)', projColor: '#ffd23f',
      trait: 'hedge', points: 150 },
    roller: { name: 'Dice Roller', hp: 22, speed: 1.7, dmg: 5, atkRange: 230, atkCd: 1700, size: 1, ranged: true,
      spriteKey: 'ranger', tint: 'hue-rotate(300deg) saturate(1.2)', projColor: '#ff4fa3',
      trait: 'roll', points: 150 },
    rival: { name: 'Rival FootClan Champ', hp: 48, speed: 2.2, dmg: 8, atkRange: 46, atkCd: 850, size: 1.08,
      spriteKey: 'renegade', tint: 'hue-rotate(330deg) saturate(1.3) brightness(0.9)', projColor: '#d98f3c',
      trait: 'counter', points: 250 },
    talker: { name: 'Trash Talker', hp: 32, speed: 1.8, dmg: 5, atkRange: 250, atkCd: 1800, size: 1, ranged: true,
      spriteKey: 'ranger', tint: 'hue-rotate(170deg) saturate(0.4) brightness(0.75)', projColor: '#ff8c3c',
      trait: 'hype', points: 200 },
  };

  // Three level-ending bosses built around real, widely-recognized fantasy
  // football figures -- reusing the human sprite rigs (recolored + scaled,
  // same period-authentic trick as the rest of the roster) rather than new art.
  const MINIBOSS_DEFS = {
    lateround: { name: 'Old Man Thielen', hp: 95, speed: 1.2, dmg: 10, atkRange: 52, atkCd: 1300, size: 1.55, miniboss: true,
      spriteKey: 'renegade', tint: 'hue-rotate(255deg) saturate(1.3) brightness(0.8)', vikingHat: true,
      beard: true, beardColor: '#e8e4d8', beardLong: true,
      trait: 'oldman', points: 1000 },
    alphavulture: { name: 'P. River', hp: 105, speed: 1.5, dmg: 8, atkRange: 240, atkCd: 1500, size: 1.45, ranged: true, miniboss: true,
      spriteKey: 'ranger', tint: 'hue-rotate(50deg) saturate(1.3) brightness(1.05)', projColor: '#f4e04d', bolt: true,
      trait: 'priver', points: 1200 },
    cardshark: { name: 'GRONK', hp: 155, speed: 1.7, dmg: 12, atkRange: 85, atkCd: 1200, size: 3.9, miniboss: true,
      spriteKey: 'renegade', tint: 'hue-rotate(355deg) saturate(1.4) brightness(0.85)',
      trait: 'gronk', points: 1500 },
    formerchamp: { name: 'Megalodon', hp: 165, speed: 2.0, dmg: 11, atkRange: 50, atkCd: 850, size: 2.3, miniboss: true,
      shark: true, projColor: '#ffd23f',
      trait: 'sharkbite', points: 1600 },
  };

  const TRASH_TALK = [
    'YOUR RB1 IS ON BYE',
    'YOU DRAFTED A KICKER EARLY',
    'ZERO-RB WAS A MISTAKE',
    'I HAD HIM ON MY BENCH',
    'THAT TRADE WAS A FLEECE',
  ];
  const THIELEN_LINES = ['MY BACK!', 'BACK IN MY DAY', 'HEY YOUNG FELLA'];
  const RIVER_LINES = ["NOW I'M PISSED", 'WATCH ME FLOW', 'MAKE IT RAIN'];
  const GRONK_LINES = ['TIME TO GET GRONKED', 'GETTIN GRONKY WITH IT', 'GRONK LOVES YOU'];
  const SHARK_LINES = ['MEGALA...', 'GET IN MAH BELLY', 'THESE TEETH WERE MADE FOR CHOMPIN'];

  // ============================================================
  // Effects
  // ============================================================
  let projectiles = [], particles = [], popups = [], pickups = [];
  let hitStopTimer = 0, shakeTimer = 0, flashScreenTimer = 0;

  function spawnHit(x, y, color, n, power) {
    for (let i = 0; i < (n || 8); i++) {
      particles.push({ x, y, vx: rand(-3, 3) * (power || 1), vy: rand(-4, -1) * (power || 1), life: 20, color });
    }
  }
  function spawnImpactRing(x, y, color) {
    particles.push({ ring: true, x, y, r: 4, life: 14, color });
  }
  function spawnPopup(x, y, text, color, big) {
    popups.push({ x, y, text, life: 2000, maxLife: 2000, color: color || '#fff', big: !!big });
  }
  // damage/heal numbers stay small and quick -- they need to keep pace with
  // a fast combo string, not linger like a callout or a boss line
  function spawnDmgPopup(x, y, text, color) {
    popups.push({ x, y, text, life: 750, maxLife: 750, color: color || '#fff', dmg: true });
  }

  // ============================================================
  // Player
  // ============================================================
  class Player {
    constructor(charKey) {
      const def = CHAR_DEFS[charKey];
      this.def = def;
      this.charKey = charKey;
      this.x = 120; this.y = GROUND_Y;
      this.jumpZ = 0; this.vz = 0;
      this.knockX = 0;
      this.facing = 1;
      this.health = def.maxHealth; this.maxHealth = def.maxHealth;
      this.meter = 0; this.maxMeter = 100;
      this.pose = 'idle'; this.poseTimer = 0; this.poseDuration = 1;
      this.t = 0;
      this.attackKind = null;     // 'combo' | 'kick' | 'dashatk' | 'jumpatk' | 'special' | 'throw'
      this.comboStep = 0;
      this.comboGrace = 0;        // time window to chain the next hit
      this.comboCount = 0;        // display counter
      this.comboDisplayTimer = 0;
      this.kickCd = 0; this.specialCd = 0;
      this.invuln = 0;
      this.pending = null;
      this.hitbox = null;
      this.dashTimer = 0; this.dashDir = 0; this.dashCd = 0;
      this.grabbed = null; this.grabTimer = 0; this.grabHits = 0;
      this.alive = true;
      this.hypeTimer = 0;      // Andy's "Welcome In" crowd-hype buff
      this.mailbagQ = '';      // Jason's current mailbag question, for the HUD callout
      this.jkCd = 0;           // cooldown on the J+K signature move
    }
    get progress() { return this.poseDuration > 0 ? clamp(1 - this.poseTimer / this.poseDuration, 0, 1) : 1; }
    get busy() { return this.poseTimer > 0 && this.attackKind !== null; }

    // The moment each special fires -- this is where the real bit shows up.
    fireVoiceMoment(voice) {
      if (voice === 'welcomeIn') {
        this.hypeTimer = 3200;
        spawnPopup(this.x, this.y - 130, 'WELCOME IN!', '#ffd23f', true);
        for (let i = 0; i < 10; i++) {
          particles.push({ x: this.x, y: this.y - 60, vx: rand(-3, 3), vy: rand(-5, -1), life: 26, color: '#ffd23f' });
        }
        SFX.welcomeIn();
      } else if (voice === 'mailbag') {
        this.mailbagQ = MAILBAG_QUESTIONS[Math.floor(Math.random() * MAILBAG_QUESTIONS.length)];
        spawnPopup(this.x, this.y - 138, this.mailbagQ, '#8fd3ff');
        spawnPopup(this.x, this.y - 118, '#FOOTCLAN MAILBAG', '#ffb703', true);
        for (let i = 0; i < 8; i++) {
          particles.push({ x: this.x, y: this.y - 55, vx: rand(-2.5, 2.5), vy: rand(-4, -1), life: 22, color: '#eef0f5' });
        }
        SFX.mailbag();
      } else if (voice === 'riff') {
        spawnPopup(this.x, this.y - 130, 'DROP THE RIFF', '#ff8c8c', true);
        SFX.riff();
      } else {
        SFX.special();
      }
    }
    // Attacks can be cancelled into the next combo hit late in recovery -- snappy chains.
    get cancelable() { return this.attackKind === 'combo' && this.progress > 0.5; }

    takeDamage(dmg, fromX) {
      if (this.invuln > 0 || !this.alive) return;
      this.health = clamp(this.health - dmg, 0, this.maxHealth);
      this.invuln = 650;
      this.facing = fromX < this.x ? 1 : -1;
      this.knockX += (fromX < this.x ? 1 : -1) * 14;
      this.releaseGrab();
      this.comboStep = 0; this.comboCount = 0;
      hitStopTimer = Math.max(hitStopTimer, 45);
      SFX.hurt();
      spawnHit(this.x, this.y - 60, '#ff6b6b');
      spawnDmgPopup(this.x, this.y - 105, '-' + dmg, '#ff6b6b');
      if (this.health <= 0) this.alive = false;
    }

    releaseGrab() {
      if (this.grabbed) { this.grabbed.grabbedBy = null; this.grabbed = null; }
      this.grabTimer = 0; this.grabHits = 0;
    }

    tryGrab(enemies) {
      for (const en of enemies) {
        if (!en.alive || en.dying || en.thrown || en.def.flyer || en.def.customAI) continue;
        if (!en.dazed) continue;
        if (meleeHits(this.x, this.y, this.facing, en.x, en.y, 52, DEPTH_GRAB)) {
          this.grabbed = en;
          en.grabbedBy = this;
          this.grabTimer = 2200;
          this.grabHits = 0;
          this.pose = 'grab';
          SFX.grab();
          spawnPopup(en.x, en.y - 120, 'GRABBED!', '#8fd3ff');
          return true;
        }
      }
      return false;
    }

    doThrow() {
      const en = this.grabbed;
      if (!en) return;
      en.grabbedBy = null;
      en.thrown = true;
      en.tvx = this.facing * 13;
      en.tvz = 8.5;
      en.jumpZ = 20;
      en.thrownBy = this;
      en.spin = 0;
      this.grabbed = null;
      this.grabTimer = 0;
      this.pose = 'throw';
      this.attackKind = 'throw';
      this.poseDuration = this.poseTimer = 260;
      this.meter = clamp(this.meter + 12, 0, this.maxMeter);
      SFX.throwIt();
      shakeTimer = Math.max(shakeTimer, 150);
      spawnPopup(this.x, this.y - 130, 'THROW!', '#ffd23f', true);
    }

    startAttack(kind, spec) {
      this.attackKind = kind;
      this.poseDuration = this.poseTimer = spec.dur;
      this.pending = spec;
      this.hitbox = null;
      if (kind === 'combo' || kind === 'kick') this.pose = kind === 'kick' ? 'kick' : 'punch';
      else if (kind === 'dashatk') this.pose = 'dashatk';
      else if (kind === 'jumpatk') this.pose = 'jumpatk';
      else if (kind === 'special') this.pose = 'special';
      else if (kind === 'signature') this.pose = 'signature';
      SFX.whiff();
    }

    update(dt, world, enemies) {
      this.t += dt;
      this.invuln = Math.max(0, this.invuln - dt);
      this.kickCd = Math.max(0, this.kickCd - dt);
      this.specialCd = Math.max(0, this.specialCd - dt);
      this.dashCd = Math.max(0, this.dashCd - dt);
      this.hypeTimer = Math.max(0, this.hypeTimer - dt);
      this.jkCd = Math.max(0, this.jkCd - dt);
      this.comboGrace = Math.max(0, this.comboGrace - dt);
      this.comboDisplayTimer = Math.max(0, this.comboDisplayTimer - dt);
      if (this.comboGrace <= 0 && this.attackKind !== 'combo') this.comboStep = 0;
      if (this.comboDisplayTimer <= 0) this.comboCount = 0;

      if (Math.abs(this.knockX) > 0.1) {
        this.x = clamp(this.x + this.knockX, 40, world.width - 40);
        this.knockX *= 0.8;
      } else this.knockX = 0;

      // ---- grab state: hold the enemy, knee or throw -------------------
      if (this.grabbed) {
        const en = this.grabbed;
        if (!en.alive || en.dying) { this.releaseGrab(); }
        else {
          this.grabTimer -= dt;
          en.x = this.x + this.facing * 34;
          en.y = this.y;
          en.jumpZ = 0;
          this.pose = 'grab';
          if (tapped('KeyJ')) {
            this.grabHits++;
            en.takeDamage(7, this.x, 0);
            hitStopTimer = Math.max(hitStopTimer, 60);
            SFX.hit();
            spawnHit(en.x, en.y - 60, '#ffd23f', 6);
            this.meter = clamp(this.meter + 5, 0, this.maxMeter);
            if (this.grabHits >= 3) this.doThrow();
          } else if (tapped('KeyK') || tapped('KeyL')) {
            this.doThrow();
          } else if (this.grabTimer <= 0) {
            this.releaseGrab();
          }
          if (this.grabbed) return; // locked while holding
        }
      }

      // ---- attack input ------------------------------------------------
      const canAct = !this.busy || this.cancelable;
      if (canAct) {
        const sig = this.def.signature;
        if (consumeJkCombo() && this.jkCd <= 0 && this.jumpZ === 0) {
          this.startAttack('signature', {
            dmg: sig.dmg, range: sig.range, dur: sig.dur, strike: sig.strike, knock: sig.knock,
            knockdown: sig.knockdown, heavy: sig.heavy, aoe: sig.aoe,
            multiHit: sig.multiHit, tickMs: sig.tickMs, hitboxLife: sig.hitboxLife,
          });
          this.jkCd = sig.cd;
          this.dashTimer = 0;
          spawnPopup(this.x, this.y - 130, sig.name.toUpperCase(), '#fff', true);
          if (sig.multiHit) SFX.dash(); else hitStopTimer = Math.max(hitStopTimer, 40);
        } else if (tapped('KeyJ')) {
          if (this.jumpZ > 0) {
            this.startAttack('jumpatk', { dmg: this.def.combo[1].dmg + 4, range: 58, dur: 380, strike: 0.15, knock: 16, knockdown: true });
          } else if (this.dashTimer > 0) {
            this.startAttack('dashatk', { dmg: this.def.combo[2].dmg, range: 60, dur: 300, strike: 0.2, knock: 24, knockdown: true, heavy: true });
            this.dashTimer = 0;
          } else if (!this.tryGrab(enemies)) {
            const step = this.comboGrace > 0 ? this.comboStep % 3 : 0;
            this.startAttack('combo', this.def.combo[step]);
            this.comboStep = step + 1;
            this.comboGrace = 520;
          }
        } else if (tapped('KeyK') && this.jumpZ > 0) {
          // airborne heavy: a committed stomp that lands late and hits wide,
          // the K counterpart to J's quick early-striking dive kick
          this.startAttack('jumpatk', { dmg: this.def.kick.dmg + 6, range: 68, dur: 420, strike: 0.6, knock: 28, knockdown: true, heavy: true, aoe: true });
        } else if (tapped('KeyK') && this.kickCd <= 0 && this.jumpZ === 0) {
          this.startAttack('kick', this.def.kick);
          this.kickCd = this.def.kick.cd;
        } else if (tapped('KeyL') && this.specialCd <= 0 && this.meter >= this.def.special.cost) {
          const sp = this.def.special;
          this.startAttack('special', { dmg: sp.dmg, range: sp.range, dur: 460, strike: 0.3, knock: 30, aoe: sp.aoe, projectile: sp.projectile, knockdown: true, heavy: true, riff: sp.voice === 'riff' });
          this.meter -= sp.cost;
          this.specialCd = sp.cd;
          this.invuln = Math.max(this.invuln, 460); // special = brief i-frames, classic panic button
          flashScreenTimer = 140;
          this.fireVoiceMoment(sp.voice);
        }
      }

      // ---- movement -----------------------------------------------------
      let moving = false;
      if (!this.busy) {
        const dd = consumeDoubleTap();
        if (dd !== 0 && this.dashCd <= 0 && this.jumpZ === 0) {
          this.dashTimer = 260; this.dashDir = dd; this.dashCd = 420;
          this.facing = dd;
          SFX.dash();
        }

        let dx = 0, dy = 0;
        if (pressed('ArrowLeft') || pressed('KeyA')) dx -= 1;
        if (pressed('ArrowRight') || pressed('KeyD')) dx += 1;
        if (pressed('ArrowUp') || pressed('KeyW')) dy -= 1;
        if (pressed('ArrowDown') || pressed('KeyS')) dy += 1;

        if (this.dashTimer > 0) {
          this.dashTimer -= dt;
          this.x = clamp(this.x + this.dashDir * this.def.speed * 2.3, 40, world.width - 40);
          // still allow depth adjustment mid-dash so dodging never feels locked out
          if (dy !== 0) this.y = clamp(this.y + dy * this.def.speed * 0.8, BAND_TOP, BAND_BOTTOM);
          moving = true;
          this.pose = 'dash';
          if (Math.random() < 0.4) particles.push({ x: this.x - this.dashDir * 10, y: this.y - 6, vx: -this.dashDir * 1.5, vy: rand(-0.6, 0.2), life: 12, color: '#ffffff55' });
        } else if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy) || 1;
          const hypeMul = this.hypeTimer > 0 ? 1.28 : 1; // Andy's crowd-hype speed boost
          this.x = clamp(this.x + (dx / len) * this.def.speed * hypeMul, 40, world.width - 40);
          // vertical is intentionally close to full speed -- dodging must feel immediate
          this.y = clamp(this.y + (dy / len) * this.def.speed * 0.85 * hypeMul, BAND_TOP, BAND_BOTTOM);
          if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
          moving = true;
        }

        if (tapped('Space') && this.jumpZ === 0) { this.vz = this.def.jumpPow; SFX.jump(); }
      }

      // ---- jump physics --------------------------------------------------
      if (this.jumpZ > 0 || this.vz > 0) {
        this.vz -= GRAVITY;
        this.jumpZ += this.vz;
        if (this.jumpZ <= 0) {
          this.jumpZ = 0; this.vz = 0;
          if (this.attackKind === 'jumpatk') { this.poseTimer = 0; this.attackKind = null; this.hitbox = null; this.pending = null; }
        }
      }

      // ---- resolve pose --------------------------------------------------
      if (!this.busy) {
        if (this.dashTimer > 0) this.pose = 'dash';
        else this.pose = moving ? 'walk' : 'idle';
      }

      // ---- spawn hitbox at the strike frame ------------------------------
      if (this.pending && this.progress >= this.pending.strike) {
        const spec = this.pending;
        this.pending = null;
        if (spec.projectile) {
          projectiles.push({
            x: this.x + this.facing * 24, y: this.y, vx: this.facing * (spec.envelope ? 8 : 11),
            dmg: spec.dmg, friendly: true, life: 1800, color: '#ff8c3c', w: 18, h: 8, big: true,
            riff: !!spec.riff, envelope: !!spec.envelope,
          });
          if (!spec.riff && !spec.envelope) SFX.fire(); // riff/mailbag already played their own sound on activation
        } else {
          this.hitbox = {
            dmg: spec.dmg, range: spec.range, knock: spec.knock, knockdown: spec.knockdown,
            aoe: spec.aoe, heavy: spec.heavy, life: spec.hitboxLife || 130, hitSet: new Set(),
            multiHit: !!spec.multiHit, tickMs: spec.tickMs || 90, hitTimes: new Map(), age: 0,
          };
        }
      }

      if (this.poseTimer > 0) {
        this.poseTimer -= dt;
        if (this.poseTimer <= 0) {
          this.attackKind = null; this.hitbox = null; this.pending = null;
        }
      }
      this.meter = clamp(this.meter, 0, this.maxMeter);
    }

    resolveHits(enemies, dt) {
      const hb = this.hitbox;
      if (!hb) return;
      hb.life -= dt;
      hb.age += dt;
      for (const en of enemies) {
        if (!en.alive || en.dying || en.thrown) continue;
        if (hb.multiHit) {
          const last = hb.hitTimes.has(en) ? hb.hitTimes.get(en) : -9999;
          if (hb.age - last < hb.tickMs) continue;
        } else if (hb.hitSet.has(en)) continue;

        const depth = hb.aoe ? 90 : DEPTH_PLAYER_ATTACK;
        if (meleeHits(this.x, this.y, this.facing, en.x, en.y, hb.range, depth)
          || (hb.aoe && Math.abs(en.x - this.x) < hb.range && Math.abs(en.y - this.y) < 90)) {
          if (hb.multiHit) hb.hitTimes.set(en, hb.age); else hb.hitSet.add(en);
          en.takeDamage(hb.dmg, this.x, hb.knock, hb.knockdown);
          this.meter = clamp(this.meter + (hb.heavy ? 12 : 5), 0, this.maxMeter);
          this.comboCount++;
          this.comboDisplayTimer = 1400;
          // deeper combos are worth more per hit -- the reason to keep the chain alive
          score += 10 * Math.min(this.comboCount, 10);
          if (stageStats && this.comboCount > stageStats.bestCombo) stageStats.bestCombo = this.comboCount;
          hitStopTimer = Math.max(hitStopTimer, hb.heavy ? 95 : (hb.multiHit ? 30 : 62));
          if (hb.heavy) { shakeTimer = Math.max(shakeTimer, 160); SFX.heavy(); }
          else if (this.charKey === 'mike') SFX.guitarHit();
          else SFX.hit();
          spawnHit(en.x, en.y - 58, '#ffd23f', hb.heavy ? 14 : 8, hb.heavy ? 1.6 : 1);
          spawnImpactRing(en.x, en.y - 58, '#fff');
          if (!hb.aoe && !hb.multiHit) { this.hitbox = null; break; }
        }
      }
      if (hb.life <= 0) this.hitbox = null;
    }
  }

  // ============================================================
  // Enemy
  // ============================================================
  class Enemy {
    constructor(key, x, y, defOverride) {
      const def = defOverride || ENEMY_DEFS[key] || MINIBOSS_DEFS[key];
      this.key = key; this.def = def;
      this.x = x; this.y = y; this.jumpZ = 0;
      this.hp = def.hp; this.maxHp = def.hp;
      this.facing = -1;
      this.pose = 'idle';
      this.t = rand(0, 1000);
      this.atkCd = rand(400, 900);
      this.hurtTimer = 0; this.flashTimer = 0;
      this.alive = true; this.dying = false; this.deathTimer = 0;
      this.knockX = 0;
      this.flyPhase = rand(0, 10);
      this.summonCd = 3500;
      this.engaged = !!def.miniboss;
      this.attackState = null; this.attackTimer = 0; this.attackDuration = 1;
      this.knockedDown = false; this.downTimer = 0;
      this.dazed = false; this.dazedTimer = 0;
      this.thrown = false; this.tvx = 0; this.tvz = 0; this.spin = 0; this.thrownBy = null;
      this.grabbedBy = null;
      // trait state
      this.traitCd = rand(1200, 2600);
      this.lunging = 0;          // reach / tackle dash
      this.hyped = 0;            // buffed by a Trash Talker
      this.sayTimer = 0; this.sayText = '';
      this.diving = false;
      this.raining = false; this.rainTimer = 0; this.rainX = 0; this.rainX2 = 0; // P. River's sky-rain attack
      this.biting = false; // Megalodon's jaw-open state
    }
    get progress() { return this.attackDuration > 0 ? clamp(1 - this.attackTimer / this.attackDuration, 0, 1) : 0; }

    say(text, ms) {
      this.sayText = text; this.sayTimer = Math.max(ms || 1400, 2000);
    }

    takeDamage(dmg, fromX, knock, knockdown) {
      if (this.dying) return;
      // Shady Bookie: the house always wins. Occasionally hedges your bet away.
      if (this.def.trait === 'hedge' && !this.knockedDown && !this.dazed
          && this.traitCd <= 0 && Math.random() < 0.42) {
        this.traitCd = 2600;
        this.knockX += (this.x < fromX ? -1 : 1) * 16;
        this.say('HEDGED!', 900);
        spawnPopup(this.x, this.y - 100, 'NO BET', '#5cc8f5');
        return;
      }
      this.hp -= dmg;
      this.hurtTimer = 170;
      this.flashTimer = 140;
      this.attackState = null;
      // the boss can't be knocked around, so he flinches instead
      if (this.def.customAI) {
        this.sx = 0.88; this.sy = 1.12;
        this.recoil = (this.x < fromX ? -1 : 1) * 7;
      }
      if (this.grabbedBy && knockdown) { this.grabbedBy.releaseGrab(); }
      if (!this.grabbedBy) this.knockX += (this.x < fromX ? -1 : 1) * (knock || 6);
      spawnDmgPopup(this.x, this.y - 100, '-' + dmg, '#ffd23f');

      if (this.hp <= 0) {
        this.dying = true; this.deathTimer = 620;
        this.knockedDown = true;
        this.pose = 'knockdown';
        SFX.ko();
        spawnPopup(this.x, this.y - 115, 'KO!', '#fff', true);
        spawnHit(this.x, this.y - 55, '#fff', 16, 1.5);
        if (!this.vulturedKill) {
          const pts = this.def.points || 100;
          addScore(pts, this.x, this.y - 138);
          if (stageStats) stageStats.kills++;
        }
        if (Math.random() < 0.34 && !this.def.miniboss) {
          pickups.push({ x: this.x, y: this.y, heal: 20, life: 10000, t: 0 });
        }
      } else if (knockdown && !this.def.customAI) {
        this.knockedDown = true;
        this.downTimer = 850;
        this.pose = 'knockdown';
      }
    }

    setDazed(ms) {
      if (this.def.customAI || this.def.flyer) return;
      this.dazed = true; this.dazedTimer = ms;
    }

    update(dt, player, world) {
      this.t += dt;
      this.hurtTimer = Math.max(0, this.hurtTimer - dt);
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      this.atkCd = Math.max(0, this.atkCd - dt);
      this.traitCd = Math.max(0, this.traitCd - dt);
      this.sayTimer = Math.max(0, this.sayTimer - dt);
      if (this.hyped > 0) this.hyped -= dt;
      if (this.dazedTimer > 0) { this.dazedTimer -= dt; if (this.dazedTimer <= 0) this.dazed = false; }

      // ---- thrown through the air (the signature TiT move) --------------
      if (this.thrown) {
        this.x += this.tvx;
        this.tvz -= 0.62;
        this.jumpZ += this.tvz;
        this.spin += 0.35;
        this.tvx *= 0.995;
        // slam into anyone in the way
        for (const other of world.enemies) {
          if (other === this || !other.alive || other.dying || other.thrown) continue;
          if (Math.abs(other.x - this.x) < 30 && Math.abs(other.y - this.y) < 34) {
            other.takeDamage(14, this.x, 16, true);
            other.setDazed(1600);
            spawnHit(other.x, other.y - 55, '#fff', 10, 1.3);
            SFX.heavy();
            this.tvx *= 0.3;
          }
        }
        if (this.jumpZ <= 0) {
          this.jumpZ = 0; this.thrown = false; this.spin = 0;
          const dmg = this.thrownBy ? this.thrownBy.def.throwDmg : 18;
          this.thrownBy = null;
          shakeTimer = Math.max(shakeTimer, 140);
          SFX.heavy();
          spawnHit(this.x, this.y - 20, '#ffd23f', 12, 1.4);
          this.takeDamage(dmg, this.x + 1, 0, true);
          this.setDazed(1400);
        }
        this.x = clamp(this.x, 40, world.width - 40);
        return;
      }

      if (this.grabbedBy) { this.pose = 'hurt'; return; }

      if (Math.abs(this.knockX) > 0.1) {
        this.x = clamp(this.x + this.knockX, 40, world.width - 40);
        this.knockX *= 0.82;
      }

      if (this.dying) {
        this.deathTimer -= dt;
        this.pose = 'knockdown';
        if (this.deathTimer <= 0) this.alive = false;
        return;
      }

      // ---- knocked down: lie there, then get up dazed (grabbable) -------
      if (this.knockedDown) {
        this.downTimer -= dt;
        this.pose = 'knockdown';
        if (this.downTimer <= 0) {
          this.knockedDown = false;
          this.setDazed(1500);
          this.atkCd = Math.max(this.atkCd, 500);
        }
        return;
      }

      if (this.def.customAI) return;
      if (!player || !player.alive) { this.pose = 'idle'; return; }

      if (this.def.flyer) this.jumpZ = 30 + Math.sin(this.t * 0.003 + this.flyPhase) * 15;

      if (this.hurtTimer > 0) { this.pose = 'hurt'; return; }
      if (this.dazed) { this.pose = 'idle'; return; } // dazed = free grab window

      // trait behaviour gets first refusal on the turn
      if (this.runTrait(dt, player, world)) return;

      const dx = player.x - this.x, dy = player.y - this.y;
      const d = Math.hypot(dx, dy);

      // ---- mid-attack ---------------------------------------------------
      if (this.attackState) {
        this.attackTimer -= dt;
        this.pose = 'punch';
        if (this.attackTimer <= 0) {
          if (this.attackState === 'wind') {
            this.facing = player.x > this.x ? 1 : -1;
            if (this.def.ranged) {
              let dmg = this.def.dmg, w = 12, h = 10, vx = this.facing * 6, trail = false;
              if (this.def.trait === 'roll') {
                // Dice Roller: damage is literally a roll of 2d6
                dmg = Math.ceil(rand(0, 6)) + Math.ceil(rand(0, 6));
                this.say('ROLLED ' + dmg, 1100);
              } else if (this.def.trait === 'spiral') {
                // Late-Round QB throws an actual spiral -- fast and flat
                vx = this.facing * 9.5; w = 20; h = 8; trail = true;
                this.say('DEEP BALL', 1100);
              }
              projectiles.push({
                x: this.x + this.facing * 18, y: this.y, vx,
                dmg, friendly: false, life: 3000, w, h, trail,
                color: this.def.projColor || '#ff4fa3',
              });
              SFX.fire();
            } else if (meleeHits(this.x, this.y, this.facing, player.x, player.y, this.def.atkRange + 8, DEPTH_ENEMY_MELEE)) {
              player.takeDamage(this.def.dmg, this.x);
            }
            this.attackState = 'recover';
            this.attackTimer = this.attackDuration = 240;
          } else this.attackState = null;
        }
        if (this.def.summons) this.tickSummon(dt, world);
        return;
      }

      if (!this.engaged) {
        const leash = 175;
        if (d > leash) {
          const len = d || 1;
          this.x += (dx / len) * this.def.speed * 0.8;
          this.y = clamp(this.y + (dy / len) * this.def.speed * 0.5, BAND_TOP, BAND_BOTTOM);
          this.facing = dx > 0 ? 1 : -1;
          this.pose = 'walk';
        } else { this.pose = 'idle'; this.facing = player.x > this.x ? 1 : -1; }
        if (this.def.summons) this.tickSummon(dt, world);
        return;
      }

      const range = this.def.atkRange;
      const hypeMul = this.hyped > 0 ? 1.35 : 1;
      if (d > range * 0.85) {
        const len = d || 1;
        this.x += (dx / len) * this.def.speed * hypeMul;
        this.y = clamp(this.y + (dy / len) * this.def.speed * 0.7 * hypeMul, BAND_TOP, BAND_BOTTOM);
        this.facing = dx > 0 ? 1 : -1;
        this.pose = 'walk';
      } else {
        this.facing = player.x > this.x ? 1 : -1;
        this.pose = 'idle';
        if (this.atkCd <= 0) {
          this.atkCd = this.def.atkCd / hypeMul;
          this.attackState = 'wind';
          this.attackTimer = this.attackDuration = 320 / hypeMul; // visible windup = readable
          this.pose = 'punch';
        }
      }
      if (this.def.summons) this.tickSummon(dt, world);
    }

    moveToward(tx, ty, mult) {
      const dx = tx - this.x, dy = ty - this.y;
      const len = Math.hypot(dx, dy) || 1;
      const sp = this.def.speed * (mult || 1) * (this.hyped > 0 ? 1.35 : 1);
      this.x += (dx / len) * sp;
      this.y = clamp(this.y + (dy / len) * sp * 0.7, BAND_TOP, BAND_BOTTOM);
      this.facing = dx > 0 ? 1 : -1;
      this.pose = 'walk';
    }

    // Returns true if the trait took over this frame's behaviour entirely.
    runTrait(dt, player, world) {
      const trait = this.def.trait;
      if (!trait) return false;

      switch (trait) {
        // --- Waiver-Wire Zombie: races you to the health drops and eats them
        case 'scavenge': {
          let best = null, bd = 1e9;
          for (const pk of pickups) {
            const dd = Math.hypot(pk.x - this.x, pk.y - this.y);
            if (dd < 420 && dd < bd) { bd = dd; best = pk; }
          }
          if (!best) return false;
          if (bd < 30) {
            best.life = 0;
            this.hp = Math.min(this.maxHp, this.hp + best.heal);
            this.say('CLAIMED OFF WAIVERS', 1500);
            spawnPopup(this.x, this.y - 118, 'STOLEN!', '#7fbf6a');
            SFX.pickup();
            this.traitCd = 1500;
          } else {
            this.moveToward(best.x, best.y, 1.45);
            if (this.sayTimer <= 0) this.say('MINE', 700);
          }
          return true;
        }

        // --- Stat-Vulture: swoops on a nearly-dead enemy to steal your kill
        case 'vulture': {
          let mark = null, md = 1e9;
          for (const en of world.enemies) {
            if (en === this || !en.alive || en.dying || en.def.flyer || en.def.customAI) continue;
            if (en.hp > en.maxHp * 0.33) continue;
            const dd = Math.hypot(en.x - this.x, en.y - this.y);
            if (dd < 360 && dd < md) { md = dd; mark = en; }
          }
          if (!mark) return false;
          if (md < 34) {
            mark.vulturedKill = true;           // you get no points for this one
            mark.takeDamage(999, this.x, 4, true);
            this.say('VULTURED!', 1400);
            spawnPopup(mark.x, mark.y - 132, 'KILL STOLEN', '#ff5a47');
            this.traitCd = 2000;
          } else {
            this.moveToward(mark.x, mark.y, 1.5);
          }
          return true;
        }

        // --- Trash Talker: runs his mouth and hypes up everyone around him
        case 'hype': {
          if (this.traitCd > 0) return false;
          this.traitCd = 5200;
          let hypedAny = false;
          for (const en of world.enemies) {
            if (en === this || !en.alive || en.dying) continue;
            if (Math.abs(en.x - this.x) < 240) { en.hyped = 4200; hypedAny = true; }
          }
          this.say(TRASH_TALK[Math.floor(Math.random() * TRASH_TALK.length)], 2000);
          if (hypedAny) spawnPopup(this.x, this.y - 130, 'HYPED THE ROOM', '#ff8c3c');
          return false; // still shoots normally
        }

        // --- Rogue Mock-Draftee: wild, unpredictable "reach" lunges
        case 'reach': {
          if (this.lunging > 0) {
            this.lunging -= dt;
            this.x = clamp(this.x + this.facing * 5.4, 40, world.width - 40);
            this.pose = 'walk';
            if (meleeHits(this.x, this.y, this.facing, player.x, player.y, 46, DEPTH_ENEMY_MELEE)) {
              player.takeDamage(this.def.dmg, this.x);
              this.lunging = 0;
            }
            return true;
          }
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (this.traitCd <= 0 && d > 70 && d < 260) {
            this.traitCd = rand(2600, 4200);
            this.facing = player.x > this.x ? 1 : -1;
            this.lunging = 300;
            this.say('REACH!', 800);
            return true;
          }
          return false;
        }

        // --- Rival Champ: reads your attack and counters it
        case 'counter': {
          if (this.traitCd > 0) return false;
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (d < 70 && player.hitbox) {
            this.traitCd = 4200;
            this.knockX += (this.x < player.x ? -1 : 1) * 12;   // slip back
            this.say('READ YOU', 900);
            this.atkCd = 0;                                      // punish immediately
          }
          return false;
        }

        // --- Alpha Vulture: dive-bombs across the arena
        case 'divebomb': {
          if (this.diving) {
            this.x += this.tvx;
            this.jumpZ = Math.max(0, this.jumpZ - 2.2);
            this.pose = 'walk';
            if (meleeHits(this.x, this.y, this.facing, player.x, player.y, 54, 34)) {
              player.takeDamage(this.def.dmg + 3, this.x);
              this.diving = false;
            }
            if (this.x < 60 || this.x > world.width - 60 || this.jumpZ <= 2) {
              this.diving = false; this.jumpZ = 30;
            }
            return true;
          }
          if (this.traitCd <= 0) {
            this.traitCd = 4200;
            this.diving = true;
            this.facing = player.x > this.x ? 1 : -1;
            this.tvx = this.facing * 7.5;
            this.jumpZ = 70;
            this.say('SWOOP!', 900);
            return true;
          }
          return false;
        }

        // --- Card Shark: fans a spread of cards across three lanes
        case 'cardfan': {
          if (this.traitCd > 0) return false;
          this.traitCd = 3800;
          const dir = player.x > this.x ? 1 : -1;
          this.facing = dir;
          for (const off of [-46, 0, 46]) {
            projectiles.push({
              x: this.x + dir * 24, y: clamp(player.y + off, BAND_TOP - 8, BAND_BOTTOM + 8),
              vx: dir * 5.2, dmg: this.def.dmg, friendly: false, life: 2400, w: 12, h: 14,
              color: '#ff4fa3', trail: true,
            });
          }
          this.say('READ EM AND WEEP', 1400);
          SFX.fire();
          return true;
        }

        // --- Megalodon: circles at range, then charges in for a bite --
        // the same charge-lunge shape as the old shoulder tackle, just
        // reframed as a shark closing for the kill, with the jaw visibly
        // opening for the strike.
        case 'sharkbite': {
          if (this.lunging > 0) {
            this.lunging -= dt;
            this.biting = true;
            this.x = clamp(this.x + this.facing * 8.5, 40, world.width - 40);
            this.pose = 'walk';
            if (meleeHits(this.x, this.y, this.facing, player.x, player.y, 56, DEPTH_ENEMY_MELEE + 6)) {
              player.takeDamage(this.def.dmg + 4, this.x);
              shakeTimer = Math.max(shakeTimer, 180);
              this.lunging = 0;
            }
            return true;
          }
          this.biting = false;
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (this.traitCd <= 0 && d > 90) {
            this.traitCd = 4000;
            this.facing = player.x > this.x ? 1 : -1;
            this.lunging = 520;
            this.say(SHARK_LINES[Math.floor(Math.random() * SHARK_LINES.length)], 1100);
            spawnPopup(this.x, this.y - 150, 'CHOMP INCOMING!', '#ff5a47');
            return true;
          }
          return false;
        }

        // --- Old Man Thielen: mostly a slow, creaky veteran -- pokes at you
        // at ordinary range like anyone else, but every so often finds one
        // more route in him and closes the gap fast.
        case 'oldman': {
          if (this.lunging > 0) {
            this.lunging -= dt;
            this.x = clamp(this.x + this.facing * 6.2, 40, world.width - 40);
            this.pose = 'walk';
            if (meleeHits(this.x, this.y, this.facing, player.x, player.y, 50, DEPTH_ENEMY_MELEE)) {
              player.takeDamage(this.def.dmg, this.x);
              this.lunging = 0;
            }
            return true;
          }
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (this.traitCd <= 0 && d > 90) {
            this.traitCd = 3800;
            this.facing = player.x > this.x ? 1 : -1;
            this.lunging = 340;
            this.say(THIELEN_LINES[Math.floor(Math.random() * THIELEN_LINES.length)], 1000);
            return true;
          }
          return false;
        }

        // --- P. River: fires a baseline yellow stream (handled by the
        // generic `ranged` attack below), plus periodically calls his shot
        // and rains yellow drops down a whole depth column -- dodged by
        // moving sideways in X, the one attack in the game that isn't a
        // depth-lane dodge.
        case 'priver': {
          if (this.raining) {
            this.rainTimer -= dt;
            if (this.rainTimer <= 0) {
              for (const spotX of [this.rainX, this.rainX2]) {
                for (const off of [-22, 0, 22]) {
                  projectiles.push({
                    x: spotX + off, y: BAND_TOP - 50, vx: 0, vy: 3.25, // half speed
                    dmg: 9, friendly: false, life: 1240, w: 10, h: 16, // life doubled to match the slower fall
                    color: '#f4e04d', rainDrop: true,
                  });
                }
              }
              this.raining = false;
              this.traitCd = 3600;
            }
            return true;
          }
          if (this.traitCd <= 0) {
            this.raining = true; this.rainTimer = 620;
            this.rainX = player.x; this.rainX2 = this.x; // two danger zones: on the player, and under him
            this.say(RIVER_LINES[Math.floor(Math.random() * RIVER_LINES.length)], 950);
            spawnPopup(this.rainX, GROUND_Y - 40, 'INCOMING!', '#f4e04d', true);
            spawnPopup(this.rainX2, GROUND_Y - 40, 'INCOMING!', '#f4e04d', true);
            return true;
          }
          return false;
        }

        // --- GRONK: spikes the ball (a ground-pound AOE) when you're in
        // his face, or lowers his shoulder for a touchdown-run charge when
        // you're not. No ranged attack -- he doesn't need one.
        case 'gronk': {
          if (this.lunging > 0) {
            this.lunging -= dt;
            this.x = clamp(this.x + this.facing * 7.4, 40, world.width - 40);
            this.pose = 'walk';
            if (meleeHits(this.x, this.y, this.facing, player.x, player.y, 80, DEPTH_ENEMY_MELEE + 6)) {
              player.takeDamage(this.def.dmg + 3, this.x);
              shakeTimer = Math.max(shakeTimer, 160);
              this.lunging = 0;
            }
            return true;
          }
          if (this.traitCd <= 0) {
            const d = Math.hypot(player.x - this.x, player.y - this.y);
            this.traitCd = 3600;
            if (d < 100) {
              shakeTimer = Math.max(shakeTimer, 220);
              hitStopTimer = Math.max(hitStopTimer, 80);
              this.say(GRONK_LINES[Math.floor(Math.random() * GRONK_LINES.length)], 1000);
              if (Math.abs(player.x - this.x) < 120 && Math.abs(player.y - this.y) < 80) {
                player.takeDamage(this.def.dmg + 4, this.x);
              }
              spawnHit(this.x, this.y, '#ff8c3c', 16, 1.5);
              spawnImpactRing(this.x, this.y - 10, '#fff');
            } else {
              this.facing = player.x > this.x ? 1 : -1;
              this.lunging = 420;
              this.say(GRONK_LINES[Math.floor(Math.random() * GRONK_LINES.length)], 1000);
            }
            return true;
          }
          return false;
        }

        default: return false;
      }
    }

    tickSummon(dt, world) {
      this.summonCd -= dt;
      if (this.summonCd <= 0) {
        this.summonCd = 5000;
        world.spawnExtra('vulture', this.x + rand(-80, 80), clamp(this.y + rand(-30, 30), BAND_TOP, BAND_BOTTOM));
      }
    }
  }

  function assignEngagement(list) {
    let count = 0;
    for (const en of list) if (en.alive && en.engaged) count++;
    for (const en of list) {
      if (!en.alive || en.engaged) continue;
      if (count < MAX_ENGAGED) { en.engaged = true; count++; }
    }
  }

  // ============================================================
  // Levels
  // ============================================================
  function wave(triggerX, spawns) { return { triggerX, spawns, spawned: false }; }

  const LEVELS = [
    {
      name: 'The UDK War Room', theme: 'draft', width: 2200,
      waves: [
        wave(200, [['draftee', 700, 380], ['draftee', 760, 440]]),
        wave(700, [['draftee', 1150, 370], ['zombie', 1220, 430], ['draftee', 1260, 400]]),
        wave(1500, [['lateround', 1900, 400]]),
      ],
    },
    {
      name: 'Fantasy Vulture Swamp', theme: 'swamp', width: 2400,
      waves: [
        wave(200, [['vulture', 700, 350], ['zombie', 760, 430]]),
        wave(800, [['vulture', 1200, 340], ['vulture', 1260, 380], ['zombie', 1300, 440]]),
        wave(1600, [['alphavulture', 2050, 380]]),
      ],
    },
    {
      name: 'DFS & Betting Floor', theme: 'vegas', width: 2400,
      waves: [
        wave(200, [['bookie', 700, 380], ['roller', 780, 430]]),
        wave(800, [['bookie', 1150, 360], ['bookie', 1220, 430], ['roller', 1280, 400]]),
        wave(1600, [['cardshark', 2050, 400]]),
      ],
    },
    {
      name: 'Megalabowl Colosseum', theme: 'colosseum', width: 2600,
      waves: [
        wave(200, [['rival', 700, 370], ['talker', 780, 430]]),
        wave(900, [['rival', 1200, 360], ['rival', 1260, 430], ['talker', 1320, 400]]),
        wave(1800, [['formerchamp', 2250, 400]]),
      ],
    },
    { name: 'The Gate of Number Twooooo', theme: 'boss', width: 1400, boss: true, waves: [] },
  ];

  // ============================================================
  // Game state
  // ============================================================
  let state = 'loading';
  let musicMuted = false;
  let selectedChar = 'andy', selIndex = 0;
  const CHAR_ORDER = ['andy', 'jason', 'mike'];

  let levelIdx = 0, player = null, enemies = [], camX = 0;
  let world = { width: 2000, spawnExtra: null, enemies: [] };
  let bannerTimer = 0, bannerText = '', bannerSub = '';
  let boss = null, winTimer = 0;
  let bossTwins = [], mergeTimer = 0, mergeDone = false;
  let mergeAX = 0, mergeAY = 0, mergeBX = 0, mergeBY = 0;
  let lives = 4;
  const START_LIVES = 4;

  // ---- score (the arcade loop the genre is built on) -------------------
  let score = 0, scoreShown = 0;
  let stageStats = null;      // { kills, bestCombo, deaths, startScore }
  let tally = null;           // end-of-stage results screen state
  let highScore = 0;
  try { highScore = parseInt(localStorage.getItem('ffb_highscore') || '0', 10) || 0; } catch (e) { highScore = 0; }

  function addScore(n, x, y, label) {
    score += n;
    if (x != null) spawnDmgPopup(x, y, (label ? label + ' ' : '') + '+' + n, '#ffd23f');
  }
  function saveHighScore() {
    if (score > highScore) {
      highScore = score;
      try { localStorage.setItem('ffb_highscore', String(highScore)); } catch (e) { /* private mode */ }
    }
  }
  function rankFor(pct) {
    if (pct >= 0.95) return 'S';
    if (pct >= 0.85) return 'A';
    if (pct >= 0.70) return 'B';
    if (pct >= 0.55) return 'C';
    if (pct >= 0.40) return 'D';
    return 'F';
  }

  function startGame() {
    player = new Player(selectedChar);
    levelIdx = 0; lives = START_LIVES;
    score = 0; scoreShown = 0; tally = null;
    loadLevel(0);
    state = 'playing';
  }

  function loadLevel(idx) {
    const lvl = LEVELS[idx];
    enemies = []; projectiles = []; particles = []; popups = []; pickups = [];
    camX = 0;
    world.width = lvl.width;
    world.enemies = enemies;
    world.spawnExtra = (key, x, y) => enemies.push(new Enemy(key, x, y));
    player.x = 100; player.y = GROUND_Y;
    player.health = player.maxHealth;
    player.invuln = 900;
    player.releaseGrab();
    for (const w of lvl.waves) w.spawned = false;
    boss = null;
    bossTwins = []; mergeTimer = 0;

    if (lvl.boss) {
      boss = new Enemy('runnerup', world.width * 0.65, GROUND_Y, {
        name: 'NUMBER TWOOOOO', hp: 340, speed: 1.3, dmg: 10, atkRange: 90, atkCd: 1400, size: 4, customAI: true,
      });
      boss.phase = 1; boss.enraged = false; boss.attackTelegraph = null;
      boss.slamCd = 2400; boss.fireCd = 1600; boss.summonCd2 = 7000;
      boss.sx = 1; boss.sy = 1; boss.recoil = 0; boss.lastPhase = 1; boss.split = false;
      enemies.push(boss);
    }

    stageStats = { kills: 0, bestCombo: 0, deaths: 0, startScore: score, startLives: lives };

    bannerText = lvl.name;
    bannerSub = idx === 0 ? 'J: punch (tap x3 to combo)   K: heavy   L: special   double-tap: dash' : '';
    bannerTimer = 2600;
  }

  function checkWaves() {
    const lvl = LEVELS[levelIdx];
    for (const w of lvl.waves) {
      if (!w.spawned && camX + W * 0.55 >= w.triggerX) {
        w.spawned = true;
        for (const [key, x, y] of w.spawns) enemies.push(new Enemy(key, x, y));
      }
    }
  }
  function allWavesCleared() {
    const lvl = LEVELS[levelIdx];
    return lvl.waves.every(w => w.spawned) && enemies.length === 0;
  }

  // ============================================================
  // Boss
  // ============================================================
  function updateBoss(dt) {
    if (!boss || !boss.alive || boss.dying) return;
    boss.t += dt;
    boss.flashTimer = Math.max(0, boss.flashTimer - dt);
    boss.hurtTimer = Math.max(0, boss.hurtTimer - dt);
    boss.sayTimer = Math.max(0, boss.sayTimer - dt);

    // ease squash/stretch and hit-recoil back to rest every frame
    boss.sx += (1 - boss.sx) * 0.16;
    boss.sy += (1 - boss.sy) * 0.16;
    boss.recoil *= 0.82;
    if (Math.abs(boss.recoil) < 0.2) boss.recoil = 0;

    const hpRatio = boss.hp / boss.maxHp;

    // half health: he splits into two independent Number Twos, each
    // carrying half the remaining HP -- total is conserved, not doubled.
    if (!boss.split && hpRatio <= 0.5) {
      splitBoss();
      return;
    }

    boss.enraged = hpRatio < 0.34;
    boss.phase = hpRatio < 0.34 ? 3 : (hpRatio < 0.66 ? 2 : 1);

    // phase change: he loses a lens and some composure
    if (boss.phase !== boss.lastPhase) {
      boss.lastPhase = boss.phase;
      boss.sx = 1.3; boss.sy = 0.72;
      shakeTimer = Math.max(shakeTimer, 260);
      flashScreenTimer = 120;
      SFX.heavy();
      boss.say(boss.phase === 2 ? 'I HAVE BEEN SECOND FOR TEN YEARS'
                                : 'SECOND PLACE IS FIRST LOSER');
      spawnHit(boss.x, boss.y - 80, '#fff', 18, 1.6);
    }

    if (!player.alive) return;

    boss.facing = player.x > boss.x ? 1 : -1;
    const targetX = clamp(player.x + (player.x < boss.x ? 110 : -110), world.width * 0.3, world.width - 120);
    boss.x += (targetX - boss.x) * 0.010 * (boss.enraged ? 1.7 : 1);
    boss.y += (GROUND_Y - boss.y) * 0.02;

    if (boss.attackTelegraph) {
      boss.telegraphTimer -= dt;
      if (boss.telegraphTimer <= 0) {
        executeBossAttack(boss.attackTelegraph);
        boss.attackTelegraph = null;
      }
      return;
    }

    boss.slamCd -= dt;
    boss.fireCd -= dt;
    if (boss.phase >= 2) boss.summonCd2 -= dt;

    const nearPlayer = Math.abs(player.x - boss.x) < 170;
    if (boss.slamCd <= 0 && nearPlayer) {
      boss.slamCd = boss.enraged ? 2000 : 3000;
      boss.attackTelegraph = 'slam';
      boss.telegraphTimer = 560;
      boss.sx = 0.86; boss.sy = 1.20;   // stretch up before he comes down
      if (Math.random() < 0.45) boss.say('I AM NUMBER TWOOOOO NO MORE');
    } else if (boss.fireCd <= 0) {
      boss.fireCd = boss.enraged ? 1500 : 2300;
      // lock the aim NOW, fire after the telegraph -- so stepping off the
      // line during the windup is what saves you. Readable, TiT-style.
      boss.aimY = player.y;
      boss.attackTelegraph = 'fire';
      boss.telegraphTimer = 520;
    } else if (boss.phase >= 2 && boss.summonCd2 <= 0) {
      boss.summonCd2 = 7000;
      enemies.push(new Enemy('vulture', boss.x - 110, GROUND_Y - 20));
      enemies.push(new Enemy('vulture', boss.x + 110, GROUND_Y - 20));
      spawnPopup(boss.x, boss.y - 220, 'SUMMONING VULTURES', '#ff8c3c');
    }
  }

  function executeBossAttack(kind) {
    if (kind === 'slam') {
      shakeTimer = 320; hitStopTimer = Math.max(hitStopTimer, 90);
      boss.sx = 1.34; boss.sy = 0.66;   // hard squash on impact
      SFX.slam();
      // ground pound: big x radius but it's a shockwave along the floor, so
      // it only catches you if you're roughly at its depth
      if (Math.abs(player.x - boss.x) < 150 && Math.abs(player.y - boss.y) < 46) {
        player.takeDamage(8 + boss.phase * 2, boss.x);
      }
      spawnHit(boss.x, GROUND_Y, '#ff8c3c', 20, 1.6);
      spawnImpactRing(boss.x, GROUND_Y - 10, '#ff8c3c');
    } else if (kind === 'fire') {
      SFX.fire();
      const dir = player.x > boss.x ? 1 : -1;
      const aim = boss.aimY != null ? boss.aimY : player.y;
      // aimed shot at your locked-in lane; phase 3 adds flanking shots that
      // still leave a clear gap either side of the aimed lane
      const lanes = boss.phase >= 3 ? [aim - 52, aim, aim + 52] : (boss.phase >= 2 ? [aim, aim + 46] : [aim]);
      for (const ly of lanes) {
        const y = clamp(ly, BAND_TOP - 10, BAND_BOTTOM + 10);
        projectiles.push({
          x: boss.x + dir * 30, y, vx: dir * 5.4, dmg: 7, friendly: false,
          life: 2200, w: 14, h: 12, color: '#f4c542', trail: true,
        });
      }
    }
  }

  function splitBoss() {
    boss.split = true;
    const half = Math.max(1, Math.round(boss.maxHp / 2));
    const bx = boss.x, by = boss.y;
    const idx = enemies.indexOf(boss);
    if (idx !== -1) enemies.splice(idx, 1);

    const makeTwin = (x) => {
      const twin = new Enemy('runnerup', x, by, {
        name: 'NUMBER TWOOOOO', hp: half, speed: 1.7, dmg: 9, size: 3, customAI: true,
      });
      twin.phase = 1; twin.enraged = false; twin.attackTelegraph = null;
      twin.sx = 1; twin.sy = 1; twin.recoil = 0; twin.atkCd = 900;
      twin.isTwin = true;
      return twin;
    };
    const twinA = makeTwin(clamp(bx - 90, 60, world.width - 60));
    const twinB = makeTwin(clamp(bx + 90, 60, world.width - 60));
    enemies.push(twinA, twinB);
    bossTwins = [twinA, twinB];
    boss = null;

    spawnPopup(bx, by - 220, 'HE SPLITS IN TWO!', '#ff4d4d', true);
    shakeTimer = Math.max(shakeTimer, 320);
    flashScreenTimer = 220;
    SFX.heavy();
  }

  // a simpler combatant than the full boss -- half his HP gets half his
  // moveset: just a chase-and-bite, no slam/fire/summon telegraphs.
  // Note: t/hurtTimer/flashTimer/sayTimer/atkCd/dying are already advanced
  // by the generic Enemy.update() every enemy gets before it falls through
  // to the customAI early-return -- decrementing them again here would
  // make every twin timer run at roughly double speed.
  function updateTwin(e, dt) {
    if (!e.alive || e.dying) return;
    e.sx += (1 - e.sx) * 0.16;
    e.sy += (1 - e.sy) * 0.16;
    e.recoil *= 0.82;
    if (Math.abs(e.recoil) < 0.2) e.recoil = 0;
    if (!player.alive) return;

    e.facing = player.x > e.x ? 1 : -1;
    const d = Math.hypot(player.x - e.x, player.y - e.y);
    if (d > 62) {
      e.x = clamp(e.x + (player.x - e.x) * 0.018, 40, world.width - 40);
      e.y += (GROUND_Y - e.y) * 0.02;
    } else if (e.atkCd <= 0) {
      e.atkCd = 1250;
      e.sx = 0.85; e.sy = 1.15; e.recoil = (e.x < player.x ? -1 : 1) * 6;
      shakeTimer = Math.max(shakeTimer, 130);
      if (Math.abs(player.x - e.x) < 64 && Math.abs(player.y - e.y) < 50) {
        player.takeDamage(9, e.x);
      }
      spawnHit(e.x, e.y - 60, '#ff8c3c', 10, 1.2);
    }
  }

  function startTwoMerge(twinA, twinB) {
    mergeAX = twinA.x; mergeAY = twinA.y;
    mergeBX = twinB.x; mergeBY = twinB.y;
    mergeTimer = 0; mergeDone = false;
    state = 'twomerge';
    Music.play('title'); // reused as the triumphant finale theme
  }

  function drawTwoMerge(dt) {
    mergeTimer += dt;
    const t = mergeTimer;
    ctx.fillStyle = '#0d1a10';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) {
      const cx = (i * 53 + t * 0.15) % W;
      const cy = (i * 97 + t * 0.2) % H;
      px(ctx, cx, cy, 4, 4, i % 2 === 0 ? '#ffd23f' : '#ff6b6b');
    }

    const slideEnd = 900, flashEnd = 1150;
    if (t < slideEnd) {
      const q = clamp(t / slideEnd, 0, 1);
      const e = q * q * (3 - 2 * q); // ease -- they accelerate together
      const ax = mergeAX + (W / 2 - 40 - mergeAX) * e, ay = mergeAY + (H / 2 - mergeAY) * e;
      const bx = mergeBX + (W / 2 + 40 - mergeBX) * e, by = mergeBY + (H / 2 - mergeBY) * e;
      ctx.save(); ctx.translate(ax, ay); draw2Glyph(ctx, '#3b5bdb'); ctx.restore();
      ctx.save(); ctx.translate(bx, by); draw2Glyph(ctx, '#3b5bdb'); ctx.restore();
    } else if (t < flashEnd) {
      ctx.globalAlpha = 0.7 * (1 - (t - slideEnd) / (flashEnd - slideEnd));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    } else {
      const pop = clamp((t - flashEnd) / 260, 0, 1);
      const s = 0.6 + 0.4 * pop;
      ctx.save(); ctx.translate(W / 2 - 40, H / 2); ctx.scale(s, s); draw5Glyph(ctx, '#ffd23f'); ctx.restore();
      ctx.save(); ctx.translate(W / 2 + 40, H / 2); ctx.scale(s, s); draw5Glyph(ctx, '#ffd23f'); ctx.restore();

      if (t > flashEnd + 200) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px monospace';
        ctx.globalAlpha = clamp((t - flashEnd - 200) / 300, 0, 1);
        ctx.fillText('SOMEHOW... STILL SECOND?', W / 2, H / 2 + 120);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
      }
    }

    if (t > 3000 && !mergeDone) {
      mergeDone = true;
      addScore(5000, W / 2, H / 2 - 200, 'BOSS');
      saveHighScore();
      state = 'win'; winTimer = 0;
      SFX.levelUp();
    }
  }

  // ============================================================
  // Update
  // ============================================================
  let lastTs = 0;
  function update(dt) {
    dt = clamp(dt, 0, 40);
    shakeTimer = Math.max(0, shakeTimer - dt);
    flashScreenTimer = Math.max(0, flashScreenTimer - dt);
    if (bannerTimer > 0) bannerTimer -= dt;
    if (state !== 'playing') return;

    let simDt = dt;
    if (hitStopTimer > 0) { hitStopTimer -= dt; simDt = dt * 0.12; }

    player.update(simDt, world, enemies);
    player.resolveHits(enemies, simDt);
    camX = clamp(player.x - W / 2, 0, Math.max(0, world.width - W));

    checkWaves();
    assignEngagement(enemies);

    for (const en of enemies) en.update(simDt, player, world);
    enemies = enemies.filter(en => {
      if (!en.alive) { if (en === boss) onBossDefeated(); return false; }
      return true;
    });
    world.enemies = enemies;

    if (boss) updateBoss(simDt);
    if (bossTwins.length) {
      for (const t of bossTwins) updateTwin(t, simDt);
      if (bossTwins.every((t) => !t.alive)) {
        startTwoMerge(bossTwins[0], bossTwins[1]);
        bossTwins = [];
      }
    }

    // ---- projectiles ---------------------------------------------------
    const step = simDt / 16;
    for (const p of projectiles) {
      p.x += p.vx * step;
      if (p.vy) p.y += p.vy * step;
      p.life -= simDt;
      if (p.trail && Math.random() < 0.5) {
        particles.push({ x: p.x, y: p.y, vx: -p.vx * 0.1, vy: rand(-0.4, 0.4), life: 10, color: '#ffd23f88' });
      }
    }
    for (const p of projectiles) {
      if (p.life <= 0) continue;
      if (p.friendly) {
        for (const en of enemies) {
          if (!en.alive || en.dying || en.thrown) continue;
          if (pointHits(p.x, p.y, en.x, en.y, 22 + (p.big ? 8 : 0), DEPTH_PLAYER_ATTACK)) {
            en.takeDamage(p.dmg, p.x - p.vx, 14, true);
            p.life = 0;
            player.meter = clamp(player.meter + 8, 0, player.maxMeter);
            hitStopTimer = Math.max(hitStopTimer, 70);
            SFX.heavy();
            spawnHit(en.x, en.y - 55, '#ff8c3c', 12, 1.3);
            break;
          }
        }
      } else if (player.alive) {
        if (p.rainDrop) {
          // falls straight down through the whole depth band -- dodge is
          // sideways (X), not the usual up/down depth-lane step
          if (Math.abs(p.x - player.x) < 17) {
            player.takeDamage(p.dmg, p.x);
            p.life = 0;
          }
        } else if (pointHits(p.x, p.y, player.x, player.y, 18, DEPTH_PROJECTILE)) {
          // TIGHT depth window: a small step up or down slips the shot
          player.takeDamage(p.dmg, p.x);
          p.life = 0;
        }
      }
    }
    projectiles = projectiles.filter(p => p.life > 0 && p.x > camX - 140 && p.x < camX + W + 140);

    // ---- particles / popups / pickups ----------------------------------
    for (const pt of particles) {
      if (pt.ring) { pt.r += 3.2; pt.life--; continue; }
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.2; pt.life--;
    }
    particles = particles.filter(p => p.life > 0);
    for (const pop of popups) { pop.y -= (pop.dmg ? 0.036 : 0.012) * dt; pop.life -= dt; }
    popups = popups.filter(p => p.life > 0);

    for (const pk of pickups) {
      pk.t += dt; pk.life -= dt;
      if (player.alive && Math.abs(pk.x - player.x) < 36 && Math.abs(pk.y - player.y) < 34) {
        player.health = clamp(player.health + pk.heal, 0, player.maxHealth);
        spawnDmgPopup(player.x, player.y - 115, '+' + pk.heal, '#3ddc6b');
        spawnHit(player.x, player.y - 60, '#3ddc6b');
        SFX.pickup();
        pk.life = 0;
      }
    }
    pickups = pickups.filter(pk => pk.life > 0);

    // ---- life / progression --------------------------------------------
    if (!player.alive) {
      if (stageStats) stageStats.deaths++;
      if (lives > 1) {
        lives--;
        player.alive = true;
        player.health = Math.round(player.maxHealth * 0.6);
        player.invuln = 1800;
        player.knockX = 0;
        player.releaseGrab();
        bannerText = 'GET BACK IN THERE'; bannerSub = ''; bannerTimer = 1400;
      } else { saveHighScore(); state = 'gameover'; }
    } else if (state === 'playing' && !boss && allWavesCleared() && bannerTimer <= 0) {
      // guarded on state still being 'playing' -- splitBoss()/startTwoMerge()
      // can change state earlier in this same tick (boss null, enemies empty
      // right when the twins die), which would otherwise also look like a
      // normal "waves cleared" moment and clobber the merge cutscene.
      beginTally();
    }
  }

  function onBossDefeated() {
    addScore(5000, boss.x, boss.y - 200, 'BOSS');
    saveHighScore();
    state = 'win'; winTimer = 0;
    SFX.levelUp();
  }

  function beginTally() {
    const s = stageStats || { kills: 0, bestCombo: 0, deaths: 0, startLives: lives };
    const noDeathBonus = s.deaths === 0 ? 2000 : 0;
    const comboBonus = s.bestCombo * 100;
    const clearBonus = 1000;
    const hpBonus = Math.round((player.health / player.maxHealth) * 1500);
    const total = noDeathBonus + comboBonus + clearBonus + hpBonus;
    // rank blends how clean the clear was with how well you chained
    const pct = clamp(
      (s.deaths === 0 ? 0.45 : 0.12) +
      clamp(s.bestCombo / 12, 0, 1) * 0.3 +
      (player.health / player.maxHealth) * 0.25, 0, 1);
    tally = {
      rows: [
        ['STAGE CLEAR', clearBonus],
        ['KO COUNT  x' + s.kills, 0],
        ['BEST COMBO  x' + s.bestCombo, comboBonus],
        ['HEALTH REMAINING', hpBonus],
        ['NO-DEATH BONUS', noDeathBonus],
      ],
      total, awarded: 0, t: 0, rank: rankFor(pct), stage: LEVELS[levelIdx].name,
    };
    saveHighScore();
    state = 'tally';
    SFX.levelUp();
  }

  function nextLevel() {
    levelIdx++;
    if (levelIdx >= LEVELS.length) { state = 'win'; saveHighScore(); return; }
    loadLevel(levelIdx);
    state = 'playing';
  }

  // ============================================================
  // Rendering
  // ============================================================
  function drawHUD() {
    const p = player;
    ctx.save();
    ctx.font = '10px monospace';

    px(ctx, 20, 14, 40, 40, '#111');
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
    ctx.strokeRect(20, 14, 40, 40);
    ctx.save();
    ctx.beginPath(); ctx.rect(20, 14, 40, 40); ctx.clip();
    drawSprite(ctx, 40, 54, { facing: 1, scale: 1.05, spriteKey: p.def.spriteKey, tint: p.def.tint, glasses: p.def.glasses, cap: p.def.cap, guitar: p.def.guitar, beard: p.def.beard, pose: 'idle', t: p.t });
    ctx.restore();

    px(ctx, 66, 16, 174, 16, '#111');
    const hpFrac = clamp(p.health / p.maxHealth, 0, 1);
    px(ctx, 68, 18, 170 * hpFrac, 12, hpFrac > 0.3 ? '#3ddc6b' : '#ff4d4d');
    ctx.fillStyle = '#fff';
    ctx.fillText(p.def.name.split(' ')[0].toUpperCase(), 68, 44);

    for (let i = 0; i < lives; i++) px(ctx, 68 + i * 12, 48, 8, 8, '#ff6b6b');
    ctx.fillStyle = '#aaa';
    ctx.fillText('LIVES', 68 + lives * 12 + 6, 56);

    px(ctx, 20, 62, 160, 10, '#111');
    const mFrac = clamp(p.meter / p.maxMeter, 0, 1);
    const ready = p.meter >= p.def.special.cost;
    px(ctx, 22, 64, 156 * mFrac, 6, ready ? '#ffd23f' : '#4fc3f7');
    ctx.fillStyle = ready ? '#ffd23f' : '#fff';
    ctx.fillText(ready ? 'SPECIAL READY (L)' : 'SPECIAL', 186, 71);

    if (p.hypeTimer > 0) {
      ctx.fillStyle = Math.floor(p.t / 150) % 2 ? '#ffd23f' : '#fff';
      ctx.fillText('HYPED UP', 186, 82);
    }

    // score rolls up toward the real value -- arcade counters never snap
    scoreShown += (score - scoreShown) * 0.18;
    if (Math.abs(score - scoreShown) < 1) scoreShown = score;

    ctx.textAlign = 'right';
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(String(Math.floor(scoreShown)).padStart(7, '0'), W - 20, 32);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#8a92ad';
    ctx.fillText('HI ' + String(highScore).padStart(7, '0'), W - 20, 48);
    ctx.fillStyle = '#fff';
    ctx.fillText(LEVELS[levelIdx].name.toUpperCase(), W - 20, 66);
    ctx.textAlign = 'left';

    // combo counter
    if (p.comboCount >= 2 && p.comboDisplayTimer > 0) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = clamp(p.comboDisplayTimer / 400, 0, 1);
      ctx.font = 'bold 30px monospace';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(p.comboCount + ' HIT!', W - 130, 90);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.font = '10px monospace';
    }

    // active boss/miniboss: a big name banner that stays up for the whole fight
    const activeMiniboss = !boss && enemies.find((e) => e.def.miniboss && e.alive && !e.dying);
    const twinsUp = bossTwins.length > 0;
    if (boss || activeMiniboss || twinsUp) {
      let hpNow, hpMax, name, enraged;
      if (twinsUp) {
        hpNow = bossTwins.reduce((s, t) => s + Math.max(0, t.hp), 0);
        hpMax = bossTwins.reduce((s, t) => s + t.maxHp, 0);
        name = 'NUMBER TWOOOOO x2'; enraged = false;
      } else {
        const b = boss || activeMiniboss;
        hpNow = b.hp; hpMax = b.maxHp; name = b.def.name; enraged = b.enraged;
      }
      px(ctx, W / 2 - 200, 20, 400, 14, '#111');
      px(ctx, W / 2 - 198, 22, 396 * clamp(hpNow / hpMax, 0, 1), 10, enraged ? '#ff3b3b' : '#ff8c3c');
      ctx.textAlign = 'center';
      ctx.font = 'bold 19px monospace';
      ctx.fillStyle = '#0b0e18';
      ctx.fillText(name.toUpperCase(), W / 2 + 1, 47);
      ctx.fillText(name.toUpperCase(), W / 2 - 1, 47);
      ctx.fillStyle = '#fff';
      ctx.fillText(name.toUpperCase(), W / 2, 47);
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shakeTimer > 0) {
      const mag = clamp(shakeTimer / 40, 1, 5);
      ctx.translate(rand(-mag, mag), rand(-mag, mag));
    }
    const lvl = LEVELS[levelIdx];
    drawBackground(lvl.theme, camX, lvl.width);

    const drawables = [player, ...enemies].filter(Boolean);
    drawables.sort((a, b) => a.y - b.y);

    for (const d of drawables) {
      if (d === player) {
        if (d.hypeTimer > 0) {
          // "Welcome In" crowd-hype aura -- a warm ring under his feet
          ctx.globalAlpha = 0.25 + Math.sin(d.t * 0.02) * 0.1;
          ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(d.x - camX, d.y, 20, 7, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        {
          // Jason's Impression Slam has airtime purely for show -- it never
          // touches the real jump/gravity system, just this render-time arc.
          const leapZ = (d.pose === 'signature' && d.charKey === 'jason')
            ? Math.sin(clamp(d.progress, 0, 1) * Math.PI) * 46 : d.jumpZ;
          // Andy's "Welcome In" special is a spinning kick -- like Jason's
          // leap, purely a render-time flourish, not real physics.
          const spinAmt = (d.pose === 'special' && d.charKey === 'andy')
            ? clamp(d.progress, 0, 1) * Math.PI * 4 : 0;
          drawSprite(ctx, d.x - camX, d.y, {
            facing: d.facing, scale: 1, spriteKey: d.def.spriteKey, tint: d.def.tint,
            glasses: d.def.glasses, cap: d.def.cap, guitar: d.def.guitar, beard: d.def.beard, accent: d.def.accent,
            pose: d.pose, t: d.t, variant: d.charKey,
            progress: d.progress, comboStep: d.comboStep - 1,
            hurt: d.invuln > 0 && Math.floor(d.t / 70) % 2 === 0, jumpZ: leapZ, spin: spinAmt,
          });
        }
      } else if (d === boss) {
        drawRunnerUpBoss(ctx, boss, camX);
      } else if (d.isTwin) {
        drawRunnerUpBoss(ctx, d, camX, 0.72);
      } else if (d.def.shark) {
        drawSharkBoss(ctx, d, camX);
      } else if (d.def.flyer) {
        drawVulture(ctx, d.x - camX, d.y - 90 - d.jumpZ, d.t, d.facing);
      } else {
        drawSprite(ctx, d.x - camX, d.y, {
          facing: d.facing, scale: d.def.size || 1, spriteKey: d.def.spriteKey || 'renegade',
          tint: d.def.tint || '', pose: d.pose, t: d.t, progress: d.progress,
          hurt: d.hurtTimer > 0, jumpZ: d.jumpZ || 0, flash: d.flashTimer > 0, spin: d.spin || 0,
          vikingHat: d.def.vikingHat, beard: d.def.beard, beardColor: d.def.beardColor, beardLong: d.def.beardLong,
          bolt: d.def.bolt,
        });
        // dazed = grabbable: flash a prompt so the throw is discoverable
        if (d.dazed && !d.dying) {
          ctx.textAlign = 'center';
          ctx.font = 'bold 12px monospace';
          ctx.fillStyle = Math.floor(d.t / 150) % 2 ? '#8fd3ff' : '#fff';
          ctx.fillText('GRAB!', d.x - camX, d.y - 125 * (d.def.size || 1));
          ctx.textAlign = 'left';
        }
        // trait chatter -- this is where the joke actually lands
        if (d.sayTimer > 0 && d.sayText && !d.dying) {
          ctx.save();
          ctx.globalAlpha = clamp(d.sayTimer / 350, 0, 1);
          const bx = d.x - camX, by = d.y - 165 * (d.def.size || 1);
          drawBubble(ctx, bx, by, d.sayText, { baseSize: 10, maxWidth: 280, fg: '#cfd6ea', stroke: '#5c6480' });
          ctx.restore();
        }
        // hyped by a Trash Talker
        if (d.hyped > 0 && !d.dying) {
          ctx.globalAlpha = 0.5 + Math.sin(d.t * 0.02) * 0.3;
          px(ctx, d.x - camX - 14, d.y + 3, 28, 3, '#ff8c3c');
          ctx.globalAlpha = 1;
        }
        if (d.def.miniboss) {
          const topY = d.y - 130 * (d.def.size || 1) - 14;
          px(ctx, d.x - camX - 40, topY, 80, 6, '#111');
          px(ctx, d.x - camX - 38, topY + 2, 76 * clamp(d.hp / d.maxHp, 0, 1), 3, '#ff8c3c');
        }
      }
    }

    // boss aim telegraph -- shows exactly which lane is about to be fired at
    if (boss && boss.attackTelegraph === 'fire' && boss.aimY != null) {
      const dir = player.x > boss.x ? 1 : -1;
      ctx.globalAlpha = 0.35 + Math.sin(performance.now() * 0.03) * 0.2;
      ctx.fillStyle = '#ff4d4d';
      const y = boss.aimY;
      ctx.fillRect(boss.x - camX, y - 1, dir * 700, 2);
      ctx.globalAlpha = 1;
    }
    if (boss && boss.attackTelegraph === 'slam') {
      ctx.globalAlpha = 0.28 + Math.sin(performance.now() * 0.04) * 0.15;
      ctx.fillStyle = '#ff8c3c';
      ctx.beginPath();
      ctx.ellipse(boss.x - camX, GROUND_Y + 8, 150, 44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const pk of pickups) {
      const bob = Math.sin(pk.t * 0.006) * 4;
      const blink = pk.life < 2200 && Math.floor(pk.t / 120) % 2 === 0;
      if (blink) continue;
      ctx.globalAlpha = 0.3;
      px(ctx, pk.x - camX - 8, pk.y + 2, 16, 5, '#000');
      ctx.globalAlpha = 1;
      px(ctx, pk.x - camX - 7, pk.y - 14 + bob, 14, 14, '#3ddc6b');
      px(ctx, pk.x - camX - 5, pk.y - 12 + bob, 10, 4, '#eafff0');
      px(ctx, pk.x - camX - 2, pk.y - 16 + bob, 4, 4, '#fff');
    }

    for (const p of projectiles) {
      // rain drops fall through real screen-space Y, not the fixed
      // chest-height offset everything else uses
      const px_ = p.x - camX, py_ = p.rainDrop ? p.y : p.y - 52;
      if (p.riff) {
        // a real guitar riff, drawn as a soundwave instead of a block
        const dir = p.vx >= 0 ? 1 : -1;
        for (let i = 0; i < 3; i++) {
          const off = i * 9 * dir;
          const wob = Math.sin(p.x * 0.15 + i * 2) * 6;
          px(ctx, px_ - off - 3, py_ + wob - 2, 6, 4, i === 0 ? '#fff' : '#ff5a47');
        }
      } else if (p.envelope) {
        // a giant tumbling envelope -- Jason's actual literal "Mailbag"
        ctx.save();
        ctx.translate(px_, py_);
        ctx.rotate(p.x * 0.05);
        px(ctx, -14, -10, 28, 20, '#f2ead8');
        ctx.strokeStyle = '#c9bd9a'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-14, -10); ctx.lineTo(0, 2); ctx.lineTo(14, -10);
        ctx.stroke();
        px(ctx, -6, -2, 12, 3, '#ff5a47'); // a little stamp of red for "urgent"
        ctx.restore();
      } else if (p.rainDrop) {
        ctx.globalAlpha = 0.85;
        px(ctx, px_ - p.w / 2, py_ - p.h / 2, p.w, p.h, p.color);
        px(ctx, px_ - 1, py_ - p.h / 2 - 10, 2, 10, p.color); // streak trailing up
        ctx.globalAlpha = 1;
      } else {
        px(ctx, px_ - p.w / 2, py_ - p.h / 2, p.w, p.h, p.color || '#fff');
      }
    }

    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life / (pt.ring ? 14 : 20));
      if (pt.ring) {
        ctx.strokeStyle = pt.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pt.x - camX, pt.y, pt.r, 0, Math.PI * 2); ctx.stroke();
      } else {
        px(ctx, pt.x - camX, pt.y, 4, 4, pt.color);
      }
      ctx.globalAlpha = 1;
    }

    for (const pop of popups) {
      ctx.globalAlpha = Math.max(0, pop.life / pop.maxLife);
      if (pop.dmg) {
        ctx.fillStyle = pop.color;
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(pop.text, pop.x - camX, pop.y);
        ctx.textAlign = 'left';
      } else {
        drawBubble(ctx, pop.x - camX, pop.y, pop.text, { baseSize: pop.big ? 20 : 14, maxWidth: 420, fg: pop.color, bg: null, stroke: null });
      }
      ctx.globalAlpha = 1;
    }

    drawHUD();

    if (flashScreenTimer > 0) {
      ctx.globalAlpha = clamp(flashScreenTimer / 300, 0, 0.5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    if (bannerTimer > 0) {
      ctx.globalAlpha = clamp(bannerTimer / 400, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, H / 2 - 46, W, bannerSub ? 92 : 76);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(bannerText, W / 2, H / 2 + 2);
      if (bannerSub) {
        ctx.font = '12px monospace';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText(bannerSub, W / 2, H / 2 + 28);
      }
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ============================================================
  // Screens
  // ============================================================
  function drawLoading() {
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('LOADING' + '.'.repeat(Math.floor(performance.now() / 300) % 4), W / 2, H / 2);
    ctx.textAlign = 'left';
  }

  function drawTitle() {
    const t = performance.now();
    drawBackground('boss', Math.sin(t / 4000) * 100 + 100, 1400);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px monospace';
    ctx.fillText('FOOTCLAN BRAWLER', W / 2, 140);
    ctx.font = '15px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('a retro side-scrolling fighter starring the Fantasy Footballers', W / 2, 172);

    drawSprite(ctx, W / 2 - 220, 385, { facing: 1, scale: 2.2, spriteKey: CHAR_DEFS.andy.spriteKey, tint: CHAR_DEFS.andy.tint, cap: true, variant: 'andy', pose: 'walk', t });
    drawSprite(ctx, W / 2, 385, { facing: 1, scale: 2.2, spriteKey: CHAR_DEFS.jason.spriteKey, tint: CHAR_DEFS.jason.tint, glasses: true, variant: 'jason', pose: 'punch', t: t + 300, progress: (t % 800) / 800, comboStep: 0 });
    drawSprite(ctx, W / 2 + 220, 385, { facing: -1, scale: 2.2, spriteKey: CHAR_DEFS.mike.spriteKey, tint: CHAR_DEFS.mike.tint, beard: true, guitar: true, variant: 'mike', pose: 'kick', t, progress: ((t + 400) % 800) / 800 });

    ctx.font = '12px monospace';
    ctx.fillStyle = '#8fd3ff';
    ctx.fillText('MOVE arrows/WASD   PUNCH J (x3 combo)   HEAVY K   SPECIAL L   JUMP space   DASH double-tap', W / 2, 440);
    ctx.fillText('Press J+K together for a signature move — different for every host.', W / 2, 458);
    ctx.fillText('Stun an enemy, walk in and press J to GRAB — then K to throw them into the pack.', W / 2, 476);
    ctx.fillStyle = '#6a7290';
    ctx.fillText('M toggles music', W / 2, 492);

    if (Math.floor(t / 500) % 2 === 0) {
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('WELCOME IN. PRESS SPACE TO START', W / 2, 500);
    }
    ctx.textAlign = 'left';
  }

  function drawSelect() {
    ctx.fillStyle = '#0d0d18';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('CHOOSE YOUR FOOTCLANNER', W / 2, 60);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('← → to choose   SPACE to confirm', W / 2, 90);

    const def = CHAR_DEFS[CHAR_ORDER[selIndex]];
    CHAR_ORDER.forEach((k, i) => {
      const cx = W / 2 + (i - selIndex) * 240;
      const active = i === selIndex;
      ctx.globalAlpha = active ? 1 : 0.35;
      if (active) {
        px(ctx, cx - 90, 160, 180, 280, '#1b2038');
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
        ctx.strokeRect(cx - 90, 160, 180, 280);
      }
      const tt = performance.now();
      const cd = CHAR_DEFS[k];
      drawSprite(ctx, cx, 400, {
        facing: 1, scale: 2.4, spriteKey: cd.spriteKey, tint: cd.tint, glasses: cd.glasses,
        cap: cd.cap, guitar: cd.guitar, beard: cd.beard, variant: k,
        pose: active ? 'punch' : 'idle', t: tt, progress: active ? (tt % 800) / 800 : 0, comboStep: 0,
      });
      ctx.globalAlpha = 1;
    });

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(def.name, W / 2, 462);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(def.tag, W / 2, 484);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#8fd3ff';
    ctx.fillText(`SPD ${def.speed}   HP ${def.maxHealth}   COMBO ${def.combo.map(c => c.dmg).join('/')}   THROW ${def.throwDmg}`, W / 2, 500);
    ctx.fillStyle = '#ff8fc9';
    ctx.fillText(`SPECIAL (L): ${def.special.name}     J+K: ${def.signature.name}`, W / 2, 516);
    ctx.textAlign = 'left';
  }

  function drawTally(dt) {
    tally.t += dt;
    ctx.fillStyle = '#0b0e18';
    ctx.fillRect(0, 0, W, H);

    // count the bonus up like a cabinet would
    const target = tally.total;
    if (tally.awarded < target) {
      const inc = Math.max(11, Math.ceil(target / 55));
      const add = Math.min(inc, target - tally.awarded);
      tally.awarded += add;
      score += add;
      if (Math.floor(tally.t / 60) % 2 === 0) SFX.grab();
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('STAGE CLEAR', W / 2, 76);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#8a92ad';
    ctx.fillText(tally.stage.toUpperCase(), W / 2, 100);

    ctx.font = '15px monospace';
    const left = W / 2 - 200, right = W / 2 + 200;
    tally.rows.forEach((row, i) => {
      const y = 156 + i * 34;
      const shown = tally.t > i * 220;
      if (!shown) return;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#cfd6ea';
      ctx.fillText(row[0], left, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = row[1] > 0 ? '#ffd23f' : '#6a7290';
      ctx.fillText(row[1] > 0 ? '+' + row[1] : '--', right, y);
    });

    if (tally.t > 1200) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px monospace';
      ctx.fillText('SCORE  ' + String(score).padStart(7, '0'), W / 2, 356);

      // rank stamp
      const pop = clamp((tally.t - 1200) / 220, 0, 1);
      const sz = 62 * (1 + (1 - pop) * 0.8);
      ctx.save();
      ctx.globalAlpha = pop;
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
      ctx.strokeRect(W / 2 - 46, 386, 92, 84);
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold ' + Math.round(sz) + 'px monospace';
      ctx.fillText(tally.rank, W / 2, 452);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#8a92ad';
      ctx.fillText('RANK', W / 2, 402);
      ctx.restore();
    }

    if (tally.t > 1900 && Math.floor(tally.t / 500) % 2 === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px monospace';
      ctx.fillText('PRESS SPACE TO CONTINUE', W / 2, 508);
    }
    ctx.textAlign = 'left';
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(20,0,0,0.92)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4d4d';
    ctx.font = 'bold 40px monospace';
    ctx.fillText('YOU GOT BENCHED', W / 2, 240);
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.fillText('Press SPACE to try again', W / 2, 290);
    ctx.textAlign = 'left';
  }

  function drawWin() {
    winTimer += 16;
    const t = winTimer;
    ctx.fillStyle = '#0d1a10';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const cx = (i * 53 + t * 0.15) % W;
      const cy = (i * 97 + t * (0.3 + (i % 5) * 0.05)) % H;
      px(ctx, cx, cy, 6, 6, i % 3 === 0 ? '#ffd23f' : (i % 3 === 1 ? '#4fc3f7' : '#ff4fa3'));
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px monospace';
    ctx.fillText('NUMBER TWOOOOO FALLS!', W / 2, 120);
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(CHAR_DEFS[selectedChar].name, W / 2, 160);
    ctx.font = 'italic bold 16px monospace';
    ctx.fillStyle = '#8fd3ff';
    ctx.fillText(CHAR_DEFS[selectedChar].victory, W / 2, 188);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#fff';
    wrapText('earns a spot at the table. FootClan Brawler complete — ready to submit for the Fantasy Footballers Listener League.', W / 2, 214, 720, 20);

    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('FINAL SCORE  ' + String(score).padStart(7, '0'), W / 2, 268);
    ctx.font = '12px monospace';
    ctx.fillStyle = score >= highScore ? '#3ddc6b' : '#8a92ad';
    ctx.fillText(score >= highScore ? 'NEW RECORD!' : 'BEST  ' + String(highScore).padStart(7, '0'), W / 2, 290);

    const cd = CHAR_DEFS[selectedChar];
    drawSprite(ctx, W / 2, 490, {
      facing: 1, scale: 1.4, spriteKey: cd.spriteKey, tint: cd.tint, glasses: cd.glasses,
      cap: cd.cap, guitar: cd.guitar, beard: cd.beard, variant: selectedChar,
      accent: cd.accent, pose: 'special', t, progress: (t % 700) / 700,
    });

    if (Math.floor(t / 500) % 2 === 0) {
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('PRESS SPACE FOR TITLE SCREEN', W / 2, 522);
    }
    ctx.textAlign = 'left';
  }

  function wrapText(text, cx, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > maxWidth && line !== '') { lines.push(line); line = w + ' '; }
      else line = test;
    }
    lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l.trim(), cx, y + i * lineHeight));
  }

  // ============================================================
  // Main loop
  // ============================================================
  function frame(ts) {
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;

    if (tapped('KeyM')) { musicMuted = !musicMuted; Music.setVolume(musicMuted ? 0 : 0.14); }

    if (state === 'loading') drawLoading();
    else if (state === 'title') {
      Music.play('title');
      drawTitle();
      if (tapped('Space')) state = 'select';
    } else if (state === 'select') {
      Music.play('title');
      if (tapped('ArrowRight') || tapped('KeyD')) selIndex = (selIndex + 1) % CHAR_ORDER.length;
      if (tapped('ArrowLeft') || tapped('KeyA')) selIndex = (selIndex - 1 + CHAR_ORDER.length) % CHAR_ORDER.length;
      selectedChar = CHAR_ORDER[selIndex];
      drawSelect();
      if (tapped('Space')) startGame();
    } else if (state === 'playing') {
      Music.play(LEVELS[levelIdx].theme);
      update(dt);
      render();
    } else if (state === 'twomerge') {
      drawTwoMerge(clamp(dt, 0, 40));
    } else if (state === 'tally') {
      drawTally(clamp(dt, 0, 40));
      if (tapped('Space') && tally.t > 700) {
        if (tally.awarded < tally.total) {   // let impatient players skip the count
          score += tally.total - tally.awarded;
          tally.awarded = tally.total;
          tally.t = 2000;
        } else { saveHighScore(); nextLevel(); }
      }
    } else if (state === 'gameover') {
      Music.stop();
      drawGameOver();
      if (tapped('Space')) state = 'select';
    } else if (state === 'win') {
      Music.play('title');
      drawWin();
      if (tapped('Space')) state = 'title';
    }

    screenCtx.imageSmoothingEnabled = false;
    screenCtx.drawImage(buf, 0, 0, BW, BH, 0, 0, W, H);

    justPressed.clear();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  loadSprites().then(() => { state = 'title'; });

  window.__debug = {
    goto: (ch, levelIdx_) => {
      selectedChar = ch; selIndex = CHAR_ORDER.indexOf(ch);
      player = new Player(ch);
      levelIdx = levelIdx_; lives = START_LIVES; score = 0; scoreShown = 0;
      loadLevel(levelIdx_);
      state = 'playing';
      bannerTimer = 0;
    },
    clearEnemies: () => { enemies = enemies.filter(e => e === boss); },
    spawnMini: (key, x, y) => { const e = new Enemy(key, x, y); e.engaged = true; enemies.push(e); return e; },
    advance: (ms) => {
      const n = Math.round(ms / 16);
      for (let i = 0; i < n; i++) {
        if (state === 'playing') update(16);
        else if (state === 'twomerge') drawTwoMerge(16);
      }
      if (state === 'playing') render();
    },
    say: (target, text, ms) => { target.say(text, ms); },
    setMeter: (v) => { player.meter = v; },
    bossSay: (text, ms) => { if (boss) boss.say(text, ms); },
    setBossHp: (v) => { if (boss) boss.hp = v; },
    killTwins: () => { for (const t of bossTwins) { t.hp = 0; t.dying = true; t.alive = false; t.deathTimer = 0; } },
    info: () => ({ state, hasBoss: !!boss, twinCount: bossTwins.length, enemyCount: enemies.length }),
  };
})();
