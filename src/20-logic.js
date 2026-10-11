// ===== 盤面・折りのルール・主人公の物理・到達検証（three.js を使わない部分） =====
const HERO = CFG.hero;

class World {
  constructor(level) {
    this.W = level.w; this.H = level.h;
    this.base = new Uint8Array(this.W * this.H);
    for (const [x, y, w, h] of level.rects)
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.base[j * this.W + i] = 1;
    this.folds = level.folds.map(f => {
      const x0 = f.dir > 0 ? f.f : f.f - f.w;
      return { f: f.f, w: f.w, dir: f.dir, x0, x1: x0 + f.w, y0: f.y0, y1: f.y1 };
    });
    this.active = -1;   // 折っている折り目の番号（折っていなければ -1）。同時に折れるのは1か所だけ
  }
  mir(fd, cx) { return 2 * fd.f - 1 - cx; }
  inSource(fd, cx, cy) { return cx >= fd.x0 && cx < fd.x1 && cy >= fd.y0 && cy < fd.y1; }
  inTarget(fd, cx, cy) { return this.inSource(fd, this.mir(fd, cx), cy); }
  baseSolid(cx, cy) { return cx >= 0 && cx < this.W && cy >= 0 && cy < this.H && this.base[cy * this.W + cx] === 1; }
  // 折り状態を考慮した「そこは固い？」。紙の左右の端は見えない壁、下は落ちる
  solid(cx, cy, active = this.active) {
    if (cx < 0 || cx >= this.W) return true;
    if (cy < 0 || cy >= this.H) return false;
    let s = this.base[cy * this.W + cx] === 1;
    if (active >= 0) {
      const fd = this.folds[active];
      if (s && this.inSource(fd, cx, cy)) s = false;
      if (!s && this.inTarget(fd, cx, cy) && this.baseSolid(this.mir(fd, cx), cy)) s = true;
    }
    return s;
  }
  isLayer(cx, cy) {     // 折り返された耳のマス
    if (this.active < 0) return false;
    const fd = this.folds[this.active];
    return this.inTarget(fd, cx, cy) && this.baseSolid(this.mir(fd, cx), cy);
  }
  isBaseKept(cx, cy) {  // 元の位置に残っている紙のマス
    if (!this.baseSolid(cx, cy)) return false;
    return !(this.active >= 0 && this.inSource(this.folds[this.active], cx, cy));
  }
}

// 主人公の体が重なるマスの範囲 [x0,x1,y0,y1]
function heroCells(x, y) {
  return [Math.floor(x - HERO.hw + 1e-6), Math.floor(x + HERO.hw - 1e-6),
          Math.floor(y + 1e-6), Math.floor(y + HERO.h - 1e-6)];
}

// 折れる？  { ok, why }  why: far / side / active / overlap / onTab
function canFold(w, i, x, y) {
  if (w.active >= 0) return { ok: false, why: 'active' };
  const fd = w.folds[i];
  if (fd.dir > 0 ? x >= fd.f : x <= fd.f) return { ok: false, why: 'side' };   // 主人公は耳の反対側にいる
  if (Math.abs(x - fd.f) > CFG.fold.near || y < fd.y0 - 5 || y > fd.y1 + 6) return { ok: false, why: 'far' };
  const [x0, x1, y0, y1] = heroCells(x, y);
  const row = Math.floor(y - 0.05);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++)
      if (w.inTarget(fd, cx, cy) && w.baseSolid(w.mir(fd, cx), cy)) return { ok: false, why: 'overlap' };
    if (w.inSource(fd, cx, row) && w.baseSolid(cx, row)) return { ok: false, why: 'onTab' };   // 耳の上に乗っている
  }
  return { ok: true };
}

// 戻せる？  { ok, carried, nx }  耳の上に乗っていたら、耳ごと元の位置へ運ばれる（carried）
function canUnfold(w, x, y) {
  if (w.active < 0) return { ok: false, why: 'none' };
  const fd = w.folds[w.active];
  const [x0, x1] = heroCells(x, y);
  const row = Math.floor(y - 0.05);
  let layer = false, kept = false;
  for (let cx = x0; cx <= x1; cx++) {
    if (w.isBaseKept(cx, row)) kept = true; else if (w.isLayer(cx, row)) layer = true;
  }
  const carried = layer && !kept;
  const nx = carried ? 2 * fd.f - x : x;
  const [a0, a1, b0, b1] = heroCells(nx, y);
  for (let cx = a0; cx <= a1; cx++) for (let cy = b0; cy <= b1; cy++)
    if (w.solid(cx, cy, -1)) return { ok: false, why: 'overlap' };   // 戻すと紙に埋まる
  return { ok: true, carried, nx };
}

// ---- 主人公の物理（足元が y、中心が x） ----
function newHero(level) {
  return { x: level.start.x, y: level.start.y, vx: 0, vy: 0, ground: true, face: 1, coyote: 0, buf: 0, jumping: false, jumped: false, landed: 0 };
}

