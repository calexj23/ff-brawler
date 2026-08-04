(function () {
  'use strict';

  // ============================================================
  // Setup
  // ============================================================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const W = canvas.width, H = canvas.height;

  const GROUND_Y = 400;          // baseline y for the ground band
  const BAND_TOP = GROUND_Y - 60;
  const BAND_BOTTOM = GROUND_Y + 70;
  const GRAVITY = 0.7;

  // ============================================================
  // Input
  // ============================================================
  const keys = new Set();
  const justPressed = new Set();
  window.addEventListener('keydown', (e) => {
    if (!keys.has(e.code)) justPressed.add(e.code);
    keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyJ', 'KeyK', 'KeyL'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  function pressed(code) { return keys.has(code); }
  function tapped(code) { return justPressed.has(code); }

  // ============================================================
  // Utility
  // ============================================================
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ============================================================
  // Procedural pixel-block sprite drawing
  // ============================================================
  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  // Draws a blocky retro humanoid. footX/footY = ground contact point.
  function drawFigure(ctx, footX, footY, opts) {
    const {
      facing = 1, scale = 1, palette, pose = 'idle', t = 0,
      hurt = false, jumpZ = 0, flash = false
    } = opts;
    const s = scale;
    const bob = pose === 'walk' ? Math.sin(t * 0.02) * 2 * s : 0;
    const baseY = footY - jumpZ;

    ctx.save();
    ctx.translate(footX, baseY);
    if (facing < 0) ctx.scale(-1, 1);

    if (flash) {
      ctx.filter = 'brightness(2) saturate(0)';
    } else if (hurt) {
      ctx.filter = 'brightness(1.6) hue-rotate(-20deg)';
    }

    // shadow
    ctx.filter = 'none';
    ctx.globalAlpha = 0.35;
    px(ctx, -14 * s, 2, 28 * s, 6 * s, '#000');
    ctx.globalAlpha = 1;
    if (hurt) ctx.filter = 'brightness(1.6) saturate(0.4)';
    if (flash) ctx.filter = 'brightness(2.2)';

    const legSwing = pose === 'walk' ? Math.sin(t * 0.02) * 10 * s : 0;
    const legSwing2 = pose === 'walk' ? Math.sin(t * 0.02 + Math.PI) * 10 * s : 0;

    // legs
    const legY = -34 * s + bob;
    px(ctx, -10 * s + legSwing * 0.3, legY, 8 * s, 34 * s, palette.pants);
    px(ctx, 2 * s + legSwing2 * 0.3, legY, 8 * s, 34 * s, palette.pants);

    // torso
    const torsoY = -66 * s + bob;
    px(ctx, -12 * s, torsoY, 24 * s, 34 * s, palette.shirt);

    // arms
    let armFY = -60 * s + bob;
    let backArmX = -20 * s, frontArmX = 10 * s;
    let armLen = 8 * s, armH = 24 * s;

    if (pose === 'punch') {
      px(ctx, 10 * s, armFY + 4 * s, 26 * s, 8 * s, palette.skin); // extended punch arm
      px(ctx, backArmX, armFY, armLen, armH, palette.shirt);
    } else if (pose === 'kick') {
      px(ctx, backArmX, armFY, armLen, armH, palette.shirt);
      px(ctx, frontArmX, armFY, armLen, armH, palette.shirt);
      // kicking leg overrides
      px(ctx, 4 * s, -20 * s + bob, 30 * s, 8 * s, palette.pants);
    } else if (pose === 'special') {
      px(ctx, backArmX - 4 * s, armFY - 6 * s, armLen, armH, palette.accent);
      px(ctx, frontArmX + 4 * s, armFY - 6 * s, armLen, armH, palette.accent);
    } else {
      px(ctx, backArmX, armFY, armLen, armH, palette.shirt);
      px(ctx, frontArmX, armFY, armLen, armH, palette.shirt);
    }

    // head
    const headY = -92 * s + bob;
    px(ctx, -9 * s, headY, 18 * s, 16 * s, palette.skin);
    // hair/hat
    px(ctx, -10 * s, headY - 4 * s, 20 * s, 6 * s, palette.hair);
    // glasses/eyes accent
    if (palette.glasses) {
      px(ctx, -8 * s, headY + 6 * s, 16 * s, 3 * s, '#1a1a1a');
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
    const x = boss.x - camX, y = boss.footY - boss.jumpZ;
    const s = 3.4;
    const shake = boss.enraged ? rand(-2, 2) : 0;
    ctx.save();
    ctx.translate(x + shake, y);
    const flashTint = boss.flashTimer > 0;
    if (flashTint) ctx.filter = 'brightness(2)';

    ctx.globalAlpha = 0.35;
    px(ctx, -34, 4, 68, 12, '#000');
    ctx.globalAlpha = 1;

    const wobble = Math.sin(boss.t * 0.01) * 3;
    const bodyColor = boss.enraged ? '#c0392b' : '#3b5bdb';
    const outline = '#1b2a66';

    // Giant numeral "2" built from blocks, facing the player (mostly static, arms for punches)
    ctx.translate(0, wobble);
    // base curve of the 2 (bottom bar)
    px(ctx, -34, -14, 68, 16, bodyColor);
    // diagonal stroke
    px(ctx, -6, -34, 34, 16, bodyColor);
    px(ctx, -26, -54, 34, 16, bodyColor);
    // top curve
    px(ctx, -34, -84, 68, 16, bodyColor);
    px(ctx, -34, -70, 16, 20, bodyColor);
    px(ctx, 18, -70, 16, 20, bodyColor);
    // outline accents
    ctx.globalAlpha = 0.25;
    px(ctx, -34, -84, 68, 4, outline);
    ctx.globalAlpha = 1;

    // face plate + glasses on the top curve of the 2
    px(ctx, -20, -80, 40, 22, '#f2d9b1');
    px(ctx, -24, -78, 18, 8, '#1a1a1a');
    px(ctx, 6, -78, 18, 8, '#1a1a1a');
    px(ctx, -6, -76, 12, 3, '#1a1a1a');
    px(ctx, -22, -80, 4, 8, '#1a1a1a');
    px(ctx, 22, -80, 4, 8, '#1a1a1a');
    if (boss.enraged) {
      px(ctx, -21, -76, 14, 3, '#ff3b3b');
      px(ctx, 7, -76, 14, 3, '#ff3b3b');
    } else {
      px(ctx, -21, -76, 14, 3, '#dff');
      px(ctx, 7, -76, 14, 3, '#dff');
    }

    // little arms for slam telegraph
    if (boss.attackTelegraph === 'slam') {
      px(ctx, -60, -60, 22, 14, bodyColor);
      px(ctx, 38, -60, 22, 14, bodyColor);
    }

    ctx.filter = 'none';
    ctx.restore();
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

  function drawBackground(theme, camX, worldWidth, t) {
    const th = BG_THEMES[theme];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.sky[0]);
    grad.addColorStop(1, th.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // parallax deco blocks
    const parX = -camX * 0.3;
    for (let i = 0; i < worldWidth / 220 + 4; i++) {
      const bx = (i * 220 + (parX % 220)) - 220;
      px(ctx, bx, 160, 90, 220, th.deco);
      ctx.globalAlpha = 0.5;
      px(ctx, bx + 20, 190, 20, 40, th.accent);
      ctx.globalAlpha = 1;
    }
    // near parallax
    const parX2 = -camX * 0.6;
    for (let i = 0; i < worldWidth / 140 + 4; i++) {
      const bx = (i * 140 + (parX2 % 140)) - 140;
      ctx.globalAlpha = 0.6;
      px(ctx, bx, 300, 50, 130, th.deco);
      ctx.globalAlpha = 1;
    }

    // ground
    px(ctx, 0, GROUND_Y + 76, W, H - (GROUND_Y + 76), '#0c0c14');
    px(ctx, 0, GROUND_Y + 70, W, 8, th.accent);
    ctx.globalAlpha = 0.15;
    px(ctx, 0, GROUND_Y + 70, W, 8, '#000');
    ctx.globalAlpha = 1;
  }

  // ============================================================
  // Character & enemy definitions
  // ============================================================
  const CHAR_DEFS = {
    andy: {
      name: 'Andy "The Spitballer" Holloway',
      tag: 'Fast rushdown. Wins with volume of jabs, not power.',
      palette: { skin: '#e8b98c', shirt: '#2f6fed', pants: '#25334f', hair: '#4a3222', accent: '#ffd23f', glasses: false },
      speed: 3.6, jumpPow: 13, maxHealth: 100,
      punch: { dmg: 6, range: 42, cd: 220, stun: 200 },
      kick: { dmg: 9, range: 46, cd: 380, stun: 260 },
      special: { name: 'Zinger Combo', cost: 30, dmg: 22, range: 70, cd: 900 },
    },
    jason: {
      name: 'Jason "The Impressionist" Moore',
      tag: 'All-rounder. Special cycles through wild voices.',
      palette: { skin: '#d9a679', shirt: '#e0483a', pants: '#2a2a2a', hair: '#1a1a1a', accent: '#ffb703', glasses: false },
      speed: 3.1, jumpPow: 14, maxHealth: 110,
      punch: { dmg: 8, range: 44, cd: 260, stun: 220 },
      kick: { dmg: 10, range: 48, cd: 400, stun: 280 },
      special: { name: 'Impression Roulette', cost: 40, dmg: 26, range: 100, cd: 1100, aoe: true },
    },
    mike: {
      name: 'Mike "The Hitman" Wright',
      tag: 'Slow but devastating. Ranged special.',
      palette: { skin: '#c99a72', shirt: '#1f1f1f', pants: '#3a3a3a', hair: '#0d0d0d', accent: '#ff3b3b', glasses: true },
      speed: 2.5, jumpPow: 12, maxHealth: 130,
      punch: { dmg: 10, range: 44, cd: 300, stun: 260 },
      kick: { dmg: 13, range: 48, cd: 460, stun: 320 },
      special: { name: 'The Hit', cost: 50, dmg: 34, range: 999, cd: 1300, projectile: true },
    },
  };

  const ENEMY_DEFS = {
    draftee: { name: 'Rogue Mock-Draftee', hp: 22, speed: 1.6, dmg: 5, atkRange: 40, atkCd: 1000, xp: 5, size: 1,
      palette: { skin: '#d1a679', shirt: '#5a5a5a', pants: '#333', hair: '#222', accent: '#888' } },
    zombie: { name: 'Waiver-Wire Zombie', hp: 34, speed: 0.9, dmg: 7, atkRange: 38, atkCd: 1300, xp: 8, size: 1.05,
      palette: { skin: '#8fae7c', shirt: '#4a5c3a', pants: '#2c3722', hair: '#333', accent: '#6a8a52' } },
    vulture: { name: 'Stat-Vulture', hp: 18, speed: 2.4, dmg: 5, atkRange: 30, atkCd: 900, xp: 6, size: 1, flyer: true },
    bookie: { name: 'Shady Bookie', hp: 26, speed: 1.9, dmg: 6, atkRange: 40, atkCd: 950, xp: 6, size: 1,
      palette: { skin: '#c99a72', shirt: '#2a2a44', pants: '#1a1a2a', hair: '#111', accent: '#ffd23f' } },
    roller: { name: 'Dice Roller', hp: 20, speed: 1.7, dmg: 5, atkRange: 220, atkCd: 1600, xp: 6, size: 1, ranged: true,
      palette: { skin: '#c99a72', shirt: '#732a8a', pants: '#2a1a3a', hair: '#111', accent: '#ff4fa3' } },
    rival: { name: 'Rival FootClan Champ', hp: 46, speed: 2.1, dmg: 8, atkRange: 42, atkCd: 800, xp: 10, size: 1.08,
      palette: { skin: '#d1a679', shirt: '#8a4a2a', pants: '#3a2314', hair: '#2a1a10', accent: '#d98f3c' } },
    talker: { name: 'Trash Talker', hp: 30, speed: 1.8, dmg: 5, atkRange: 240, atkCd: 1700, xp: 8, size: 1, ranged: true,
      palette: { skin: '#d1a679', shirt: '#3a3a3a', pants: '#1a1a1a', hair: '#222', accent: '#ff8c3c' } },
  };

  const MINIBOSS_DEFS = {
    lateround: { name: 'The Late-Round QB', hp: 85, speed: 1.4, dmg: 9, atkRange: 220, atkCd: 1100, xp: 40, size: 1.5, ranged: true, miniboss: true,
      palette: { skin: '#d1a679', shirt: '#1f3a8a', pants: '#152452', hair: '#111', accent: '#f4c542' } },
    alphavulture: { name: 'Alpha Vulture', hp: 100, speed: 2.0, dmg: 8, atkRange: 40, atkCd: 900, xp: 45, size: 1.8, flyer: true, summons: true, miniboss: true },
    cardshark: { name: 'The Card Shark', hp: 130, speed: 2.0, dmg: 9, atkRange: 200, atkCd: 1200, xp: 50, size: 1.5, ranged: true, dash: true, miniboss: true,
      palette: { skin: '#c99a72', shirt: '#111827', pants: '#0a0e1a', hair: '#000', accent: '#ff4fa3' } },
    formerchamp: { name: 'The Former Champ', hp: 160, speed: 1.9, dmg: 11, atkRange: 46, atkCd: 800, xp: 60, size: 1.7, ranged: true, dash: true, miniboss: true,
      palette: { skin: '#d1a679', shirt: '#6a1414', pants: '#2a0a0a', hair: '#111', accent: '#ffd23f' } },
  };

  // ============================================================
  // Entities
  // ============================================================
  let projectiles = [];
  let particles = [];
  let popups = [];

  function spawnHit(x, y, color = '#fff') {
    for (let i = 0; i < 8; i++) {
      particles.push({ x, y, vx: rand(-3, 3), vy: rand(-4, -1), life: 20, color });
    }
  }
  function spawnPopup(x, y, text, color = '#fff') {
    popups.push({ x, y, text, life: 45, color });
  }

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
      this.pose = 'idle'; this.poseTimer = 0; this.t = 0;
      this.cds = { punch: 0, kick: 0, special: 0 };
      this.invuln = 0;
      this.hitboxActive = null;
      this.alive = true;
      this.comboCount = 0;
    }
    get footX() { return this.x; }
    get footY() { return this.y; }
    hurtbox() { return { x: this.x - 16, y: this.y - 96, w: 32, h: 96 }; }

    takeDamage(dmg, fromX) {
      if (this.invuln > 0) return;
      this.health = clamp(this.health - dmg, 0, this.maxHealth);
      this.invuln = 700;
      this.facing = fromX < this.x ? 1 : -1;
      this.knockX += (fromX < this.x ? 1 : -1) * 16;
      spawnHit(this.x, this.y - 60, '#ff6b6b');
      spawnPopup(this.x, this.y - 100, '-' + dmg, '#ff6b6b');
      if (this.health <= 0) this.alive = false;
    }

    update(dt, world) {
      this.t += dt;
      for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);
      this.invuln = Math.max(0, this.invuln - dt);

      if (Math.abs(this.knockX) > 0.1) {
        this.x = clamp(this.x + this.knockX, 40, world.width - 40);
        this.knockX *= 0.8;
      } else {
        this.knockX = 0;
      }

      let moving = false;
      if (this.poseTimer <= 0 || (this.pose !== 'punch' && this.pose !== 'kick' && this.pose !== 'special')) {
        let dx = 0, dy = 0;
        if (pressed('ArrowLeft') || pressed('KeyA')) { dx -= 1; }
        if (pressed('ArrowRight') || pressed('KeyD')) { dx += 1; }
        if (pressed('ArrowUp') || pressed('KeyW')) { dy -= 1; }
        if (pressed('ArrowDown') || pressed('KeyS')) { dy += 1; }
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy) || 1;
          this.x += (dx / len) * this.def.speed;
          this.y += (dy / len) * this.def.speed * 0.7;
          this.y = clamp(this.y, BAND_TOP, BAND_BOTTOM);
          this.x = clamp(this.x, 40, world.width - 40);
          if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
          moving = true;
        }
        if ((tapped('Space') || tapped('ArrowUp') && false) && this.jumpZ === 0 && tapped('Space')) {
          this.vz = this.def.jumpPow;
        }
        if (tapped('KeyJ') && this.cds.punch <= 0) this.doAttack('punch');
        else if (tapped('KeyK') && this.cds.kick <= 0) this.doAttack('kick');
        else if (tapped('KeyL') && this.cds.special <= 0 && this.meter >= this.def.special.cost) this.doAttack('special');
      }

      // jump physics
      if (this.jumpZ > 0 || this.vz > 0) {
        this.vz -= GRAVITY;
        this.jumpZ += this.vz;
        if (this.jumpZ <= 0) { this.jumpZ = 0; this.vz = 0; }
      }

      if (this.pose === 'idle' || this.pose === 'walk') {
        this.pose = moving ? 'walk' : 'idle';
      }
      if (this.poseTimer > 0) {
        this.poseTimer -= dt;
        if (this.poseTimer <= 0) { this.pose = 'idle'; this.hitboxActive = null; }
      }

      this.meter = clamp(this.meter, 0, this.maxMeter);
    }

    doAttack(kind) {
      const def = this.def[kind];
      this.pose = kind;
      this.poseTimer = kind === 'special' ? 420 : 260;
      this.cds[kind] = def.cd;
      if (kind === 'special') this.meter -= def.cost;
      this.comboCount++;

      if (kind === 'special' && this.charKey === 'mike') {
        projectiles.push({
          owner: 'player', x: this.x + this.facing * 20, y: this.y - 55,
          vx: this.facing * 9, dmg: def.dmg, w: 16, h: 10, friendly: true, life: 2000, color: '#8a5a2a',
        });
        this.hitboxActive = null;
        return;
      }

      this.hitboxActive = {
        x: this.x + (this.facing > 0 ? 0 : -def.range),
        y: this.y - 100, w: def.range, h: 90,
        dmg: def.dmg, stun: def.stun ?? 250, aoe: !!def.aoe, life: 140,
      };
    }
  }

  class Enemy {
    constructor(key, x, y, defOverride) {
      const def = defOverride || ENEMY_DEFS[key] || MINIBOSS_DEFS[key];
      this.key = key; this.def = def;
      this.x = x; this.y = y; this.jumpZ = 0;
      this.hp = def.hp; this.maxHp = def.hp;
      this.facing = -1;
      this.pose = 'idle'; this.poseTimer = 0; this.t = rand(0, 1000);
      this.atkCd = rand(0, 400);
      this.hurtTimer = 0;
      this.alive = true;
      this.knockX = 0;
      this.flyPhase = rand(0, 10);
      this.summonCd = 3000;
    }
    hurtbox() { return { x: this.x - 16 * (this.def.size||1), y: this.y - 96 * (this.def.size||1), w: 32 * (this.def.size||1), h: 96 * (this.def.size||1) }; }

    takeDamage(dmg, fromX, knock) {
      this.hp -= dmg;
      this.hurtTimer = 180;
      this.knockX += (this.x < fromX ? -1 : 1) * (knock || 6);
      spawnHit(this.x, this.y - 60, '#ffd23f');
      spawnPopup(this.x, this.y - 100, '-' + dmg, '#ffd23f');
      if (this.hp <= 0 && this.alive) {
        this.alive = false;
        spawnPopup(this.x, this.y - 110, 'KO!', '#fff');
      }
    }

    update(dt, player, world) {
      this.t += dt;
      this.atkCd = Math.max(0, this.atkCd - dt);
      this.hurtTimer = Math.max(0, this.hurtTimer - dt);
      if (Math.abs(this.knockX) > 0.1) {
        this.x += this.knockX;
        this.knockX *= 0.8;
        this.x = clamp(this.x, 40, world.width - 40);
      }

      if (!player || !player.alive) return;
      const d = dist(this, player);
      const speed = this.def.speed;
      const range = this.def.atkRange;

      if (this.def.flyer) {
        this.jumpZ = 30 + Math.sin(this.t * 0.003 + this.flyPhase) * 15;
      }

      if (this.hurtTimer > 0) { this.pose = 'hurt'; return; }

      if (d > range * 0.85) {
        const dx = player.x - this.x, dy = player.y - this.y;
        const len = Math.hypot(dx, dy) || 1;
        this.x += (dx / len) * speed;
        this.y += (dy / len) * speed * 0.7;
        this.y = clamp(this.y, BAND_TOP, BAND_BOTTOM);
        this.facing = dx > 0 ? 1 : -1;
        this.pose = 'walk';
      } else {
        this.facing = player.x > this.x ? 1 : -1;
        this.pose = 'idle';
        if (this.atkCd <= 0) {
          this.atkCd = this.def.atkCd;
          this.pose = 'punch';
          this.poseTimer = 260;
          if (this.def.ranged) {
            projectiles.push({
              owner: 'enemy', x: this.x, y: this.y - 55,
              vx: (player.x > this.x ? 1 : -1) * 6, dmg: this.def.dmg, w: 12, h: 12,
              friendly: false, life: 3000, color: this.def.palette ? this.def.palette.accent : '#ff4fa3',
            });
          } else {
            const hb = { x: this.x + (this.facing > 0 ? 0 : -46), y: this.y - 100, w: 46, h: 90 };
            if (overlap(hb, player.hurtbox())) player.takeDamage(this.def.dmg, this.x);
          }
        }
      }
      if (this.def.summons && this.summonCd !== undefined) {
        this.summonCd -= dt;
        if (this.summonCd <= 0) {
          this.summonCd = 4500;
          world.spawnExtra('vulture', this.x + rand(-80, 80), clamp(this.y + rand(-30,30), BAND_TOP, BAND_BOTTOM));
        }
      }
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
      intro: 'Draft night has gone rogue. Punch your way through the war room.',
    },
    {
      name: 'Fantasy Vulture Swamp', theme: 'swamp', width: 2400,
      waves: [
        wave(200, [['vulture', 700, 350], ['zombie', 760, 430]]),
        wave(800, [['vulture', 1200, 340], ['vulture', 1260, 380], ['zombie', 1300, 440]]),
        wave(1600, [['alphavulture', 2050, 380]]),
      ],
      intro: "They're circling your goal-line touches. Clear the swamp.",
    },
    {
      name: 'DFS & Betting Floor', theme: 'vegas', width: 2400,
      waves: [
        wave(200, [['bookie', 700, 380], ['roller', 780, 430]]),
        wave(800, [['bookie', 1150, 360], ['bookie', 1220, 430], ['roller', 1280, 400]]),
        wave(1600, [['cardshark', 2050, 400]]),
      ],
      intro: 'The house always wins. Prove them wrong.',
    },
    {
      name: 'Megalabowl Colosseum', theme: 'colosseum', width: 2600,
      waves: [
        wave(200, [['rival', 700, 370], ['talker', 780, 430]]),
        wave(900, [['rival', 1200, 360], ['rival', 1260, 430], ['talker', 1320, 400]]),
        wave(1800, [['formerchamp', 2250, 400]]),
      ],
      intro: 'One gauntlet stands between you and the final gate.',
    },
    {
      name: 'The Gate of the Runner-Up', theme: 'boss', width: 1400, boss: true,
      waves: [],
      intro: "He's finished 2nd every year. Today, someone has to tell him.",
    },
  ];

  // ============================================================
  // Game state
  // ============================================================
  let state = 'title';
  let selectedChar = 'andy';
  let selIndex = 0;
  const CHAR_ORDER = ['andy', 'jason', 'mike'];

  let levelIdx = 0;
  let player = null;
  let enemies = [];
  let camX = 0;
  let world = { width: 2000, spawnExtra: null };
  let bannerTimer = 0;
  let bannerText = '';
  let boss = null;
  let winTimer = 0;
  let shakeTimer = 0;

  function startGame() {
    player = new Player(selectedChar);
    levelIdx = 0;
    loadLevel(0);
    state = 'playing';
  }

  function loadLevel(idx) {
    const lvl = LEVELS[idx];
    enemies = [];
    projectiles = [];
    particles = [];
    popups = [];
    camX = 0;
    world.width = lvl.width;
    world.spawnExtra = (key, x, y) => enemies.push(new Enemy(key, x, y));
    player.x = 100;
    player.y = GROUND_Y;
    player.health = player.maxHealth;
    for (const w of lvl.waves) w.spawned = false;
    boss = null;

    if (lvl.boss) {
      boss = new Enemy('runnerup', world.width * 0.65, GROUND_Y, {
        name: 'The Runner-Up', hp: 380, maxHp: 380, speed: 1.3, dmg: 12, atkRange: 90, atkCd: 1400, size: 4,
      });
      boss.phase = 1; boss.enraged = false; boss.attackTelegraph = null; boss.flashTimer = 0;
      boss.slamCd = 1800; boss.summonCd2 = 5000; boss.rushCd = 6000; boss.rushing = false;
      enemies.push(boss);
    }

    bannerText = lvl.name;
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
  // Boss behavior
  // ============================================================
  function updateBoss(dt) {
    if (!boss || !boss.alive) return;
    boss.t = (boss.t || 0) + dt;
    boss.hurtTimer = Math.max(0, boss.hurtTimer - dt);
    boss.flashTimer = Math.max(0, boss.flashTimer - dt);

    const hpRatio = boss.hp / boss.maxHp;
    boss.enraged = hpRatio < 0.34;
    boss.phase = hpRatio < 0.34 ? 3 : (hpRatio < 0.66 ? 2 : 1);

    if (!player.alive) return;

    // face player, slow drift toward center-ish, mostly stationary brawler boss
    boss.facing = player.x > boss.x ? 1 : -1;
    const targetX = clamp(player.x + (player.x < boss.x ? 90 : -90), world.width * 0.35, world.width - 120);
    boss.x += (targetX - boss.x) * 0.01 * (boss.enraged ? 2 : 1);
    boss.y += (GROUND_Y - boss.y) * 0.02;

    boss.slamCd -= dt;
    if (boss.phase >= 2) boss.summonCd2 -= dt;
    if (boss.enraged) boss.rushCd -= dt;

    if (boss.attackTelegraph) {
      boss.telegraphTimer -= dt;
      if (boss.telegraphTimer <= 0) {
        executeBossAttack(boss.attackTelegraph);
        boss.attackTelegraph = null;
      }
      return;
    }

    if (boss.slamCd <= 0) {
      boss.slamCd = boss.enraged ? 1400 : 2200;
      boss.attackTelegraph = 'slam';
      boss.telegraphTimer = 500;
    } else if (boss.phase >= 2 && boss.summonCd2 <= 0) {
      boss.summonCd2 = 5500;
      enemies.push(new Enemy('vulture', boss.x - 100, GROUND_Y - 20));
      enemies.push(new Enemy('vulture', boss.x + 100, GROUND_Y - 20));
      spawnPopup(boss.x, boss.y - 220, 'SUMMONING VULTURES', '#ff8c3c');
    } else if (boss.enraged && boss.rushCd <= 0) {
      boss.rushCd = 5000;
      boss.attackTelegraph = 'rush';
      boss.telegraphTimer = 500;
    }
  }

  function executeBossAttack(kind) {
    if (kind === 'slam') {
      shakeTimer = 300;
      const hb = { x: boss.x - 140, y: GROUND_Y - 100, w: 280, h: 130 };
      if (overlap(hb, player.hurtbox())) player.takeDamage(10 + boss.phase * 2, boss.x);
      spawnHit(boss.x, GROUND_Y, '#ff8c3c');
      for (let i = 0; i < 3; i++) {
        projectiles.push({ owner: 'enemy', x: boss.x, y: GROUND_Y - 40, vx: (i - 1) * 4, vy: -3, dmg: 6, w: 10, h: 10, friendly: false, life: 1200, color: '#f4c542', arc: true });
      }
    } else if (kind === 'rush') {
      boss.rushing = true;
      spawnPopup(boss.x, boss.y - 220, 'RUNNER-UP RUSH', '#ff3b3b');
      setTimeout(() => { boss.rushing = false; }, 500);
      const hb = { x: Math.min(boss.x, player.x) - 40, y: GROUND_Y - 110, w: Math.abs(boss.x - player.x) + 80, h: 130 };
      if (overlap(hb, player.hurtbox())) player.takeDamage(15, boss.x);
    }
  }

  // ============================================================
  // Update loop
  // ============================================================
  let lastTs = 0;
  function update(dt) {
    dt = clamp(dt, 0, 40);
    shakeTimer = Math.max(0, shakeTimer - dt);
    if (bannerTimer > 0) bannerTimer -= dt;

    if (state !== 'playing') return;

    player.update(dt, world);
    camX = clamp(player.x - W / 2, 0, Math.max(0, world.width - W));

    checkWaves();

    // player attack resolution
    if (player.hitboxActive) {
      const hb = player.hitboxActive;
      hb.life -= dt;
      if (hb.life > 40) {
        for (const en of enemies) {
          if (!en.alive || en._hitThisSwing === hb) continue;
          if (overlap(hb, en.hurtbox())) {
            en.takeDamage(hb.dmg, player.x, 8);
            en._hitThisSwing = hb;
            player.meter = clamp(player.meter + 6, 0, player.maxMeter);
            if (!hb.aoe) { player.hitboxActive = null; break; }
          }
        }
      }
      if (hb.life <= 0) player.hitboxActive = null;
    }

    // enemies
    for (const en of enemies) en.update(dt, player, world);
    enemies = enemies.filter(en => {
      if (!en.alive) {
        if (en === boss) { onBossDefeated(); }
        return false;
      }
      return true;
    });

    if (boss) updateBoss(dt);

    // projectiles
    for (const p of projectiles) {
      p.x += p.vx; if (p.vy !== undefined) { p.vy += 0.15; p.y += p.vy; }
      p.life -= dt;
    }
    for (const p of projectiles) {
      if (p.life <= 0) continue;
      if (p.friendly) {
        for (const en of enemies) {
          if (!en.alive) continue;
          if (overlap({ x: p.x - p.w/2, y: p.y - p.h/2, w: p.w, h: p.h }, en.hurtbox())) {
            en.takeDamage(p.dmg, p.x - p.vx, 10);
            p.life = 0;
            player.meter = clamp(player.meter + 8, 0, player.maxMeter);
          }
        }
      } else {
        if (overlap({ x: p.x - p.w/2, y: p.y - p.h/2, w: p.w, h: p.h }, player.hurtbox())) {
          player.takeDamage(p.dmg, p.x);
          p.life = 0;
        }
      }
    }
    projectiles = projectiles.filter(p => p.life > 0 && p.x > camX - 100 && p.x < camX + W + 100);

    // particles / popups
    for (const pt of particles) { pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.2; pt.life--; }
    particles = particles.filter(p => p.life > 0);
    for (const pop of popups) { pop.y -= 0.6; pop.life--; }
    popups = popups.filter(p => p.life > 0);

    if (!player.alive) {
      state = 'gameover';
    } else if (!boss && allWavesCleared() && bannerTimer <= 0) {
      nextLevel();
    }
  }

  function onBossDefeated() {
    state = 'win';
    winTimer = 0;
  }

  function nextLevel() {
    levelIdx++;
    if (levelIdx >= LEVELS.length) {
      state = 'win';
      return;
    }
    loadLevel(levelIdx);
  }

  // ============================================================
  // Rendering
  // ============================================================
  function drawHUD() {
    const p = player;
    ctx.save();
    ctx.font = '10px monospace';
    // health bar
    px(ctx, 20, 16, 220, 18, '#111');
    px(ctx, 22, 18, 216 * clamp(p.health / p.maxHealth, 0, 1), 14, p.health > p.maxHealth*0.3 ? '#3ddc6b' : '#ff4d4d');
    ctx.fillStyle = '#fff';
    ctx.fillText(p.def.name.split(' ')[0].toUpperCase(), 24, 44);

    // meter
    px(ctx, 20, 48, 160, 10, '#111');
    px(ctx, 22, 50, 156 * clamp(p.meter / p.maxMeter, 0, 1), 6, '#4fc3f7');
    ctx.fillText('SPECIAL', 186, 57);

    // level name
    ctx.textAlign = 'right';
    ctx.fillText(LEVELS[levelIdx].name.toUpperCase(), W - 20, 30);
    ctx.textAlign = 'left';

    if (boss) {
      px(ctx, W/2 - 200, 16, 400, 16, '#111');
      px(ctx, W/2 - 198, 18, 396 * clamp(boss.hp / boss.maxHp, 0, 1), 12, boss.enraged ? '#ff3b3b' : '#ff8c3c');
      ctx.textAlign = 'center';
      ctx.fillText('THE RUNNER-UP', W/2, 12);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shakeTimer > 0) {
      ctx.translate(rand(-4, 4), rand(-4, 4));
    }
    const lvl = LEVELS[levelIdx];
    drawBackground(lvl.theme, camX, lvl.width, performance.now());

    // draw entities sorted by y for pseudo-depth
    const drawables = [player, ...enemies].filter(Boolean);
    drawables.sort((a, b) => a.y - b.y);

    for (const d of drawables) {
      if (d === player) {
        drawFigure(ctx, d.x - camX, d.y, {
          facing: d.facing, scale: 1, palette: d.def.palette, pose: d.pose, t: d.t,
          hurt: d.invuln > 0 && Math.floor(d.t / 80) % 2 === 0, jumpZ: d.jumpZ,
        });
      } else if (d === boss) {
        drawRunnerUpBoss(ctx, boss, camX);
      } else if (d.def.flyer) {
        drawVulture(ctx, d.x - camX, d.y - 90 - d.jumpZ, d.t, d.facing);
      } else {
        drawFigure(ctx, d.x - camX, d.y, {
          facing: d.facing, scale: d.def.size || 1, palette: d.def.palette || { skin:'#c99a72',shirt:'#555',pants:'#333',hair:'#222' },
          pose: d.pose, t: d.t, hurt: d.hurtTimer > 0, jumpZ: d.jumpZ || 0,
        });
        if (d.def.miniboss) {
          px(ctx, d.x - camX - 40, d.y - 130 * (d.def.size||1) - 14, 80, 6, '#111');
          px(ctx, d.x - camX - 38, d.y - 130 * (d.def.size||1) - 12, 76 * clamp(d.hp/d.maxHp,0,1), 3, '#ff8c3c');
        }
      }
    }

    // projectiles
    for (const p of projectiles) {
      px(ctx, p.x - camX - p.w/2, p.y - p.h/2, p.w, p.h, p.color || '#fff');
    }
    // particles
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life / 20);
      px(ctx, pt.x - camX, pt.y, 4, 4, pt.color);
      ctx.globalAlpha = 1;
    }
    // popups
    ctx.font = 'bold 14px monospace';
    for (const pop of popups) {
      ctx.globalAlpha = Math.max(0, pop.life / 45);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x - camX, pop.y);
      ctx.globalAlpha = 1;
    }

    drawHUD();

    if (bannerTimer > 0) {
      ctx.globalAlpha = clamp(bannerTimer / 400, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, H/2 - 40, W, 80);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(bannerText, W/2, H/2 + 8);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ============================================================
  // Screens (title / select / gameover / win) drawn on canvas
  // ============================================================
  function drawTitle() {
    const t = performance.now();
    drawBackground('boss', Math.sin(t/4000)*100+100, 1400, t);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px monospace';
    ctx.fillText('FOOTCLAN BRAWLER', W/2, 150);
    ctx.font = '16px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('a retro side-scrolling fighter starring the Fantasy Footballers', W/2, 185);

    drawFigure(ctx, W/2 - 220, 380, { facing: 1, scale: 2.2, palette: CHAR_DEFS.andy.palette, pose: 'walk', t });
    drawFigure(ctx, W/2, 380, { facing: 1, scale: 2.2, palette: CHAR_DEFS.jason.palette, pose: 'punch', t: t+300 });
    drawFigure(ctx, W/2 + 220, 380, { facing: -1, scale: 2.2, palette: CHAR_DEFS.mike.palette, pose: 'idle', t });

    if (Math.floor(t / 500) % 2 === 0) {
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('PRESS SPACE TO START', W/2, 470);
    }
    ctx.textAlign = 'left';
  }

  function drawSelect() {
    ctx.fillStyle = '#0d0d18';
    ctx.fillRect(0,0,W,H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px monospace';
    ctx.fillText('CHOOSE YOUR FOOTCLANNER', W/2, 60);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText('← → to choose   SPACE to confirm', W/2, 90);

    const key = CHAR_ORDER[selIndex];
    const def = CHAR_DEFS[key];
    CHAR_ORDER.forEach((k, i) => {
      const cx = W/2 + (i - selIndex) * 240;
      const active = i === selIndex;
      ctx.globalAlpha = active ? 1 : 0.35;
      if (active) {
        px(ctx, cx - 90, 160, 180, 280, '#1b2038');
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
        ctx.strokeRect(cx - 90, 160, 180, 280);
      }
      drawFigure(ctx, cx, 400, { facing: 1, scale: 2.4, palette: CHAR_DEFS[k].palette, pose: active ? 'punch' : 'idle', t: performance.now() });
      ctx.globalAlpha = 1;
    });

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(def.name, W/2, 460);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(def.tag, W/2, 482);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#8fd3ff';
    ctx.fillText(`SPD ${def.speed}   PUNCH ${def.punch.dmg}   KICK ${def.kick.dmg}   SPECIAL: ${def.special.name}`, W/2, 505);
    ctx.textAlign = 'left';
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(20,0,0,0.9)';
    ctx.fillRect(0,0,W,H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4d4d';
    ctx.font = 'bold 40px monospace';
    ctx.fillText('YOU GOT BENCHED', W/2, 240);
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.fillText('Press SPACE to try again', W/2, 290);
    ctx.textAlign = 'left';
  }

  function drawWin() {
    winTimer += 16;
    const t = winTimer;
    ctx.fillStyle = '#0d1a10';
    ctx.fillRect(0,0,W,H);
    for (let i = 0; i < 40; i++) {
      const cx = (i * 53 + (t*0.15)) % W;
      const cy = (i * 97 + t * (0.3 + (i%5)*0.05)) % H;
      px(ctx, cx, cy, 6, 6, i % 3 === 0 ? '#ffd23f' : (i % 3 === 1 ? '#4fc3f7' : '#ff4fa3'));
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px monospace';
    ctx.fillText('THE RUNNER-UP FALLS!', W/2, 130);
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(CHAR_DEFS[selectedChar].name, W/2, 170);
    ctx.font = '15px monospace';
    ctx.fillStyle = '#fff';
    wrapText('earns a spot at the table. FootClan Brawler complete — ready to submit for the Fantasy Footballers Listener League.', W/2, 210, 720, 22);

    drawFigure(ctx, W/2, 420, { facing: 1, scale: 3, palette: CHAR_DEFS[selectedChar].palette, pose: 'special', t });

    if (Math.floor(t/500)%2===0) {
      ctx.font = 'bold 16px monospace';
      ctx.fillText('PRESS SPACE FOR TITLE SCREEN', W/2, 500);
    }
    ctx.textAlign = 'left';
  }

  function wrapText(text, cx, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        lines.push(line); line = w + ' ';
      } else line = test;
    }
    lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l.trim(), cx, y + i * lineHeight));
  }

  // ============================================================
  // Main loop + state transitions
  // ============================================================
  function frame(ts) {
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;

    if (state === 'title') {
      drawTitle();
      if (tapped('Space')) { state = 'select'; }
    } else if (state === 'select') {
      if (tapped('ArrowRight')) selIndex = (selIndex + 1) % CHAR_ORDER.length;
      if (tapped('ArrowLeft')) selIndex = (selIndex - 1 + CHAR_ORDER.length) % CHAR_ORDER.length;
      selectedChar = CHAR_ORDER[selIndex];
      drawSelect();
      if (tapped('Space')) { startGame(); }
    } else if (state === 'playing') {
      update(dt);
      render();
    } else if (state === 'gameover') {
      drawGameOver();
      if (tapped('Space')) { state = 'select'; }
    } else if (state === 'win') {
      drawWin();
      if (tapped('Space')) { state = 'title'; }
    }

    justPressed.clear();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
