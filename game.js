// Degree Or Die: a 2D physics bullet-hell. Plain JavaScript, runs entirely in the browser.
'use strict';

(() => {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const TAU = Math.PI * 2;
  const FONT = '"Press Start 2P", "Courier New", monospace';
  const INK = '#140a28';
  const WIN_POINTS = 15;
  const POINTS_PER_BOSS = 5;

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const blinkOn = (speed = 2) => Math.floor(globalT * speed) % 2 === 0;

  function angleDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // ---------- Input ----------
  const keys = new Set();
  const pressed = new Set();
  const mouse = { x: W / 2, y: H / 2, down: false, clicked: false };
  const SCROLL_KEYS = [' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

  window.addEventListener('keydown', (e) => {
    if (document.activeElement !== canvas) return;
    const k = e.key.toLowerCase();
    if (SCROLL_KEYS.includes(k)) e.preventDefault();
    initAudio();
    if (!keys.has(k)) pressed.add(k);
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  canvas.addEventListener('blur', () => {
    keys.clear();
    if (S.state === 'fight') S.paused = true;
  });

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  canvas.addEventListener('mousemove', (e) => {
    const p = toCanvas(e);
    mouse.x = p.x;
    mouse.y = p.y;
  });
  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    initAudio();
    const p = toCanvas(e);
    mouse.x = p.x;
    mouse.y = p.y;
    mouse.down = true;
    mouse.clicked = true;
  });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Sound (tiny chiptune synth) ----------
  let actx = null;
  let muted = false;

  function initAudio() {
    if (actx) {
      if (actx.state === 'suspended') actx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { actx = new AC(); } catch (err) { actx = null; }
  }

  function tone(freq, dur, type = 'square', vol = 0.04, slideTo = 0) {
    if (!actx || muted) return;
    const t0 = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const sfx = {
    shoot: () => tone(880, 0.05, 'square', 0.012, 660),
    hit: () => tone(220, 0.25, 'sawtooth', 0.06, 60),
    bossHit: () => tone(160, 0.04, 'square', 0.015),
    zap: () => tone(1400, 0.2, 'sawtooth', 0.04, 200),
    dash: () => tone(300, 0.15, 'triangle', 0.05, 900),
    skill: () => tone(520, 0.2, 'triangle', 0.05, 1040),
    boom: () => tone(120, 0.6, 'sawtooth', 0.08, 30),
    select: () => tone(660, 0.06, 'square', 0.04),
    deny: () => tone(140, 0.12, 'square', 0.04),
    warn: () => tone(520, 0.3, 'triangle', 0.05, 260),
    coin: () => {
      tone(988, 0.08, 'square', 0.04);
      setTimeout(() => tone(1319, 0.15, 'square', 0.04), 80);
    },
  };

  // ---------- Pixel sprites ----------
  // Each character in a row is one pixel; the palette maps characters to colors.
  function makeSprite(rows, pal, s) {
    const w = rows[0].length + 2;
    const h = rows.length + 2;
    const c = document.createElement('canvas');
    c.width = w * s;
    c.height = h * s;
    const g = c.getContext('2d');
    const each = (fn) => rows.forEach((row, y) => {
      [...row].forEach((ch, x) => { if (pal[ch]) fn(x + 1, y + 1, pal[ch]); });
    });
    g.fillStyle = INK;
    each((x, y) => {
      g.fillRect((x - 1) * s, y * s, s, s);
      g.fillRect((x + 1) * s, y * s, s, s);
      g.fillRect(x * s, (y - 1) * s, s, s);
      g.fillRect(x * s, (y + 1) * s, s, s);
    });
    each((x, y, col) => {
      g.fillStyle = col;
      g.fillRect(x * s, y * s, s, s);
    });
    return c;
  }
  const whiten = (pal) => Object.fromEntries(Object.keys(pal).map((k) => [k, '#ffffff']));

  const HERO_ROWS = [
    '...HHHH...',
    '..HHHHHH..',
    '..HSSSSH..',
    '..SESSES..',
    '..SSSSSS..',
    '...SSSS...',
    '.CCCCCCCC.',
    'SCCCCCCCCS',
    'S.CCCCCC.S',
    '..CCCCCC..',
    '..BBBBBB..',
    '..BB..BB..',
    '..KK..KK..',
  ];
  const HERO_PAL = { H: '#7a4a22', S: '#ffd0a0', E: INK, C: '#3cf0ff', B: '#3050ff', K: INK };
  const heroSprite = makeSprite(HERO_ROWS, HERO_PAL, 2);

  const PROF_ROWS = [
    '....HHHHHHHH....',
    '...HHHHHHHHHH...',
    '..HHSSSSSSSSHH..',
    '..HSSSSSSSSSSH..',
    '..SGGGGSSGGGGS..',
    '..SGWWGGGGWWGS..',
    '..SGGGGSSGGGGS..',
    '..SSSSSNNSSSSS..',
    '...SDDDDDDDDS...',
    '...DDDKKKKDDD...',
    '....DDDDDDDD....',
    '.....SSSSSS.....',
    '..RRRRWAAWRRRR..',
    '.RRRRRWAAWRRRRR.',
    'RRRRRRWAAWRRRRRR',
    'SSRRRRWAAWRRRRSS',
    'SSRRRRRAARRRRRSS',
    '..RRRRRRRRRRRR..',
    '..RRRRRRRRRRRR..',
    '..KKKK....KKKK..',
  ];
  const profPalette = (hair, beard, robe, tie) => ({
    H: hair, S: '#ffd0a0', G: '#1a1a2e', W: '#ffffff', N: '#e8a070', D: beard, K: INK, R: robe, A: tie,
  });

  // ---------- Skills ----------
  const SKILLS = {
    dash: {
      name: 'MOMENTUM DASH', mana: 15, cd: 0.8, color: '#ffe93c',
      desc: 'Burst the way you move. You cannot be hit while dashing.',
    },
    pendulum: {
      name: 'PENDULUM ORBIT', mana: 35, cd: 9, color: '#ff8a3c',
      desc: 'For 6s two masses orbit you and smash bullets. Each smash heals 1 HP.',
    },
    lightning: {
      name: 'CHAIN LIGHTNING', mana: 40, cd: 4, color: '#3cf0ff',
      desc: 'Zap the professor for 60 damage instantly.',
    },
    cage: {
      name: 'FARADAY CAGE', mana: 45, cd: 10, color: '#b46cff',
      desc: 'A 3s bubble: no damage taken and it erases bullets it touches.',
    },
  };

  // ---------- Professors ----------
  const BOSSES = [
    {
      name: 'PROF. INERTIA', subject: 'MECHANICS', course: 'PHYS 101',
      hp: 400, reward: 100, skillCost: 60, skills: ['dash', 'pendulum'],
      color: '#ff5a3c', accent: '#ffd23c',
      quote: '"A body at rest stays at rest... until I FAIL it!"',
      enrageText: 'F = MA... MAXIMUM A!',
      shouts: ['F = MA!', 'G = 9.8!', 'CONSERVE THIS!', 'NO FRICTION!'],
      pal: profPalette('#f4f4f4', '#e8e8e8', '#ff5a3c', '#ffd23c'),
      attacks: [projectileLob, appleRain, pendulumSpray, momentumCharge],
    },
    {
      name: 'PROF. VOLTZ', subject: 'ELECTRICITY & MAGNETISM', course: 'PHYS 102',
      hp: 560, reward: 150, skillCost: 90, skills: ['lightning', 'cage'],
      color: '#7a3cff', accent: '#3cf0ff',
      quote: '"Resistance is futile. Ohm-ly I decide your grade!"',
      enrageText: 'OVERCHARGED!',
      shouts: ['ZAP!', 'OHM MY!', 'FEEL THE FIELD!', 'V = IR!'],
      pal: profPalette('#ffe93c', '#ffd0a0', '#7a3cff', '#3cf0ff'),
      attacks: [lightningStrike, lorentzSpiral, capacitorMines, coulombBurst],
    },
    {
      name: 'PROF. AMPLITUDE', subject: 'WAVES', course: 'PHYS 201',
      hp: 720, reward: 200, skillCost: 0, skills: [],
      color: '#ff3cae', accent: '#3cffb4',
      quote: '"Let us see if you can stay in phase."',
      enrageText: 'RESONANCE!',
      shouts: ['STAY IN PHASE!', 'CATCH THE WAVE!', 'NODES ARE SAFE...', 'INTERFERENCE!'],
      pal: profPalette('#3cc8ff', '#3cc8ff', '#ff3cae', '#3cffb4'),
      attacks: [sineStream, shockRings, standingWave, interference],
    },
  ];
  for (const def of BOSSES) {
    def.sprite = makeSprite(PROF_ROWS, def.pal, 3);
    def.spriteWhite = makeSprite(PROF_ROWS, whiten(def.pal), 3);
  }

  // Portraits on the web page
  document.querySelectorAll('canvas[data-boss]').forEach((c) => {
    const def = BOSSES[Number(c.dataset.boss)];
    if (def) c.getContext('2d').drawImage(def.sprite, 0, 0);
  });

  const FORMULAS = [
    ['F = ma', 'p = mv', 'E = ½mv²', 'τ = Iα', 'g = 9.8 m/s²', 'W = F·d', 'L = Iω'],
    ['V = IR', 'F = qv × B', 'ε = −dΦ/dt', 'C = Q/V', '∮E·dA = Q/ε₀', 'P = IV'],
    ['v = fλ', 'y = A sin(kx − ωt)', 'ω = 2πf', 'I ∝ A²', 'n₁sinθ₁ = n₂sinθ₂', 'λ = h/p'],
  ];

  // ---------- Game state ----------
  const S = {
    state: 'title', paused: false, level: 0, points: 0, money: 0,
    maxHp: 100, maxMana: 100, hpUps: 0, manaUps: 0, skills: [],
    learned: null, lastReward: null, shopMsg: null,
  };
  let player = null;
  let boss = null;
  let pBullets = [];
  let eBullets = [];
  let hazards = [];
  let rings = [];
  let particles = [];
  let texts = [];
  let zaps = [];
  let deco = [];
  let banner = null;
  let shake = 0;
  let stateT = 0;
  let globalT = 0;
  let shotCount = 0;
  let bossHitCount = 0;

  const upgradeCost = (ups) => 40 + 25 * ups;

  function newRun() {
    Object.assign(S, {
      points: 0, money: 0, maxHp: 100, maxMana: 100, hpUps: 0, manaUps: 0, skills: [],
    });
    particles = [];
    startLevel(0);
  }

  function startLevel(i) {
    S.level = i;
    S.paused = false;
    setupFight();
    S.state = 'intro';
    stateT = 0;
  }

  function setupFight() {
    const def = BOSSES[S.level];
    player = {
      x: W / 2, y: H - 60, hp: S.maxHp, mana: S.maxMana, inv: 0, fireCd: 0, cds: {},
      dashT: 0, dashVx: 0, dashVy: 0, dirX: 0, dirY: -1, orbitT: 0, cageT: 0,
    };
    boss = {
      def, x: W / 2, y: 90, r: 24, hp: def.hp, maxHp: def.hp, flash: 0,
      mode: 'idle', modeT: 0, vx: 0, vy: 0, charges: 0, trailT: 0,
      tx: W / 2, ty: 90, moveT: 0, attackIdx: 0, attackT: 1.6, stream: null,
      enraged: false, dead: false,
    };
    pBullets = [];
    eBullets = [];
    hazards = [];
    rings = [];
    particles = [];
    texts = [];
    zaps = [];
    banner = null;
    deco = Array.from({ length: 9 }, () => newDeco(true));
  }

  function newDeco(anywhere) {
    return {
      text: pick(FORMULAS[S.level]), x: rand(0, W), y: anywhere ? rand(0, H) : -20,
      vy: rand(6, 14), size: Math.floor(rand(12, 22)), rot: rand(-0.25, 0.25),
    };
  }

  function openShop() {
    S.state = 'shop';
    S.learned = null;
    S.shopMsg = null;
  }

  // ---------- Effects ----------
  function burst(x, y, n, colors, speed = 120, life = 0.6, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(life * 0.5, life), max: life, color: colors[i % colors.length], size,
      });
    }
  }

  function floatText(x, y, str, color) {
    texts.push({ x, y, str, color, life: 1.1 });
  }

  function showBanner(str, color) {
    banner = { str, color, t: 2 };
  }

  // ---------- Player ----------
  function orbPositions() {
    if (!player || player.orbitT <= 0) return [];
    return [0, 1].map((i) => ({
      x: player.x + Math.cos(globalT * 5 + i * Math.PI) * 38,
      y: player.y + Math.sin(globalT * 5 + i * Math.PI) * 38,
    }));
  }

  function updatePlayer(dt) {
    const p = player;
    let mx = 0;
    let my = 0;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (keys.has('w') || keys.has('arrowup')) my -= 1;
    if (keys.has('s') || keys.has('arrowdown')) my += 1;
    const len = Math.hypot(mx, my);
    if (len) {
      mx /= len;
      my /= len;
      p.dirX = mx;
      p.dirY = my;
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashVx * dt;
      p.y += p.dashVy * dt;
      particles.push({ x: p.x + rand(-4, 4), y: p.y + rand(-6, 6), vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#ffe93c', size: 4 });
    } else {
      const speed = keys.has('shift') ? 80 : 170;
      p.x += mx * speed * dt;
      p.y += my * speed * dt;
    }
    p.x = clamp(p.x, 10, W - 10);
    p.y = clamp(p.y, 40, H - 14);

    p.inv = Math.max(0, p.inv - dt);
    p.orbitT = Math.max(0, p.orbitT - dt);
    p.cageT = Math.max(0, p.cageT - dt);
    for (const id in p.cds) p.cds[id] = Math.max(0, p.cds[id] - dt);
    p.mana = Math.min(S.maxMana, p.mana + 10 * dt);

    p.fireCd -= dt;
    const firing = mouse.down || keys.has(' ') || keys.has('j');
    if (firing && p.fireCd <= 0) {
      p.fireCd = 0.1;
      const aim = mouse.down ? angleTo(p.x, p.y, mouse.x, mouse.y) : angleTo(p.x, p.y, boss.x, boss.y);
      shotCount++;
      const spread = (shotCount % 2 ? 1 : -1) * 0.03;
      pBullets.push({ x: p.x, y: p.y - 6, vx: Math.cos(aim + spread) * 460, vy: Math.sin(aim + spread) * 460, dmg: 2 });
      if (shotCount % 2) sfx.shoot();
    }

    if (pressed.has('q')) useSkill(0);
    if (pressed.has('e')) useSkill(1);

    for (const o of orbPositions()) {
      if (!boss.dead && dist(o.x, o.y, boss.x, boss.y) < boss.r + 7) damageBoss(50 * dt);
    }
  }

  function useSkill(slot) {
    const id = S.skills[slot];
    if (!id) return;
    const sk = SKILLS[id];
    const p = player;
    if ((p.cds[id] || 0) > 0) return;
    if (p.mana < sk.mana) {
      floatText(p.x, p.y - 24, 'NO MANA!', '#7ad7ff');
      sfx.deny();
      return;
    }
    p.mana -= sk.mana;
    p.cds[id] = sk.cd;
    if (id === 'dash') {
      p.dashVx = p.dirX * 600;
      p.dashVy = p.dirY * 600;
      p.dashT = 0.18;
      p.inv = Math.max(p.inv, 0.3);
      sfx.dash();
    } else if (id === 'pendulum') {
      p.orbitT = 6;
      sfx.skill();
    } else if (id === 'lightning') {
      zaps.push({ x1: p.x, y1: p.y, x2: boss.x, y2: boss.y, life: 0.3 });
      floatText(boss.x, boss.y - 44, '-60', '#3cf0ff');
      shake = Math.max(shake, 5);
      sfx.zap();
      damageBoss(60);
    } else if (id === 'cage') {
      p.cageT = 3;
      sfx.skill();
    }
  }

  function hurtPlayer(dmg) {
    const p = player;
    if (S.state !== 'fight' || p.inv > 0 || p.cageT > 0 || p.dashT > 0) return false;
    p.hp -= dmg;
    p.inv = 1.0;
    shake = Math.max(shake, 7);
    sfx.hit();
    burst(p.x, p.y, 14, ['#ff3c6e', '#ffffff', '#ffe93c'], 160, 0.5, 3);
    floatText(p.x, p.y - 22, `-${dmg}`, '#ff6b8a');
    if (p.hp <= 0) {
      p.hp = 0;
      burst(p.x, p.y, 60, ['#3cf0ff', '#ffffff', '#3050ff', '#ff3cae'], 240, 1.2, 4);
      sfx.boom();
      S.state = 'gameover';
      stateT = 0;
    }
    return true;
  }

  // ---------- Boss ----------
  function damageBoss(d) {
    if (boss.dead) return;
    boss.hp -= d;
    boss.flash = 0.06;
    if (++bossHitCount % 4 === 0) sfx.bossHit();
    if (!boss.enraged && boss.hp < boss.maxHp * 0.5) {
      boss.enraged = true;
      showBanner(boss.def.enrageText, boss.def.accent);
      shake = Math.max(shake, 8);
      sfx.warn();
    }
    if (boss.hp <= 0) bossDefeated();
  }

  function bossDefeated() {
    boss.hp = 0;
    boss.dead = true;
    boss.stream = null;
    const bonus = Math.round(40 * player.hp / S.maxHp);
    S.points += POINTS_PER_BOSS;
    S.money += boss.def.reward + bonus;
    S.lastReward = { base: boss.def.reward, bonus };
    for (const bl of eBullets) burst(bl.x, bl.y, 1, ['#ffe93c'], 40, 0.5, 2);
    eBullets = [];
    hazards = [];
    rings = [];
    burst(boss.x, boss.y, 90, ['#ffffff', '#ffe93c', boss.def.color, boss.def.accent], 260, 1.2, 4);
    shake = 14;
    sfx.boom();
    setTimeout(sfx.coin, 400);
    S.state = 'victory';
    stateT = 0;
  }

  function updateBoss(dt) {
    const b = boss;
    if (b.dead) return;
    b.flash -= dt;

    if (b.mode === 'idle') {
      b.moveT -= dt;
      if (b.moveT <= 0) {
        b.tx = rand(70, W - 70);
        b.ty = rand(60, 140);
        b.moveT = rand(1.4, 2.8);
      }
      const k = Math.min(1, dt * (b.enraged ? 2.2 : 1.5));
      b.x += (b.tx - b.x) * k;
      b.y += (b.ty - b.y) * k;
    } else if (b.mode === 'windup') {
      b.modeT -= dt;
      if (b.modeT <= 0) {
        const a = angleTo(b.x, b.y, player.x, player.y);
        const speed = b.enraged ? 480 : 400;
        b.vx = Math.cos(a) * speed;
        b.vy = Math.sin(a) * speed;
        b.mode = 'charge';
        b.modeT = 0.8;
        tone(90, 0.3, 'sawtooth', 0.05, 200);
      }
    } else if (b.mode === 'charge') {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < b.r || b.x > W - b.r) { b.vx *= -1; b.x = clamp(b.x, b.r, W - b.r); shake = Math.max(shake, 4); }
      if (b.y < 40 + b.r || b.y > H - b.r) { b.vy *= -1; b.y = clamp(b.y, 40 + b.r, H - b.r); shake = Math.max(shake, 4); }
      b.trailT -= dt;
      if (b.trailT <= 0) {
        b.trailT = 0.05;
        eBullets.push({ x: b.x, y: b.y, vx: 0, vy: 0, r: 5, color: '#ff5a3c', dmg: 8, t: 0, life: 1.1 });
      }
      b.modeT -= dt;
      if (b.modeT <= 0) {
        b.charges--;
        if (b.charges > 0) {
          b.mode = 'windup';
          b.modeT = 0.4;
        } else {
          b.mode = 'idle';
          b.moveT = 0;
        }
      }
    }

    if (b.stream) {
      const s = b.stream;
      s.t += dt;
      s.acc += dt;
      while (s.acc >= s.rate) {
        s.acc -= s.rate;
        s.fire(s.t);
      }
      if (s.t >= s.dur) b.stream = null;
    }

    if (b.mode === 'idle' && !b.stream) {
      b.attackT -= dt;
      if (b.attackT <= 0) {
        const atk = b.def.attacks[b.attackIdx % b.def.attacks.length];
        b.attackIdx++;
        b.attackT = atk(b, b.enraged) * (b.enraged ? 0.7 : 1);
        if (Math.random() < 0.35) floatText(b.x, b.y - 46, pick(b.def.shouts), b.def.accent);
      }
    }

    if (dist(b.x, b.y, player.x, player.y) < b.r * 0.8 + 6) hurtPlayer(15);
  }

  function shoot(x, y, ang, speed, opts = {}) {
    eBullets.push(Object.assign({
      x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 5, color: '#ff3c6e', dmg: 10, t: 0,
    }, opts));
  }

  // --- Mechanics attacks ---
  function projectileLob(b, enr) {
    const n = enr ? 7 : 5;
    const T = 1.3;
    const g = 300;
    for (let i = 0; i < n; i++) {
      const tx = player.x + (i - (n - 1) / 2) * 40;
      const ty = player.y;
      eBullets.push({
        x: b.x, y: b.y, vx: (tx - b.x) / T, vy: (ty - b.y - 0.5 * g * T * T) / T,
        ax: 0, ay: g, r: 6, color: '#ffd23c', dmg: 10, t: 0, life: 4,
      });
    }
    return 2.0;
  }

  function appleRain(b, enr) {
    const n = enr ? 14 : 9;
    for (let i = 0; i < n; i++) {
      eBullets.push({
        x: rand(16, W - 16), y: rand(-180, -20), vx: rand(-15, 15), vy: 0,
        ax: 0, ay: enr ? 250 : 190, r: 7, kind: 'apple', dmg: 12, t: 0,
      });
    }
    return 2.2;
  }

  function pendulumSpray(b, enr) {
    b.stream = {
      t: 0, acc: 0, rate: enr ? 0.05 : 0.07, dur: 2.0,
      fire: (t) => {
        const swing = Math.sin(t * 3) * 1.0;
        shoot(b.x, b.y + 20, Math.PI / 2 + swing, 170, { color: '#ff8a3c' });
        if (enr) shoot(b.x, b.y + 20, Math.PI / 2 - swing, 170, { color: '#ff8a3c' });
      },
    };
    return 1.0;
  }

  function momentumCharge(b, enr) {
    b.mode = 'windup';
    b.modeT = 0.7;
    b.charges = enr ? 2 : 1;
    floatText(b.x, b.y - 46, 'p = mv!', '#ffffff');
    return 1.2;
  }

  // --- Electricity & magnetism attacks ---
  function lightningStrike(b, enr) {
    const n = enr ? 5 : 4;
    for (let i = 0; i < n; i++) {
      const x = clamp(player.x + (i - (n - 1) / 2) * 60 + rand(-25, 25), 10, W - 10);
      hazards.push({ type: 'vbolt', x, w: 18, warn: 0.9, active: 0.25, t: 0 });
    }
    if (enr) hazards.push({ type: 'hbolt', y: player.y, w: 18, warn: 1.0, active: 0.25, t: 0 });
    return 1.8;
  }

  // A charge in a magnetic field: velocity rotates at a constant rate (circular motion).
  function magneticMove(bl, dt) {
    const c = Math.cos(bl.omega * dt);
    const s = Math.sin(bl.omega * dt);
    const vx = bl.vx * c - bl.vy * s;
    bl.vy = bl.vx * s + bl.vy * c;
    bl.vx = vx;
    bl.omega *= 1 - 0.25 * dt;
    bl.x += bl.vx * dt;
    bl.y += bl.vy * dt;
  }

  function lorentzSpiral(b, enr) {
    const n = enr ? 18 : 12;
    const w = enr ? 1.6 : 1.2;
    const off = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const sign = i % 2 ? 1 : -1;
      shoot(b.x, b.y, off + (i / n) * TAU, 150, {
        color: sign > 0 ? '#ff3c6e' : '#3cf0ff', omega: w * sign, fn: magneticMove, life: 5,
      });
    }
    return 1.6;
  }

  function mineMove(m, dt) {
    const k = Math.min(1, dt * 3);
    m.x += (m.tx - m.x) * k;
    m.y += (m.ty - m.y) * k;
    if (m.t >= m.fuse) {
      m.dead = true;
      for (let i = 0; i < 10; i++) shoot(m.x, m.y, (i / 10) * TAU, 140, { color: '#3cf0ff', r: 4 });
      burst(m.x, m.y, 12, ['#3cf0ff', '#ffffff'], 120, 0.4, 3);
    }
  }

  function capacitorMines(b, enr) {
    const n = enr ? 5 : 3;
    for (let i = 0; i < n; i++) {
      eBullets.push({
        x: b.x, y: b.y, tx: rand(40, W - 40), ty: rand(H * 0.45, H - 40),
        r: 8, kind: 'mine', dmg: 10, t: 0, fuse: 1.6, fn: mineMove,
      });
    }
    return 2.0;
  }

  function coulombBurst(b, enr) {
    const count = enr ? 3 : 2;
    for (let r = 0; r < count; r++) {
      const n = 16;
      const off = r * 0.2 + rand(0, 1);
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU;
        shoot(b.x, b.y, a, 40 + r * 30, { ax: Math.cos(a) * 120, ay: Math.sin(a) * 120, color: '#ffe93c', r: 4 });
      }
    }
    return 1.6;
  }

  // --- Waves attacks ---
  // Bullets travel along a line while oscillating sideways: a traveling sine wave.
  function waveMove(bl, dt) {
    bl.s += bl.speed * dt;
    const off = Math.sin(bl.s * bl.k + bl.phase) * bl.amp;
    bl.x = bl.x0 + bl.dx * bl.s - bl.dy * off;
    bl.y = bl.y0 + bl.dy * bl.s + bl.dx * off;
  }

  function sineStream(b, enr) {
    const offsets = enr ? [-0.35, 0.35] : [0];
    const base = angleTo(b.x, b.y, player.x, player.y);
    b.stream = {
      t: 0, acc: 0, rate: 0.12, dur: 2.4,
      fire: () => {
        for (const off of offsets) {
          for (let k = 0; k < 2; k++) {
            const a = base + off;
            eBullets.push({
              x: b.x, y: b.y, x0: b.x, y0: b.y, dx: Math.cos(a), dy: Math.sin(a), s: 0,
              speed: 150, amp: 36, k: 0.045, phase: k * Math.PI, r: 5,
              color: k ? '#3cffb4' : '#ff3cae', dmg: 10, t: 0, fn: waveMove,
            });
          }
        }
      },
    };
    return 1.0;
  }

  function shockRings(b, enr) {
    const n = enr ? 4 : 3;
    for (let i = 0; i < n; i++) {
      rings.push({
        x: b.x, y: b.y, r: -i * 80, speed: 150, w: 6, gap: rand(0, TAU), gapSize: 0.9,
        color: i % 2 ? '#3cffb4' : '#ff3cae',
      });
    }
    return 2.6;
  }

  function standingWave(b, enr) {
    const ys = enr ? [player.y, rand(H * 0.35, H - 30)] : [player.y];
    for (const y of ys) {
      hazards.push({
        type: 'sine', y: clamp(y, 60, H - 20), amp: 34, k: TAU / 160, phase: rand(0, TAU),
        warn: 1.1, active: 0.9, t: 0,
      });
    }
    return 1.8;
  }

  function interference(b, enr) {
    const sources = [{ x: 50, y: 60 }, { x: W - 50, y: 60 }];
    b.stream = {
      t: 0, acc: 0, rate: enr ? 0.35 : 0.5, dur: 2.5,
      fire: (t) => {
        for (const src of sources) {
          const n = 14;
          for (let i = 0; i < n; i++) shoot(src.x, src.y, t * 0.5 + (i / n) * TAU, 110, { color: '#3cffb4', r: 4 });
          burst(src.x, src.y, 6, ['#3cffb4', '#ffffff'], 60, 0.3, 3);
        }
      },
    };
    return 1.2;
  }

  // standing wave: y(x, t) = A sin(kx + phase) cos(wt)
  function sineY(h, x) {
    return h.y + h.amp * Math.sin(h.k * x + h.phase) * Math.cos((h.t - h.warn) * 9);
  }

  // ---------- World updates ----------
  function updateEnemyBullets(dt) {
    const orbs = orbPositions();
    for (let i = 0; i < eBullets.length; i++) {
      const bl = eBullets[i];
      bl.t += dt;
      if (bl.fn) {
        bl.fn(bl, dt);
      } else {
        bl.vx += (bl.ax || 0) * dt;
        bl.vy += (bl.ay || 0) * dt;
        bl.x += bl.vx * dt;
        bl.y += bl.vy * dt;
      }
      if (bl.dead) continue;
      if (player.cageT > 0 && dist(bl.x, bl.y, player.x, player.y) < 28 + bl.r) {
        bl.dead = true;
        burst(bl.x, bl.y, 3, ['#b46cff', '#ffffff'], 60, 0.3, 2);
        continue;
      }
      if (orbs.some((o) => dist(bl.x, bl.y, o.x, o.y) < bl.r + 7)) {
        bl.dead = true;
        player.hp = Math.min(S.maxHp, player.hp + 1);
        burst(bl.x, bl.y, 4, ['#ffb03c', '#ffffff'], 80, 0.3, 2);
        continue;
      }
      if (dist(bl.x, bl.y, player.x, player.y) < bl.r + 4 && hurtPlayer(bl.dmg)) bl.dead = true;
    }
    eBullets = eBullets.filter((bl) => !bl.dead && !(bl.life && bl.t > bl.life) &&
      bl.x > -60 && bl.x < W + 60 && bl.y > -240 && bl.y < H + 60);
  }

  function updatePlayerBullets(dt) {
    for (const pb of pBullets) {
      pb.x += pb.vx * dt;
      pb.y += pb.vy * dt;
      if (!boss.dead && dist(pb.x, pb.y, boss.x, boss.y) < boss.r + 3) {
        pb.dead = true;
        burst(pb.x, pb.y, 2, ['#ffffff', boss.def.accent], 60, 0.2, 2);
        damageBoss(pb.dmg);
      }
    }
    pBullets = pBullets.filter((pb) => !pb.dead && pb.x > -10 && pb.x < W + 10 && pb.y > -10 && pb.y < H + 10);
  }

  function updateHazards(dt) {
    for (const h of hazards) {
      const wasWarning = h.t < h.warn;
      h.t += dt;
      if (wasWarning && h.t >= h.warn) {
        shake = Math.max(shake, 4);
        if (h.type !== 'sine') sfx.zap();
      }
      if (h.t < h.warn || h.t >= h.warn + h.active) continue;
      if (h.type === 'vbolt' && Math.abs(player.x - h.x) < h.w / 2 + 4) hurtPlayer(14);
      else if (h.type === 'hbolt' && Math.abs(player.y - h.y) < h.w / 2 + 4) hurtPlayer(14);
      else if (h.type === 'sine' && Math.abs(player.y - sineY(h, player.x)) < 7) hurtPlayer(12);
    }
    hazards = hazards.filter((h) => h.t < h.warn + h.active);
  }

  function updateRings(dt) {
    for (const r of rings) {
      r.r += r.speed * dt;
      if (r.r <= 0) continue;
      const d = dist(player.x, player.y, r.x, r.y);
      if (Math.abs(d - r.r) < r.w / 2 + 4) {
        const a = angleTo(r.x, r.y, player.x, player.y);
        if (Math.abs(angleDiff(a, r.gap)) > r.gapSize / 2) hurtPlayer(12);
      }
    }
    rings = rings.filter((r) => r.r < 760);
  }

  function updateFx(dt) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g || 0) * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const t of texts) {
      t.y -= 24 * dt;
      t.life -= dt;
    }
    texts = texts.filter((t) => t.life > 0);
    for (const z of zaps) z.life -= dt;
    zaps = zaps.filter((z) => z.life > 0);
    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
    }
    for (const d of deco) {
      d.y += d.vy * dt;
      if (d.y > H + 20) Object.assign(d, newDeco(false));
    }
  }

  function updateFight(dt) {
    updatePlayer(dt);
    updateBoss(dt);
    updateEnemyBullets(dt);
    updatePlayerBullets(dt);
    updateHazards(dt);
    updateRings(dt);
    updateFx(dt);
  }

  // ---------- Shop ----------
  function shopButtons() {
    const def = BOSSES[S.level];
    const btns = def.skills.map((id, i) => ({ id: 'skill', skill: id, key: String(i + 1), x: 24 + i * 200, y: 76, w: 188, h: 160 }));
    btns.push({ id: 'hp', key: '3', x: 432, y: 76, w: 184, h: 72 });
    btns.push({ id: 'mana', key: '4', x: 432, y: 156, w: 184, h: 72 });
    btns.push({ id: 'next', key: 'enter', x: 432, y: 290, w: 184, h: 44 });
    return btns;
  }

  function shopSay(str, color, bad) {
    S.shopMsg = { str, color };
    (bad ? sfx.deny : sfx.select)();
  }

  function buy(btn) {
    const def = BOSSES[S.level];
    if (btn.id === 'skill') {
      if (S.learned) {
        shopSay(S.learned === btn.skill ? 'YOU ALREADY LEARNED THAT.' : 'ONLY ONE SKILL PER PROFESSOR!', '#ff6b8a', true);
        return;
      }
      if (S.money < def.skillCost) { shopSay('NOT ENOUGH MONEY!', '#ff6b8a', true); return; }
      S.money -= def.skillCost;
      S.skills.push(btn.skill);
      S.learned = btn.skill;
      sfx.coin();
      S.shopMsg = { str: `LEARNED ${SKILLS[btn.skill].name}! KEY: ${S.skills.length === 1 ? 'Q' : 'E'}`, color: '#7dff6b' };
    } else if (btn.id === 'hp' || btn.id === 'mana') {
      const ups = btn.id === 'hp' ? S.hpUps : S.manaUps;
      const cost = upgradeCost(ups);
      if (S.money < cost) { shopSay('NOT ENOUGH MONEY!', '#ff6b8a', true); return; }
      S.money -= cost;
      if (btn.id === 'hp') { S.hpUps++; S.maxHp += 25; } else { S.manaUps++; S.maxMana += 25; }
      sfx.coin();
      S.shopMsg = { str: btn.id === 'hp' ? `MAX HP IS NOW ${S.maxHp}!` : `MAX MANA IS NOW ${S.maxMana}!`, color: '#7dff6b' };
    } else if (btn.id === 'next') {
      sfx.select();
      startLevel(S.level + 1);
    }
  }

  function updateShop() {
    for (const btn of shopButtons()) {
      if ((mouse.clicked && inRect(mouse, btn)) || pressed.has(btn.key)) {
        buy(btn);
        return;
      }
    }
  }

  // ---------- Main update ----------
  function update(dt) {
    globalT += dt;
    shake = Math.max(0, shake - dt * 25);
    if (pressed.has('m')) muted = !muted;
    const confirm = pressed.has(' ') || pressed.has('enter') || mouse.clicked;

    switch (S.state) {
      case 'title':
        if (confirm) newRun();
        break;
      case 'intro':
        stateT += dt;
        updateFx(dt);
        if (stateT > 0.4 && confirm) S.state = 'fight';
        break;
      case 'fight':
        if (pressed.has('p') || pressed.has('escape')) S.paused = !S.paused;
        else if (S.paused && mouse.clicked) S.paused = false;
        if (!S.paused) updateFight(dt);
        break;
      case 'victory':
        stateT += dt;
        updateFx(dt);
        if (stateT > 1.5 && confirm) {
          if (S.points >= WIN_POINTS || S.level >= BOSSES.length - 1) {
            S.state = 'win';
            stateT = 0;
            particles = [];
          } else {
            openShop();
          }
        }
        break;
      case 'shop':
        updateShop();
        break;
      case 'gameover':
        stateT += dt;
        updateFx(dt);
        if (stateT > 1 && (confirm || pressed.has('r'))) startLevel(S.level);
        break;
      case 'win':
        stateT += dt;
        if (particles.length < 220) {
          particles.push({
            x: rand(0, W), y: -6, vx: rand(-20, 20), vy: rand(40, 90), life: 5, max: 5,
            color: `hsl(${Math.floor(rand(0, 360))}, 100%, 60%)`, size: 3,
          });
        }
        updateFx(dt);
        if (stateT > 1.5 && confirm) S.state = 'title';
        break;
    }
  }

  // ---------- Drawing helpers ----------
  function text(str, x, y, size = 8, color = '#ffffff', align = 'left', shadow = INK) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    if (shadow) {
      const o = Math.max(1, Math.round(size / 8));
      ctx.fillStyle = shadow;
      ctx.fillText(str, x + o, y + o);
      if (size >= 16) {
        ctx.strokeStyle = shadow;
        ctx.lineWidth = size / 6;
        ctx.lineJoin = 'round';
        ctx.strokeText(str, x, y);
      }
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function wrapText(str, x, y, maxW, size, color, lineH, align = 'left') {
    ctx.font = `${size}px ${FONT}`;
    let line = '';
    let yy = y;
    for (const word of str.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        text(line, x, yy, size, color, align);
        yy += lineH;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) text(line, x, yy, size, color, align);
    return yy + lineH;
  }

  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // A chunky bevelled box, the classic early-2000s button look.
  function panel(x, y, w, h, fill = '#2b1060', light = '#ff9ef5') {
    ctx.fillStyle = INK;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = light;
    ctx.fillRect(x + 2, y + 2, w - 4, 2);
    ctx.fillRect(x + 2, y + 2, 2, h - 4);
  }

  function bar(x, y, w, h, frac, c1, c2, label) {
    ctx.fillStyle = INK;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#3a2a50';
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    const fw = Math.max(0, w * clamp(frac, 0, 1));
    ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, y, fw, Math.max(1, Math.floor(h / 4)));
    if (label) text(label, x + 4, y + Math.floor((h - 8) / 2) + 1, 8, '#ffffff');
  }

  function starburst(x, y, r, rays, rot, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < rays; i++) {
      const a0 = rot + (i / rays) * TAU;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, a0, a0 + (0.5 / rays) * TAU);
      ctx.closePath();
      ctx.fill();
    }
  }

  function boltLine(x1, y1, x2, y2, core, glow) {
    const len = Math.max(1, dist(x1, y1, x2, y2));
    const n = Math.max(2, Math.floor(len / 16));
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const j = i === 0 || i === n ? 0 : rand(-7, 7);
      pts.push([x1 + (x2 - x1) * f + nx * j, y1 + (y2 - y1) * f + ny * j]);
    }
    for (const [w, c] of [[7, glow], [3, core]]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
  }

  function drawSkillIcon(id, cx, cy, s) {
    const u = s / 8;
    circle(cx, cy, s / 2, INK);
    circle(cx, cy, s / 2 - 2, SKILLS[id].color);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (id === 'dash') {
      ctx.moveTo(cx - 2 * u, cy - 2 * u); ctx.lineTo(cx, cy); ctx.lineTo(cx - 2 * u, cy + 2 * u);
      ctx.moveTo(cx, cy - 2 * u); ctx.lineTo(cx + 2 * u, cy); ctx.lineTo(cx, cy + 2 * u);
      ctx.stroke();
    } else if (id === 'pendulum') {
      ctx.moveTo(cx - u, cy - 3 * u); ctx.lineTo(cx + u, cy + u);
      ctx.stroke();
      circle(cx + 1.2 * u, cy + 1.5 * u, 1.4 * u, INK);
    } else if (id === 'lightning') {
      ctx.moveTo(cx + u, cy - 3 * u); ctx.lineTo(cx - u, cy); ctx.lineTo(cx + u, cy); ctx.lineTo(cx - u, cy + 3 * u);
      ctx.stroke();
    } else if (id === 'cage') {
      ctx.arc(cx, cy, 2.5 * u, 0, TAU);
      ctx.moveTo(cx - 2.5 * u, cy); ctx.lineTo(cx + 2.5 * u, cy);
      ctx.moveTo(cx, cy - 2.5 * u); ctx.lineTo(cx, cy + 2.5 * u);
      ctx.stroke();
    }
  }

  // ---------- World drawing ----------
  const THEMES = [
    { top: '#2a0b5e', bottom: '#ff6b3d', line: 'rgba(255,220,120,0.35)' },
    { top: '#04123d', bottom: '#5a1ea8', line: 'rgba(80,240,255,0.22)' },
    { top: '#0b4a5e', bottom: '#ff4fa3', line: 'rgba(160,255,220,0.35)' },
  ];

  function drawBackground() {
    const th = THEMES[S.level];
    const t = globalT;
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, th.top);
    grd.addColorStop(1, th.bottom);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;

    if (S.level === 0) {
      // Striped sunset sun and a scrolling grid floor
      const horizon = H * 0.55;
      const sun = ctx.createLinearGradient(0, horizon - 90, 0, horizon);
      sun.addColorStop(0, '#ffe93c');
      sun.addColorStop(1, '#ff3cae');
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(W / 2, horizon, 90, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = th.top;
      for (let i = 0; i < 5; i++) ctx.fillRect(W / 2 - 92, horizon - 12 - i * 14, 184, 2 + i * 0.6);
      ctx.fillStyle = 'rgba(40,0,70,0.55)';
      ctx.fillRect(0, horizon, W, H - horizon);
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * 20, horizon);
        ctx.lineTo(W / 2 + i * 120, H);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const p = (i + (t * 0.5) % 1) / 8;
        const y = horizon + (H - horizon) * p * p;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    } else if (S.level === 1) {
      // Circuit grid with current pulses
      for (let x = 0; x <= W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.fillStyle = 'rgba(140,255,255,0.7)';
      for (let i = 0; i < 6; i++) {
        const y = i * 64 + 32;
        const x = ((t * 140 + i * 97) % (W + 40)) - 20;
        ctx.fillRect(x - 8, y - 1, 16, 3);
        const x2 = i * 96 + 32;
        const y2 = ((t * 100 + i * 61) % (H + 40)) - 20;
        ctx.fillRect(x2 - 1, y2 - 8, 3, 16);
      }
    } else {
      // Rolling sine waves
      for (let j = 0; j < 6; j++) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) {
          const y = 40 + j * 60 + Math.sin(x * 0.02 + t * (1 + j * 0.3) + j) * 14;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Drifting formulas
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of deco) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.font = `italic ${d.size}px Georgia, "Times New Roman", serif`;
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }
  }

  function drawBoss() {
    const b = boss;
    const flashing = b.flash > 0 || (b.mode === 'windup' && Math.floor(globalT * 20) % 2);
    const spr = flashing ? b.def.spriteWhite : b.def.sprite;
    const bob = b.mode === 'idle' ? Math.sin(globalT * 3) * 3 : 0;
    const jitter = b.mode === 'windup' ? rand(-2, 2) : 0;
    ctx.fillStyle = 'rgba(20,10,40,0.35)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 34, 22, 6, 0, 0, TAU);
    ctx.fill();
    if (b.enraged) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(globalT * 10);
      ctx.strokeStyle = b.def.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y + bob, 36 + Math.sin(globalT * 6) * 3, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(spr, Math.round(b.x - spr.width / 2 + jitter), Math.round(b.y - spr.height / 2 + bob));
  }

  function drawPlayer() {
    const p = player;
    for (const o of orbPositions()) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
      circle(o.x, o.y, 8, INK);
      circle(o.x, o.y, 6, '#ff8a3c');
      circle(o.x - 2, o.y - 2, 2, '#ffffff');
    }
    const flicker = p.inv > 0 && p.dashT <= 0 && Math.floor(globalT * 16) % 2;
    if (!flicker) ctx.drawImage(heroSprite, Math.round(p.x - heroSprite.width / 2), Math.round(p.y - heroSprite.height / 2));
    if (p.cageT > 0) {
      ctx.globalAlpha = p.cageT < 0.8 && Math.floor(globalT * 12) % 2 ? 0.2 : 0.45;
      circle(p.x, p.y, 28, '#b46cff');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = globalT + (i / 6) * Math.PI;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 28, Math.abs(Math.cos(a)) * 28, 0, 0, TAU);
        ctx.stroke();
      }
    }
    circle(p.x, p.y, 3.5, INK);
    circle(p.x, p.y, 2.5, '#ff3cae');
  }

  function drawEnemyBullets() {
    for (const bl of eBullets) {
      if (bl.kind === 'apple') {
        circle(bl.x, bl.y, bl.r + 1.5, INK);
        circle(bl.x, bl.y, bl.r, '#ff2b4a');
        circle(bl.x - 2, bl.y - 2, 2, '#ffd0d8');
        ctx.fillStyle = '#6b3b1f';
        ctx.fillRect(bl.x - 1, bl.y - bl.r - 3, 2, 4);
        ctx.fillStyle = '#3cd65a';
        ctx.fillRect(bl.x + 1, bl.y - bl.r - 3, 4, 3);
      } else if (bl.kind === 'mine') {
        const fast = bl.t > bl.fuse - 0.6;
        const lit = Math.floor(bl.t * (fast ? 16 : 6)) % 2;
        ctx.fillStyle = INK;
        ctx.fillRect(bl.x - 8, bl.y - 9, 16, 18);
        ctx.fillStyle = lit ? '#ffffff' : '#3cf0ff';
        ctx.fillRect(bl.x - 6, bl.y - 7, 4, 14);
        ctx.fillRect(bl.x + 2, bl.y - 7, 4, 14);
      } else {
        circle(bl.x, bl.y, bl.r + 1.5, INK);
        circle(bl.x, bl.y, bl.r, bl.color);
        circle(bl.x, bl.y, bl.r * 0.45, '#ffffff');
      }
    }
  }

  function drawPlayerBullets() {
    for (const pb of pBullets) {
      circle(pb.x, pb.y, 3.5, '#3cf0ff');
      circle(pb.x, pb.y, 1.8, '#ffffff');
    }
  }

  function drawHazards() {
    for (const h of hazards) {
      const warning = h.t < h.warn;
      const lit = Math.floor(h.t * 12) % 2;
      if (h.type === 'vbolt' || h.type === 'hbolt') {
        const vert = h.type === 'vbolt';
        if (warning) {
          ctx.fillStyle = lit ? 'rgba(255,255,120,0.28)' : 'rgba(255,255,120,0.12)';
          if (vert) ctx.fillRect(h.x - h.w / 2, 0, h.w, H); else ctx.fillRect(0, h.y - h.w / 2, W, h.w);
          ctx.fillStyle = 'rgba(255,255,160,0.8)';
          if (vert) {
            ctx.fillRect(h.x - h.w / 2, 0, 1, H);
            ctx.fillRect(h.x + h.w / 2 - 1, 0, 1, H);
          } else {
            ctx.fillRect(0, h.y - h.w / 2, W, 1);
            ctx.fillRect(0, h.y + h.w / 2 - 1, W, 1);
          }
        } else if (vert) {
          boltLine(h.x, 0, h.x, H, '#fffbe0', '#3cf0ff');
        } else {
          boltLine(0, h.y, W, h.y, '#fffbe0', '#3cf0ff');
        }
      } else if (h.type === 'sine') {
        if (warning) {
          ctx.strokeStyle = lit ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 1;
          for (const sgn of [1, -1]) {
            ctx.beginPath();
            for (let x = 0; x <= W; x += 6) {
              const y = h.y + sgn * h.amp * Math.sin(h.k * x + h.phase);
              if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          // Nodes: the points that never move, where it is safe to stand
          ctx.fillStyle = '#ffffff';
          for (let n = Math.ceil(h.phase / Math.PI); ; n++) {
            const x = (n * Math.PI - h.phase) / h.k;
            if (x > W) break;
            if (x >= 0) ctx.fillRect(x - 3, h.y - 3, 6, 6);
          }
        } else {
          for (const [w, c] of [[7, '#3cffb4'], [3, '#ffffff']]) {
            ctx.strokeStyle = c;
            ctx.lineWidth = w;
            ctx.beginPath();
            for (let x = 0; x <= W; x += 6) {
              const y = sineY(h, x);
              if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
      }
    }
  }

  function drawRings() {
    for (const r of rings) {
      if (r.r <= 0) continue;
      for (const [w, c] of [[r.w + 4, INK], [r.w, r.color]]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, r.gap + r.gapSize / 2, r.gap - r.gapSize / 2 + TAU);
        ctx.stroke();
      }
    }
  }

  function drawFx() {
    for (const z of zaps) {
      ctx.globalAlpha = z.life / 0.3;
      boltLine(z.x1, z.y1, z.x2, z.y2, '#ffffff', '#3cf0ff');
    }
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const t of texts) {
      ctx.globalAlpha = clamp(t.life, 0, 1);
      text(t.str, t.x, t.y, 8, t.color, 'center');
    }
    ctx.globalAlpha = 1;
    if (banner) {
      ctx.globalAlpha = clamp(banner.t, 0, 1);
      text(banner.str, W / 2, H / 2 - 50, 16, banner.color, 'center');
      ctx.globalAlpha = 1;
    }
  }

  function drawWorld() {
    drawBackground();
    drawRings();
    drawHazards();
    if (!boss.dead) drawBoss();
    drawEnemyBullets();
    drawPlayerBullets();
    if (player.hp > 0) drawPlayer();
    drawFx();
  }

  function drawHUD() {
    const def = boss.def;
    text(`${def.name} - ${def.subject}`, W / 2, 3, 8, def.accent, 'center');
    bar(140, 16, 360, 10, boss.hp / boss.maxHp, '#ff8a8a', '#c0103c');

    text(`* ${S.points}/${WIN_POINTS}`, 8, 6, 8, '#ffe93c');
    text(`$${S.money}`, 8, 20, 8, '#7dff6b');
    text(`LV ${S.level + 1}/${BOSSES.length}`, W - 8, 6, 8, '#ffffff', 'right');
    if (muted) text('MUTED', W - 8, 20, 8, '#ff9ef5', 'right');

    // Bars grow when you buy upgrades
    const hpW = Math.min(260, S.maxHp * 1.5);
    const mpW = Math.min(260, S.maxMana * 1.5);
    bar(10, H - 32, hpW, 10, player.hp / S.maxHp, '#7dff6b', '#1fa83c', `HP ${Math.ceil(player.hp)}/${S.maxHp}`);
    bar(10, H - 16, mpW, 10, player.mana / S.maxMana, '#7ad7ff', '#3050ff', `MP ${Math.floor(player.mana)}/${S.maxMana}`);

    ['Q', 'E'].forEach((key, i) => {
      const s = 30;
      const x = W - 76 + i * 36;
      const y = H - 38;
      panel(x, y, s, s, '#2b1060');
      const id = S.skills[i];
      if (id) {
        drawSkillIcon(id, x + s / 2, y + s / 2, s - 8);
        const cd = player.cds[id] || 0;
        if (cd > 0) {
          ctx.fillStyle = 'rgba(20,10,40,0.7)';
          ctx.fillRect(x + 2, y + 2, s - 4, (s - 4) * (cd / SKILLS[id].cd));
        } else if (player.mana < SKILLS[id].mana) {
          ctx.fillStyle = 'rgba(40,60,200,0.55)';
          ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
        }
      } else {
        text('-', x + s / 2, y + 11, 8, '#8a7aa8', 'center');
      }
      text(key, x + s / 2, y - 11, 8, '#ffffff', 'center');
    });
  }

  // ---------- Screens ----------
  function drawTitle() {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#3a0ca3');
    g.addColorStop(0.5, '#f72585');
    g.addColorStop(1, '#ffb703');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    starburst(W / 2, 90, 700, 18, globalT * 0.15, 'rgba(255,255,255,0.12)');

    const title = 'DEGREE OR DIE';
    const size = 36;
    ctx.font = `${size}px ${FONT}`;
    let x = W / 2 - ctx.measureText(title).width / 2;
    [...title].forEach((ch, i) => {
      ctx.font = `${size}px ${FONT}`;
      const w = ctx.measureText(ch).width;
      const y = 52 + Math.sin(globalT * 4 + i * 0.5) * 5;
      const hue = Math.floor(i * 25 + globalT * 60) % 360;
      text(ch, x, y, size, `hsl(${hue}, 100%, 65%)`, 'left');
      x += w;
    });
    text('A PHYSICS BULLET-HELL', W / 2, 110, 10, '#ffffff', 'center');

    const bob = (k) => Math.sin(globalT * 3 + k) * 4;
    ctx.drawImage(heroSprite, 120, 165 + bob(0), heroSprite.width * 2, heroSprite.height * 2);
    text('VS', 220, 196, 16, '#ffe93c', 'center');
    BOSSES.forEach((def, i) => {
      ctx.drawImage(def.sprite, 290 + i * 100, 158 + bob(i + 1));
      text(def.subject.length > 10 ? 'E & M' : def.subject, 317 + i * 100, 232, 8, def.accent, 'center');
    });

    if (blinkOn(2)) text('CLICK OR PRESS SPACE TO START', W / 2, 272, 10, '#ffffff', 'center');
    text('WASD MOVE  -  MOUSE AIM + SHOOT  -  Q/E SKILLS', W / 2, 314, 8, '#ffe0f0', 'center');
    text('BEAT 3 PROFESSORS - EARN 15 POINTS - GRADUATE', W / 2, 330, 8, '#ffe0f0', 'center');
  }

  function drawIntro() {
    const def = BOSSES[S.level];
    ctx.fillStyle = 'rgba(20,10,40,0.75)';
    ctx.fillRect(0, 0, W, H);
    starburst(150, 180, 160, 14, globalT * 0.4, def.color);
    const sc = 2;
    const spr = def.sprite;
    ctx.drawImage(spr, 150 - (spr.width * sc) / 2, 180 - (spr.height * sc) / 2 + Math.sin(globalT * 3) * 4, spr.width * sc, spr.height * sc);

    panel(286, 42, 340, 222, '#2b1060', def.accent);
    text(`LEVEL ${S.level + 1} / ${BOSSES.length}`, 300, 56, 10, '#ffe93c');
    text(def.course, 300, 82, 8, '#ffffff');
    text(def.subject, 300, 98, def.subject.length > 12 ? 12 : 16, def.accent);
    text(def.name, 300, 126, 12, '#ffffff');
    wrapText(def.quote, 300, 154, 310, 8, '#ffd0f0', 14);
    text(`REWARD: +${POINTS_PER_BOSS} POINTS  +$${def.reward}`, 300, 214, 8, '#7dff6b');
    if (S.skills.length) wrapText(`YOUR SKILLS: ${S.skills.map((id) => SKILLS[id].name).join(', ')}`, 300, 234, 320, 8, '#7ad7ff', 14);
    if (blinkOn(2)) text('CLICK OR PRESS SPACE TO START THE EXAM', W / 2, 318, 8, '#ffffff', 'center');
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(20,10,40,0.6)';
    ctx.fillRect(0, 0, W, H);
    text('PAUSED', W / 2, H / 2 - 24, 24, '#ffe93c', 'center');
    text('CLICK OR PRESS P TO RESUME', W / 2, H / 2 + 16, 8, '#ffffff', 'center');
  }

  function drawVictory() {
    const def = boss.def;
    ctx.fillStyle = 'rgba(20,10,40,0.55)';
    ctx.fillRect(0, 0, W, H);
    panel(W / 2 - 200, 86, 400, 176, '#2b1060', def.accent);
    text('PROFESSOR DEFEATED!', W / 2, 104, 16, '#ffe93c', 'center');
    text(`YOU PASSED ${def.subject}`, W / 2, 134, 8, def.accent, 'center');
    text(`+${POINTS_PER_BOSS} POINTS  (${S.points}/${WIN_POINTS})`, W / 2, 160, 8, '#ffffff', 'center');
    text(`+$${S.lastReward.base} SCHOLARSHIP`, W / 2, 180, 8, '#7dff6b', 'center');
    text(`+$${S.lastReward.bonus} BONUS FOR HP LEFT`, W / 2, 196, 8, '#7dff6b', 'center');
    if (stateT > 1.5 && blinkOn(2)) text('CLICK OR PRESS SPACE', W / 2, 232, 8, '#ffffff', 'center');
  }

  function drawGameOver() {
    const def = BOSSES[S.level];
    ctx.fillStyle = 'rgba(120,0,40,0.6)';
    ctx.fillRect(0, 0, W, H);
    text('EXAM FAILED', W / 2, 100, 24, '#ff6b8a', 'center');
    text(`${def.name} WINS THIS ROUND.`, W / 2, 146, 8, '#ffffff', 'center');
    text('YOUR SKILLS AND UPGRADES ARE KEPT.', W / 2, 166, 8, '#ffe0f0', 'center');
    if (stateT > 1 && blinkOn(2)) text('CLICK OR PRESS R TO RETAKE THE EXAM', W / 2, 220, 8, '#ffe93c', 'center');
  }

  function drawShop() {
    const def = BOSSES[S.level];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3a0ca3');
    g.addColorStop(1, '#b5179e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = 0; y < H; y += 16) {
      for (let x = (y / 16) % 2 ? 16 : 0; x < W; x += 32) ctx.fillRect(x, y, 16, 16);
    }

    text('OFFICE HOURS', 24, 14, 16, '#ffe93c');
    text(`$${S.money}`, W - 24, 14, 16, '#7dff6b', 'right');
    text(`${def.name} DROPPED 2 SKILLS.`, 24, 40, 8, '#ffffff');
    text('YOU CAN ONLY LEARN ONE OF THEM!', 24, 54, 8, '#ffffff');
    text(`POINTS ${S.points}/${WIN_POINTS}`, W - 24, 40, 8, '#ffe93c', 'right');

    for (const btn of shopButtons()) {
      const hover = inRect(mouse, btn);
      if (btn.id === 'skill') {
        const sk = SKILLS[btn.skill];
        const mine = S.learned === btn.skill;
        const gone = S.learned && !mine;
        panel(btn.x, btn.y, btn.w, btn.h, mine ? '#1f6b3c' : gone ? '#3a3050' : hover ? '#4a1c8a' : '#2b1060', sk.color);
        if (gone) ctx.globalAlpha = 0.45;
        drawSkillIcon(btn.skill, btn.x + 26, btn.y + 26, 28);
        text(sk.name, btn.x + 46, btn.y + 22, 8, sk.color);
        wrapText(sk.desc, btn.x + 12, btn.y + 50, btn.w - 24, 8, '#ffffff', 13);
        text(`MANA ${sk.mana}  CD ${sk.cd}S`, btn.x + 12, btn.y + 116, 8, '#7ad7ff');
        let label = `[${btn.key}] LEARN $${def.skillCost}`;
        let color = S.money >= def.skillCost ? '#ffe93c' : '#ff6b8a';
        if (mine) { label = 'LEARNED!'; color = '#7dff6b'; }
        if (gone) { label = 'NOT CHOSEN'; color = '#c0b0d0'; }
        text(label, btn.x + 12, btn.y + 138, 8, color);
        ctx.globalAlpha = 1;
      } else if (btn.id === 'hp' || btn.id === 'mana') {
        const isHp = btn.id === 'hp';
        const cost = upgradeCost(isHp ? S.hpUps : S.manaUps);
        panel(btn.x, btn.y, btn.w, btn.h, hover ? '#4a1c8a' : '#2b1060', isHp ? '#7dff6b' : '#7ad7ff');
        text(isHp ? '+25 MAX HP' : '+25 MAX MANA', btn.x + 12, btn.y + 12, 8, isHp ? '#7dff6b' : '#7ad7ff');
        text(`NOW: ${isHp ? S.maxHp : S.maxMana}`, btn.x + 12, btn.y + 30, 8, '#ffffff');
        text(`[${btn.key}] BUY $${cost}`, btn.x + 12, btn.y + 50, 8, S.money >= cost ? '#ffe93c' : '#ff6b8a');
      } else {
        const next = BOSSES[S.level + 1];
        text(`NEXT: ${next.name}`, btn.x, btn.y - 34, 8, next.accent);
        text(next.subject.length > 20 ? 'E & M' : next.subject, btn.x, btn.y - 20, 8, '#ffffff');
        panel(btn.x, btn.y, btn.w, btn.h, hover ? '#ff3cae' : '#c0107a', '#ffe93c');
        text('NEXT BOSS >', btn.x + btn.w / 2, btn.y + 10, 10, '#ffffff', 'center');
        text('[ENTER]', btn.x + btn.w / 2, btn.y + 28, 8, '#ffe0f0', 'center');
      }
    }

    text('YOUR SKILLS', 24, 252, 8, '#ffe93c');
    text(`Q: ${S.skills[0] ? SKILLS[S.skills[0]].name : '---'}`, 24, 268, 8, '#ffffff');
    text(`E: ${S.skills[1] ? SKILLS[S.skills[1]].name : '---'}`, 24, 282, 8, '#ffffff');
    text(`MAX HP ${S.maxHp}   MAX MANA ${S.maxMana}`, 24, 298, 8, '#7ad7ff');
    if (S.shopMsg) text(S.shopMsg.str, 24, 324, 8, S.shopMsg.color);
  }

  function drawWin() {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ffb703');
    g.addColorStop(0.5, '#f72585');
    g.addColorStop(1, '#3a0ca3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    starburst(W / 2, H / 2, 700, 20, globalT * 0.2, 'rgba(255,255,255,0.15)');
    text('DEGREE ACQUIRED!', W / 2, 18, 20, '#ffe93c', 'center');

    const x = W / 2 - 210;
    const y = 56;
    ctx.fillStyle = INK;
    ctx.fillRect(x, y, 420, 230);
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(x + 4, y + 4, 412, 222);
    ctx.strokeStyle = '#c08a20';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 12, y + 12, 396, 206);
    const ink = '#3a1a60';
    text('FACULTY OF PHYSICS', W / 2, y + 26, 10, ink, 'center', null);
    text('THIS CERTIFIES THAT', W / 2, y + 52, 8, ink, 'center', null);
    text('THE HERO', W / 2, y + 70, 16, '#c0107a', 'center', null);
    text('HAS SURVIVED', W / 2, y + 98, 8, ink, 'center', null);
    text('MECHANICS - E&M - WAVES', W / 2, y + 114, 8, ink, 'center', null);
    text('AND IS AWARDED THE DEGREE OF', W / 2, y + 134, 8, ink, 'center', null);
    text('B.SC. IN PHYSICS', W / 2, y + 152, 12, '#3a0ca3', 'center', null);
    text(`POINTS ${S.points}/${WIN_POINTS}   MONEY LEFT $${S.money}`, W / 2, y + 182, 8, ink, 'center', null);
    circle(x + 370, y + 190, 18, '#c0103c');
    circle(x + 370, y + 190, 13, '#ff3c6e');
    text('A+', x + 370, y + 186, 8, '#ffffff', 'center', null);

    drawFx();
    if (stateT > 1.5 && blinkOn(2)) text('CLICK OR PRESS SPACE TO PLAY AGAIN', W / 2, 310, 8, '#ffffff', 'center');
  }

  function draw() {
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    switch (S.state) {
      case 'title': drawTitle(); break;
      case 'intro': drawWorld(); drawIntro(); break;
      case 'fight': drawWorld(); drawHUD(); if (S.paused) drawPause(); break;
      case 'victory': drawWorld(); drawHUD(); drawVictory(); break;
      case 'shop': drawShop(); break;
      case 'gameover': drawWorld(); drawGameOver(); break;
      case 'win': drawWin(); break;
    }
    ctx.restore();
  }

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    pressed.clear();
    mouse.clicked = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