// inp: { left, right, jumpHeld, jumpPressed }
function stepHero(w, h, inp, dt) {
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const target = dir * HERO.speed;
  const acc = dir !== 0 ? (h.ground ? HERO.accelG : HERO.accelA) : (h.ground ? HERO.frictionG : HERO.accelA * 0.4);
  if (h.vx < target) h.vx = Math.min(target, h.vx + acc * dt);
  else if (h.vx > target) h.vx = Math.max(target, h.vx - acc * dt);
  if (dir) h.face = dir;

  h.coyote = h.ground ? HERO.coyote : Math.max(0, h.coyote - dt);
  h.buf = inp.jumpPressed ? HERO.buffer : Math.max(0, h.buf - dt);
  h.jumped = false; h.landed = 0;
  if (h.buf > 0 && h.coyote > 0) { h.vy = HERO.jumpV; h.buf = 0; h.coyote = 0; h.ground = false; h.jumped = true; h.jumping = true; }
  if (h.jumping && !inp.jumpHeld && h.vy > 0) { h.vy *= HERO.cutV; h.jumping = false; }
  if (h.vy <= 0) h.jumping = false;
  h.vy = Math.max(-HERO.maxFall, h.vy - HERO.gravity * dt);

  // X
  let nx = h.x + h.vx * dt;
  const r = heroCells(h.x, h.y);
  if (h.vx > 0) {
    const cx = Math.floor(nx + HERO.hw);
    for (let cy = r[2]; cy <= r[3]; cy++) if (w.solid(cx, cy)) { nx = cx - HERO.hw - 1e-4; h.vx = 0; break; }
  } else if (h.vx < 0) {
    const cx = Math.floor(nx - HERO.hw);
    for (let cy = r[2]; cy <= r[3]; cy++) if (w.solid(cx, cy)) { nx = cx + 1 + HERO.hw + 1e-4; h.vx = 0; break; }
  }
  h.x = nx;

  // Y
  let ny = h.y + h.vy * dt;
  const bx0 = Math.floor(h.x - HERO.hw + 1e-6), bx1 = Math.floor(h.x + HERO.hw - 1e-6);
  const wasGround = h.ground;
  h.ground = false;
  if (h.vy <= 0) {
    const cy = Math.floor(ny);
    for (let cx = bx0; cx <= bx1; cx++) {
      if (w.solid(cx, cy) && h.y >= cy + 1 - 1e-4) {
        if (!wasGround && h.vy < -8) h.landed = Math.min(1, -h.vy / 20);
        ny = cy + 1; h.vy = 0; h.ground = true; break;
      }
    }
  } else {
    const cy = Math.floor(ny + HERO.h);
    for (let cx = bx0; cx <= bx1; cx++) if (w.solid(cx, cy)) { ny = cy - HERO.h - 1e-4; h.vy = 0; h.jumping = false; break; }
  }
  h.y = ny;
}

// ---- 到達検証：「立てるマス」の間を、歩き・ジャンプ・折る・戻すでつないで、ゴールに着けるか ----
function surfaces(w, cx, active) {
  const out = [];
  if (cx < 0 || cx >= w.W) return out;
  for (let y = 1; y < w.H - 2; y++)
    if (w.solid(cx, y - 1, active) && !w.solid(cx, y, active) && !w.solid(cx, y + 1, active)) out.push(y);
  return out;
}

function solve(w, level, opts = {}) {
  const allowFold = opts.allowFold !== false;
  const key = (a, cx, y) => ((a + 1) * 100 + cx) * 100 + y;
  const sx = Math.floor(level.start.x), sy = level.start.y;
  const gx = level.goal.x, gy = level.goal.y;
  const prev = new Map(), q = [[-1, sx, sy]];
  prev.set(key(-1, sx, sy), null);
  const save = w.active;
  let found = null;
  const push = (from, a, cx, y, label) => {
    const k = key(a, cx, y);
    if (prev.has(k)) return;
    prev.set(k, { from, label });
    q.push([a, cx, y]);
  };
  while (q.length) {
    const [a, cx, y] = q.shift();
    if (Math.abs(cx + 0.5 - gx) <= 1.0 && Math.abs(y - gy) <= 1) { found = key(a, cx, y); break; }
    const from = key(a, cx, y);
    w.active = a;
    for (let dx = -CFG.solver.maxGap; dx <= CFG.solver.maxGap; dx++) {
      if (dx === 0) continue;
      const nx = cx + dx, step = Math.sign(dx);
      let blocked = false;
      for (let k = cx + step; k !== nx; k += step)
        if (w.solid(k, y + 2, a) || w.solid(k, y + 3, a)) { blocked = true; break; }
      if (blocked) continue;
      const ys = surfaces(w, nx, a).filter(v => v <= y + CFG.solver.stepUp);
      if (!ys.length) continue;
      if (Math.abs(dx) === 1) { for (const v of ys) if (v >= y - 7) push(from, a, nx, v, 'move'); }
      else push(from, a, nx, Math.max(...ys), 'jump');
    }
    if (allowFold) {
      const hx = cx + 0.5;
      if (a < 0) {
        for (let i = 0; i < w.folds.length; i++)
          if (canFold(w, i, hx, y).ok) push(from, i, cx, y, 'fold ' + i);
      } else {
        const r = canUnfold(w, hx, y);
        if (r.ok) push(from, -1, Math.floor(r.nx), y, 'unfold ' + a + (r.carried ? ' carried' : ''));
      }
    }
  }
  w.active = save;
  if (found === null) return { solvable: false, steps: [] };
  const steps = [];
  for (let k = found; prev.get(k); k = prev.get(k).from) steps.unshift(prev.get(k).label);
  return { solvable: true, steps, folds: steps.filter(s => s.startsWith('fold')).length };
}
