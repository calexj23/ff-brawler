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
    };
  })();

  // ============================================================
  // Input (with double-tap detection for dashes)
  // ============================================================
  const keys = new Set();
  const justPressed = new Set();
  const lastTapAt = {};
  let doubleTapDir = 0, doubleTapAt = 0;

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

  function pickAnim(spriteKey, pose, progress, t, comboStep) {
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
      case 'jumpatk': return { def: set.kick2, frame: 0 };
      case 'grab': return { def: set.punch1, frame: 0 };
      case 'throw': return { def: set.kick1, frame: 0 };
      case 'special': return { def: set.special, frame: progress < 0.5 ? 0 : 1 };
      case 'hurt': return { def: set.hurt, frame: 0 };
      case 'knockdown': return { def: set.knockdown, frame: 0 };
      default: {
        const d = set.idle;
        return { def: d, frame: Math.floor((t / 1000) * d.fps) % d.frames };
      }
    }
  }

  const SPRITE_DISPLAY_SCALE = 3;

  function drawSprite(ctx, footX, footY, opts) {
    const {
      facing = 1, scale = 1, spriteKey = 'ranger', tint = '', pose = 'idle', t = 0, progress = 0,
      hurt = false, jumpZ = 0, flash = false, glasses = false, comboStep = 0, spin = 0,
    } = opts;

    const { def, frame } = pickAnim(spriteKey, pose, progress, t, comboStep);
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

    let filter = tint || '';
    if (flash) filter = (filter + ' brightness(2.6) saturate(0.15)').trim();
    else if (hurt) filter = (filter + ' brightness(1.8) saturate(0.4)').trim();
    if (filter) ctx.filter = filter;

    ctx.drawImage(rec.img, frame * rec.frameW, 0, rec.frameW, rec.frameH, -dispW / 2, -dispH, dispW, dispH);
    ctx.filter = 'none';

    if (glasses) px(ctx, -8 * scale, -dispH + 10 * scale, 16 * scale, 3 * scale, '#141414');

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

  function drawRunnerUpBoss(ctx, boss, camX) {
    const x = boss.x - camX, y = boss.y - boss.jumpZ;
    const shake = boss.enraged ? rand(-2, 2) : 0;
    const hpRatio = clamp(boss.hp / boss.maxHp, 0, 1);

    ctx.save();
    ctx.translate(x + shake + (boss.recoil || 0), y);

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

    px(ctx, -34, -14, 68, 16, bodyColor);
    px(ctx, -6, -34, 34, 16, bodyColor);
    px(ctx, -26, -54, 34, 16, bodyColor);
    px(ctx, -34, -84, 68, 16, bodyColor);
    px(ctx, -34, -70, 16, 20, bodyColor);
    px(ctx, 18, -70, 16, 20, bodyColor);
    ctx.globalAlpha = 0.25;
    px(ctx, -34, -84, 68, 4, outline);
    ctx.globalAlpha = 1;

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
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(boss.sayText).width;
      px(ctx, x - tw / 2 - 8, y - 152, tw + 16, 20, '#0d0d18');
      ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 1;
      ctx.strokeRect(x - tw / 2 - 8, y - 152, tw + 16, 20);
      ctx.fillStyle = '#ff8c8c';
      ctx.fillText(boss.sayText, x, y - 138);
      ctx.textAlign = 'left';
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

  function drawBackground(theme, camX, worldWidth) {
    const th = BG_THEMES[theme];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.sky[0]);
    grad.addColorStop(1, th.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const parX = -camX * 0.3;
    for (let i = 0; i < worldWidth / 220 + 4; i++) {
      const bx = (i * 220 + (parX % 220)) - 220;
      px(ctx, bx, 160, 90, 220, th.deco);
      ctx.globalAlpha = 0.5;
      px(ctx, bx + 20, 190, 20, 40, th.accent);
      ctx.globalAlpha = 1;
    }
    const parX2 = -camX * 0.6;
    for (let i = 0; i < worldWidth / 140 + 4; i++) {
      const bx = (i * 140 + (parX2 % 140)) - 140;
      ctx.globalAlpha = 0.6;
      px(ctx, bx, 300, 50, 130, th.deco);
      ctx.globalAlpha = 1;
    }

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

  const CHAR_DEFS = {
    andy: {
      name: 'Andy "The Spitballer" Holloway',
      tag: 'Fastest hands. Long combo strings, quick dash.',
      spriteKey: 'ranger', tint: '', glasses: false, accent: '#ffd23f',
      speed: 3.9, jumpPow: 13.5, maxHealth: 105,
      combo: comboSet(7, 8, 15),
      kick: { dmg: 12, range: 54, dur: 300, strike: 0.28, cd: 340, knock: 20, knockdown: true, heavy: true },
      special: { name: 'Zinger Barrage', cost: 30, dmg: 26, range: 105, cd: 700, aoe: true },
      throwDmg: 20,
    },
    jason: {
      name: 'Jason "The Impressionist" Moore',
      tag: 'All-rounder. Screen-clearing special.',
      spriteKey: 'renegade', tint: 'hue-rotate(280deg) saturate(1.3)', glasses: false, accent: '#ffb703',
      speed: 3.4, jumpPow: 14.5, maxHealth: 115,
      combo: comboSet(8, 9, 17),
      kick: { dmg: 13, range: 56, dur: 310, strike: 0.28, cd: 360, knock: 22, knockdown: true, heavy: true },
      special: { name: 'Impression Roulette', cost: 35, dmg: 30, range: 150, cd: 800, aoe: true },
      throwDmg: 23,
    },
    mike: {
      name: 'Mike "The Hitman" Wright',
      tag: 'Heaviest hits and throws. Ranged special.',
      spriteKey: 'ranger', tint: 'hue-rotate(190deg) saturate(0.55) brightness(0.7)', glasses: true, accent: '#ff3b3b',
      speed: 3.0, jumpPow: 12.5, maxHealth: 135,
      combo: comboSet(10, 11, 21),
      kick: { dmg: 16, range: 56, dur: 330, strike: 0.30, cd: 400, knock: 26, knockdown: true, heavy: true },
      special: { name: 'The Hit', cost: 40, dmg: 38, range: 999, cd: 900, projectile: true },
      throwDmg: 28,
    },
  };

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

  const MINIBOSS_DEFS = {
    lateround: { name: 'The Late-Round QB', hp: 90, speed: 1.5, dmg: 9, atkRange: 260, atkCd: 1200, size: 1.5, ranged: true, miniboss: true,
      spriteKey: 'renegade', tint: 'hue-rotate(220deg) saturate(1.4)', projColor: '#f4c542',
      trait: 'spiral', points: 1000 },
    alphavulture: { name: 'Alpha Vulture', hp: 105, speed: 2.0, dmg: 8, atkRange: 44, atkCd: 950, size: 1.8, flyer: true, summons: true, miniboss: true,
      trait: 'divebomb', points: 1200 },
    cardshark: { name: 'The Card Shark', hp: 135, speed: 2.1, dmg: 9, atkRange: 240, atkCd: 1250, size: 1.5, ranged: true, miniboss: true,
      spriteKey: 'ranger', tint: 'hue-rotate(300deg) saturate(1.5) brightness(0.85)', projColor: '#ff4fa3',
      trait: 'cardfan', points: 1400 },
    formerchamp: { name: 'The Former Champ', hp: 165, speed: 2.0, dmg: 11, atkRange: 50, atkCd: 850, size: 1.7, miniboss: true,
      spriteKey: 'renegade', tint: 'hue-rotate(345deg) saturate(1.5) brightness(0.75)', projColor: '#ffd23f',
      trait: 'tackle', points: 1600 },
  };

  const TRASH_TALK = [
    'YOUR RB1 IS ON BYE',
    'YOU DRAFTED A KICKER EARLY',
    'ZERO-RB WAS A MISTAKE',
    'I HAD HIM ON MY BENCH',
    'THAT TRADE WAS A FLEECE',
  ];

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
    popups.push({ x, y, text, life: 45, color: color || '#fff', big: !!big });
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
    }
    get progress() { return this.poseDuration > 0 ? clamp(1 - this.poseTimer / this.poseDuration, 0, 1) : 1; }
    get busy() { return this.poseTimer > 0 && this.attackKind !== null; }
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
      spawnPopup(this.x, this.y - 105, '-' + dmg, '#ff6b6b');
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
      SFX.whiff();
    }

    update(dt, world, enemies) {
      this.t += dt;
      this.invuln = Math.max(0, this.invuln - dt);
      this.kickCd = Math.max(0, this.kickCd - dt);
      this.specialCd = Math.max(0, this.specialCd - dt);
      this.dashCd = Math.max(0, this.dashCd - dt);
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
        if (tapped('KeyJ')) {
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
        } else if (tapped('KeyK') && this.kickCd <= 0 && this.jumpZ === 0) {
          this.startAttack('kick', this.def.kick);
          this.kickCd = this.def.kick.cd;
        } else if (tapped('KeyL') && this.specialCd <= 0 && this.meter >= this.def.special.cost) {
          const sp = this.def.special;
          this.startAttack('special', { dmg: sp.dmg, range: sp.range, dur: 460, strike: 0.3, knock: 30, aoe: sp.aoe, projectile: sp.projectile, knockdown: true, heavy: true });
          this.meter -= sp.cost;
          this.specialCd = sp.cd;
          this.invuln = Math.max(this.invuln, 460); // special = brief i-frames, classic panic button
          flashScreenTimer = 140;
          SFX.special();
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
          this.x = clamp(this.x + (dx / len) * this.def.speed, 40, world.width - 40);
          // vertical is intentionally close to full speed -- dodging must feel immediate
          this.y = clamp(this.y + (dy / len) * this.def.speed * 0.85, BAND_TOP, BAND_BOTTOM);
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
            x: this.x + this.facing * 24, y: this.y, vx: this.facing * 11,
            dmg: spec.dmg, friendly: true, life: 1800, color: '#ff8c3c', w: 18, h: 8, big: true,
          });
          SFX.fire();
        } else {
          this.hitbox = {
            dmg: spec.dmg, range: spec.range, knock: spec.knock, knockdown: spec.knockdown,
            aoe: spec.aoe, heavy: spec.heavy, life: 130, hitSet: new Set(),
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
      for (const en of enemies) {
        if (!en.alive || en.dying || en.thrown || hb.hitSet.has(en)) continue;
        const depth = hb.aoe ? 90 : DEPTH_PLAYER_ATTACK;
        if (meleeHits(this.x, this.y, this.facing, en.x, en.y, hb.range, depth)
          || (hb.aoe && Math.abs(en.x - this.x) < hb.range && Math.abs(en.y - this.y) < 90)) {
          hb.hitSet.add(en);
          en.takeDamage(hb.dmg, this.x, hb.knock, hb.knockdown);
          this.meter = clamp(this.meter + (hb.heavy ? 12 : 7), 0, this.maxMeter);
          this.comboCount++;
          this.comboDisplayTimer = 1400;
          // deeper combos are worth more per hit -- the reason to keep the chain alive
          score += 10 * Math.min(this.comboCount, 10);
          if (stageStats && this.comboCount > stageStats.bestCombo) stageStats.bestCombo = this.comboCount;
          hitStopTimer = Math.max(hitStopTimer, hb.heavy ? 95 : 62);
          if (hb.heavy) { shakeTimer = Math.max(shakeTimer, 160); SFX.heavy(); }
          else SFX.hit();
          spawnHit(en.x, en.y - 58, '#ffd23f', hb.heavy ? 14 : 8, hb.heavy ? 1.6 : 1);
          spawnImpactRing(en.x, en.y - 58, '#fff');
          if (!hb.aoe) { this.hitbox = null; break; }
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
    }
    get progress() { return this.attackDuration > 0 ? clamp(1 - this.attackTimer / this.attackDuration, 0, 1) : 0; }

    say(text, ms) {
      this.sayText = text; this.sayTimer = ms || 1400;
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
      spawnPopup(this.x, this.y - 100, '-' + dmg, '#ffd23f');

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

        // --- Former Champ: charging shoulder tackle
        case 'tackle': {
          if (this.lunging > 0) {
            this.lunging -= dt;
            this.x = clamp(this.x + this.facing * 8.5, 40, world.width - 40);
            this.pose = 'walk';
            if (meleeHits(this.x, this.y, this.facing, player.x, player.y, 56, DEPTH_ENEMY_MELEE + 6)) {
              player.takeDamage(this.def.dmg + 4, this.x);
              shakeTimer = Math.max(shakeTimer, 180);
              this.lunging = 0;
            }
            return true;
          }
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (this.traitCd <= 0 && d > 90) {
            this.traitCd = 4000;
            this.facing = player.x > this.x ? 1 : -1;
            this.lunging = 520;
            this.say('RING THE BELL', 1100);
            spawnPopup(this.x, this.y - 150, 'CHARGING!', '#ff5a47');
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
    { name: 'The Gate of the Runner-Up', theme: 'boss', width: 1400, boss: true, waves: [] },
  ];

  // ============================================================
  // Game state
  // ============================================================
  let state = 'loading';
  let selectedChar = 'andy', selIndex = 0;
  const CHAR_ORDER = ['andy', 'jason', 'mike'];

  let levelIdx = 0, player = null, enemies = [], camX = 0;
  let world = { width: 2000, spawnExtra: null, enemies: [] };
  let bannerTimer = 0, bannerText = '', bannerSub = '';
  let boss = null, winTimer = 0;
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
    if (x != null) spawnPopup(x, y, (label ? label + ' ' : '') + '+' + n, '#ffd23f');
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

    if (lvl.boss) {
      boss = new Enemy('runnerup', world.width * 0.65, GROUND_Y, {
        name: 'The Runner-Up', hp: 340, speed: 1.3, dmg: 10, atkRange: 90, atkCd: 1400, size: 4, customAI: true,
      });
      boss.phase = 1; boss.enraged = false; boss.attackTelegraph = null;
      boss.slamCd = 2400; boss.fireCd = 1600; boss.summonCd2 = 7000;
      boss.sx = 1; boss.sy = 1; boss.recoil = 0; boss.lastPhase = 1;
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
      if (Math.random() < 0.45) boss.say('RUNNER-UP NO MORE');
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

    // ---- projectiles ---------------------------------------------------
    const step = simDt / 16;
    for (const p of projectiles) {
      p.x += p.vx * step;
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
        // TIGHT depth window: a small step up or down slips the shot
        if (pointHits(p.x, p.y, player.x, player.y, 18, DEPTH_PROJECTILE)) {
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
    for (const pop of popups) { pop.y -= 0.6; pop.life--; }
    popups = popups.filter(p => p.life > 0);

    for (const pk of pickups) {
      pk.t += dt; pk.life -= dt;
      if (player.alive && Math.abs(pk.x - player.x) < 36 && Math.abs(pk.y - player.y) < 34) {
        player.health = clamp(player.health + pk.heal, 0, player.maxHealth);
        spawnPopup(player.x, player.y - 115, '+' + pk.heal, '#3ddc6b');
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
    } else if (!boss && allWavesCleared() && bannerTimer <= 0) {
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
    drawSprite(ctx, 40, 54, { facing: 1, scale: 1.05, spriteKey: p.def.spriteKey, tint: p.def.tint, glasses: p.def.glasses, pose: 'idle', t: p.t });
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

    if (boss) {
      px(ctx, W / 2 - 200, 16, 400, 16, '#111');
      px(ctx, W / 2 - 198, 18, 396 * clamp(boss.hp / boss.maxHp, 0, 1), 12, boss.enraged ? '#ff3b3b' : '#ff8c3c');
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText('THE RUNNER-UP', W / 2, 12);
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
        drawSprite(ctx, d.x - camX, d.y, {
          facing: d.facing, scale: 1, spriteKey: d.def.spriteKey, tint: d.def.tint,
          glasses: d.def.glasses, accent: d.def.accent, pose: d.pose, t: d.t,
          progress: d.progress, comboStep: d.comboStep - 1,
          hurt: d.invuln > 0 && Math.floor(d.t / 70) % 2 === 0, jumpZ: d.jumpZ,
        });
      } else if (d === boss) {
        drawRunnerUpBoss(ctx, boss, camX);
      } else if (d.def.flyer) {
        drawVulture(ctx, d.x - camX, d.y - 90 - d.jumpZ, d.t, d.facing);
      } else {
        drawSprite(ctx, d.x - camX, d.y, {
          facing: d.facing, scale: d.def.size || 1, spriteKey: d.def.spriteKey || 'renegade',
          tint: d.def.tint || '', pose: d.pose, t: d.t, progress: d.progress,
          hurt: d.hurtTimer > 0, jumpZ: d.jumpZ || 0, flash: d.flashTimer > 0, spin: d.spin || 0,
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
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          const tw = ctx.measureText(d.sayText).width;
          const bx = d.x - camX, by = d.y - 140 * (d.def.size || 1);
          px(ctx, bx - tw / 2 - 5, by - 11, tw + 10, 15, '#0d0d18');
          ctx.strokeStyle = '#5c6480'; ctx.lineWidth = 1;
          ctx.strokeRect(bx - tw / 2 - 5, by - 11, tw + 10, 15);
          ctx.fillStyle = '#cfd6ea';
          ctx.fillText(d.sayText, bx, by);
          ctx.textAlign = 'left';
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
      px(ctx, p.x - camX - p.w / 2, p.y - 52 - p.h / 2, p.w, p.h, p.color || '#fff');
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
      ctx.globalAlpha = Math.max(0, pop.life / 45);
      ctx.fillStyle = pop.color;
      ctx.font = 'bold ' + (pop.big ? 20 : 14) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(pop.text, pop.x - camX, pop.y);
      ctx.textAlign = 'left';
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

    drawSprite(ctx, W / 2 - 220, 385, { facing: 1, scale: 2.2, spriteKey: CHAR_DEFS.andy.spriteKey, tint: CHAR_DEFS.andy.tint, pose: 'walk', t });
    drawSprite(ctx, W / 2, 385, { facing: 1, scale: 2.2, spriteKey: CHAR_DEFS.jason.spriteKey, tint: CHAR_DEFS.jason.tint, pose: 'punch', t: t + 300, progress: (t % 800) / 800, comboStep: 0 });
    drawSprite(ctx, W / 2 + 220, 385, { facing: -1, scale: 2.2, spriteKey: CHAR_DEFS.mike.spriteKey, tint: CHAR_DEFS.mike.tint, glasses: true, pose: 'kick', t, progress: ((t + 400) % 800) / 800 });

    ctx.font = '12px monospace';
    ctx.fillStyle = '#8fd3ff';
    ctx.fillText('MOVE arrows/WASD   PUNCH J (x3 combo)   HEAVY K   SPECIAL L   JUMP space   DASH double-tap', W / 2, 440);
    ctx.fillText('Stun an enemy, walk in and press J to GRAB — then K to throw them into the pack.', W / 2, 460);

    if (Math.floor(t / 500) % 2 === 0) {
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('PRESS SPACE TO START', W / 2, 500);
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
    ctx.fillText(`SPD ${def.speed}   HP ${def.maxHealth}   COMBO ${def.combo.map(c => c.dmg).join('/')}   THROW ${def.throwDmg}   ${def.special.name}`, W / 2, 506);
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
    ctx.fillText('THE RUNNER-UP FALLS!', W / 2, 120);
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(CHAR_DEFS[selectedChar].name, W / 2, 160);
    ctx.font = '15px monospace';
    ctx.fillStyle = '#fff';
    wrapText('earns a spot at the table. FootClan Brawler complete — ready to submit for the Fantasy Footballers Listener League.', W / 2, 196, 720, 22);

    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('FINAL SCORE  ' + String(score).padStart(7, '0'), W / 2, 268);
    ctx.font = '12px monospace';
    ctx.fillStyle = score >= highScore ? '#3ddc6b' : '#8a92ad';
    ctx.fillText(score >= highScore ? 'NEW RECORD!' : 'BEST  ' + String(highScore).padStart(7, '0'), W / 2, 290);

    const cd = CHAR_DEFS[selectedChar];
    drawSprite(ctx, W / 2, 450, {
      facing: 1, scale: 2.6, spriteKey: cd.spriteKey, tint: cd.tint, glasses: cd.glasses,
      accent: cd.accent, pose: 'special', t, progress: (t % 700) / 700,
    });

    if (Math.floor(t / 500) % 2 === 0) {
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('PRESS SPACE FOR TITLE SCREEN', W / 2, 505);
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

    if (state === 'loading') drawLoading();
    else if (state === 'title') {
      drawTitle();
      if (tapped('Space')) state = 'select';
    } else if (state === 'select') {
      if (tapped('ArrowRight') || tapped('KeyD')) selIndex = (selIndex + 1) % CHAR_ORDER.length;
      if (tapped('ArrowLeft') || tapped('KeyA')) selIndex = (selIndex - 1 + CHAR_ORDER.length) % CHAR_ORDER.length;
      selectedChar = CHAR_ORDER[selIndex];
      drawSelect();
      if (tapped('Space')) startGame();
    } else if (state === 'playing') {
      update(dt);
      render();
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
      drawGameOver();
      if (tapped('Space')) state = 'select';
    } else if (state === 'win') {
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
})();
