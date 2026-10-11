// ===== 盤面・折りのルール・主人公の物理・到達検証（three.js を使わない部分） =====
const HERO = CFG.hero;
const popcount = m => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

class World {
  constructor(level) {
    this.W = level.w; this.H = level.h;
    this.maxFolds = level.maxFolds || 1;   // 同時に折れる数（二重折りは 2）
    this.base = new Uint8Array(this.W * this.H);
    for (const [x, y, w, h] of level.rects)
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.base[j * this.W + i] = 1;
    this.folds = level.folds.map(f => {
      const back = new Set();   // 裏面にだけある足場（元の位置の座標）
      for (const [x, y, w, h] of (f.back || []))
        for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) back.add(j * this.W + i);
      if (f.axis === 'y') {     // 横の折り目（上下に折る）：耳は x0〜x1、折り目の高さ f から上(dir=+1)か下(-1)へ h
        const y0 = f.dir > 0 ? f.f : f.f - f.h;
        return { axis: 'y', f: f.f, dir: f.dir, x0: f.x0, x1: f.x1, y0, y1: y0 + f.h, back };
      }
      const x0 = f.dir > 0 ? f.f : f.f - f.w;   // 縦の折り目（左右に折る）
      return { axis: 'x', f: f.f, dir: f.dir, x0, x1: x0 + f.w, y0: f.y0, y1: f.y1, back };
    });
    this.spikes = [];
    for (const [x, y, w] of (level.spikes || [])) for (let i = 0; i < w; i++) this.spikes.push({ cx: x + i, cy: y, back: -1 });
    this.shards = (level.shards || []).map(s => ({ cx: s.x, cy: s.y, back: s.back === undefined ? -1 : s.back }));
    this.flags = (level.flags || []).map(f => ({ cx: Math.floor(f.x), cy: f.y, x: f.x, y: f.y }));
    this.mask = 0;      // 折っている折り目（ビット i = i 番）
  }
  isOn(i, mask = this.mask) { return (mask >> i & 1) === 1; }
  // 鏡写しの位置
  mir(fd, cx, cy) { return fd.axis === 'x' ? [2 * fd.f - 1 - cx, cy] : [cx, 2 * fd.f - 1 - cy]; }
  inSource(fd, cx, cy) { return cx >= fd.x0 && cx < fd.x1 && cy >= fd.y0 && cy < fd.y1; }
  inTarget(fd, cx, cy) { const m = this.mir(fd, cx, cy); return this.inSource(fd, m[0], m[1]); }
  baseSolid(cx, cy) { return cx >= 0 && cx < this.W && cy >= 0 && cy < this.H && this.base[cy * this.W + cx] === 1; }
  // 耳の元の位置にある固いマス（表の紙＋裏面の足場）
  srcSolid(fd, cx, cy) {
    return this.baseSolid(cx, cy) || (cx >= 0 && cx < this.W && cy >= 0 && cy < this.H && fd.back.has(cy * this.W + cx));
  }
  // 折り状態（mask）を考慮した「そこは固い？」。紙の左右の端は見えない壁、下は落ちる
  solid(cx, cy, mask = this.mask) {
    if (cx < 0 || cx >= this.W) return true;
    if (cy < 0 || cy >= this.H) return false;
    let s = this.base[cy * this.W + cx] === 1;
    if (mask) {
      for (let i = 0; i < this.folds.length; i++) {
        if (!(mask >> i & 1)) continue;
        const fd = this.folds[i];
        if (s && this.inSource(fd, cx, cy)) s = false;
      }
      if (!s) for (let i = 0; i < this.folds.length; i++) {
        if (!(mask >> i & 1)) continue;
        const fd = this.folds[i];
        if (this.inTarget(fd, cx, cy)) { const m = this.mir(fd, cx, cy); if (this.srcSolid(fd, m[0], m[1])) { s = true; break; } }
      }
    }
    return s;
  }
  // 折り目 i が折り返したマスか
  isLayerOf(i, cx, cy) {
    const fd = this.folds[i];
    if (!this.inTarget(fd, cx, cy)) return false;
    const m = this.mir(fd, cx, cy);
    return this.srcSolid(fd, m[0], m[1]);
  }
  // 元の位置に残っている紙のマス
  isKept(cx, cy, mask = this.mask) {
    if (!this.baseSolid(cx, cy)) return false;
    for (let i = 0; i < this.folds.length; i++) if ((mask >> i & 1) && this.inSource(this.folds[i], cx, cy)) return false;
    return true;
  }
  // アイテム（トゲ・欠片）が今いるマス。裏面にだけあるものは、その折り目を折っているときだけ現れる
  itemCell(it, mask = this.mask) {
    if (it.back >= 0) {
      if (!(mask >> it.back & 1)) return null;
      return this.mir(this.folds[it.back], it.cx, it.cy);
    }
    for (let i = 0; i < this.folds.length; i++)
      if ((mask >> i & 1) && this.inSource(this.folds[i], it.cx, it.cy)) return this.mir(this.folds[i], it.cx, it.cy);
    return [it.cx, it.cy];
  }
  // 働いているトゲのマス（板でふさがれたら働かない）
  spikeCell(sp, mask = this.mask) {
    const c = this.itemCell(sp, mask);
    return c && !this.solid(c[0], c[1], mask) ? c : null;
  }
  // 耳の折り先の範囲
  targetRect(fd) {
    return fd.axis === 'x'
      ? { x0: 2 * fd.f - fd.x1, x1: 2 * fd.f - fd.x0, y0: fd.y0, y1: fd.y1 }
      : { x0: fd.x0, x1: fd.x1, y0: 2 * fd.f - fd.y1, y1: 2 * fd.f - fd.y0 };
  }
}

// 主人公の体が重なるマスの範囲 [x0,x1,y0,y1]
function heroCells(x, y) {
  return [Math.floor(x - HERO.hw + 1e-6), Math.floor(x + HERO.hw - 1e-6),
          Math.floor(y + 1e-6), Math.floor(y + HERO.h - 1e-6)];
}

function hitsSpike(w, h) {
  for (const sp of w.spikes) {
    const c = w.spikeCell(sp);
    if (!c) continue;
    if (h.x + HERO.hw > c[0] + 0.1 && h.x - HERO.hw < c[0] + 0.9 && h.y < c[1] + CFG.item.spikeH && h.y + HERO.h > c[1]) return true;
  }
  return false;
}

// 折り目までの距離（ガイドと「いちばん近い折り目」の選択用）
function hingeDist(fd, x, y) {
  if (fd.axis === 'x') return Math.hypot(x - fd.f, Math.max(0, fd.y0 - y, y - fd.y1));
  return Math.hypot(y - fd.f, Math.max(0, fd.x0 - x, x - fd.x1));
}

// 2つの耳を同時に折れる？（耳の元どうしが重ならない／折り先が相手の紙に乗らない）
function compatible(w, i, j) {
  const a = w.folds[i], b = w.folds[j];
  const ov = (p, q) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
  if (ov(a, b)) return false;
  const hit = (tgt, src) => {
    for (let cy = Math.max(tgt.y0, src.y0); cy < Math.min(tgt.y1, src.y1); cy++)
      for (let cx = Math.max(tgt.x0, src.x0); cx < Math.min(tgt.x1, src.x1); cx++)
        if (w.baseSolid(cx, cy)) return true;
    return false;
  };
  return !hit(w.targetRect(a), b) && !hit(w.targetRect(b), a);
}

// 体が盤面（折り状態 mask）にめり込んでいないか
function heroFits(w, x, y, mask) {
  const [x0, x1, y0, y1] = heroCells(x, y);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) if (w.solid(cx, cy, mask)) return false;
  return true;
}
function heroSupported(w, x, y, mask) {
  const [x0, x1] = heroCells(x, y);
  const row = Math.floor(y - 0.05);
  for (let cx = x0; cx <= x1; cx++) if (w.solid(cx, row, mask)) return true;
  return false;
}
// 折り先に体が重なるとき：上へ持ち上げて紙の上に乗せる（最大 CFG.fold.lift マス）。だめなら横へ押し出す。
// 返り値 { x, y } または null（どうしても入らない）
function resolveFit(w, x, y, mask) {
  if (heroFits(w, x, y, mask)) return { x, y };
  for (let dy = 1; dy <= CFG.fold.lift; dy++)
    if (heroFits(w, x, y + dy, mask) && heroSupported(w, x, y + dy, mask)) return { x, y: y + dy };
  for (const needSupport of [true, false])
    for (let d = 0.5; d <= CFG.fold.push + 1e-9; d += 0.5)
      for (const s of [1, -1]) {
        const nx = x + s * d;
        if (heroFits(w, nx, y, mask) && (!needSupport || heroSupported(w, nx, y, mask))) return { x: nx, y };
      }
  return null;
}

// 折れる？  { ok, why, x, y, carried }
//   why: far / side / active / max / compat / overlap
//   折り先に体が重なっても、紙の上に持ち上げる（または押し出す）ので折れる。耳の上に乗っていたら、耳ごと運ぶ（縦の折り目）
function canFold(w, i, x, y) {
  const fd = w.folds[i];
  if (w.isOn(i)) return { ok: false, why: 'active' };
  if (popcount(w.mask) >= w.maxFolds) return { ok: false, why: 'max' };
  for (let j = 0; j < w.folds.length; j++) if (w.isOn(j) && !compatible(w, i, j)) return { ok: false, why: 'compat' };
  if (fd.axis === 'x') {
    if (fd.dir > 0 ? x >= fd.f : x <= fd.f) return { ok: false, why: 'side' };   // 主人公は耳の反対側にいる
    if (Math.abs(x - fd.f) > CFG.fold.near || y < fd.y0 - 5 || y > fd.y1 + 6) return { ok: false, why: 'far' };
  } else {
    if (fd.dir > 0 ? y >= fd.f : y < fd.f) return { ok: false, why: 'side' };
    if (Math.abs(y - fd.f) > CFG.fold.near || x < fd.x0 - 4 || x > fd.x1 + 4) return { ok: false, why: 'far' };
  }
  const [x0, x1] = heroCells(x, y);
  const row = Math.floor(y - 0.05);
  let onTab = false;
  for (let cx = x0; cx <= x1; cx++) if (w.inSource(fd, cx, row) && w.baseSolid(cx, row)) onTab = true;
  const carried = onTab && fd.axis === 'x';
  const nx = carried ? 2 * fd.f - x : x;
  const res = resolveFit(w, nx, y, w.mask | (1 << i));
  if (!res) return { ok: false, why: 'overlap' };
  return { ok: true, x: res.x, y: res.y, carried };
}

// 折り目 j を戻せる？  { ok, why, carried, nx, y }
//   耳の上に乗っていたら、耳ごと元の位置へ運ばれる（縦の折り目のみ）。戻した紙が体に重なるときは持ち上げる
function canUnfold(w, j, x, y) {
  if (!w.isOn(j)) return { ok: false, why: 'none' };
  const fd = w.folds[j];
  const [x0, x1] = heroCells(x, y);
  const row = Math.floor(y - 0.05);
  let kept = false, onJ = false, onOther = false;
  for (let cx = x0; cx <= x1; cx++) {
    if (w.isKept(cx, row)) { kept = true; continue; }
    for (let k = 0; k < w.folds.length; k++) {
      if (!w.isOn(k) || !w.isLayerOf(k, cx, row)) continue;
      if (k === j) onJ = true; else onOther = true;
    }
  }
  const carried = onJ && !kept && !onOther && fd.axis === 'x';
  const mask2 = w.mask & ~(1 << j);
  const res = resolveFit(w, carried ? 2 * fd.f - x : x, y, mask2);
  if (!res) return { ok: false, why: 'overlap' };
  // 縦の折りで運ばれた先に足場がなければ（裏面の板の上）、落ちてしまうので戻せない
  if (carried && !heroSupported(w, res.x, res.y, mask2)) return { ok: false, why: 'void' };
  return { ok: true, carried, nx: res.x, y: res.y };
}

// 次に折りたい折り目 j を、前の折りを自動で戻しながら折る計画
//   { ok, unfold: 戻す折り目（なければ -1）, r: canFold の結果 }。order は古い順の折っている番号
function planFold(w, j, x, y, order) {
  const r = canFold(w, j, x, y);
  if (r.ok) return { ok: true, unfold: -1, r };
  if (r.why !== 'max' && r.why !== 'compat') return { ok: false, why: r.why };
  const saved = w.mask;
  for (const i of order) {
    if (!w.isOn(i)) continue;
    const u = canUnfold(w, i, x, y);
    if (!u.ok || u.carried || u.nx !== x || u.y !== y) continue;   // 自動で戻すのは、主人公が動かないときだけ
    w.mask = saved & ~(1 << i);
    const f = canFold(w, j, x, y);
    w.mask = saved;
    if (f.ok) return { ok: true, unfold: i, r: f };
  }
  return { ok: false, why: r.why };
}

// ---- 主人公の物理（足元が y、中心が x） ----
function newHero(level, at) {
  const s = at || level.start;
  return { x: s.x, y: s.y, vx: 0, vy: 0, ground: true, face: 1, coyote: 0, buf: 0, jumping: false, jumped: false, landed: 0 };
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

// ---- 到達検証：「立てるマス」の間を、歩き・ジャンプ・折る・戻すでつないで、目的に着けるか ----
// 折ったあとの位置 (x, y) から、そのまま立てるか、落ちて着く先を探す（着けなければ null）
function settle(w, x, y, mask) {
  const cx = Math.floor(x);
  if (heroSupported(w, x, y, mask)) return [cx, y];
  for (let yy = Math.floor(y) - 1; yy >= 0; yy--)
    if (w.solid(cx, yy - 1, mask) && !w.solid(cx, yy, mask) && !w.solid(cx, yy + 1, mask)) return [cx, yy];
  return null;
}

function surfaces(w, cx, mask) {
  const out = [];
  if (cx < 0 || cx >= w.W) return out;
  for (let y = 1; y < w.H - 2; y++)
    if (w.solid(cx, y - 1, mask) && !w.solid(cx, y, mask) && !w.solid(cx, y + 1, mask)) out.push(y);
  return out;
}

function spikeAtNode(w, mask, cx, y) {
  for (const sp of w.spikes) { const c = w.spikeCell(sp, mask); if (c && c[0] === cx && c[1] === y) return true; }
  return false;
}

// goalFn(mask, cx, y) が真になる立ち位置まで。返り値 nodes: [{m,cx,y,kind,i}]（kind: start/move/jump/fold/unfold）
function solve(w, level, opts = {}) {
  const allowFold = opts.allowFold !== false;
  const gx = level.goal.x, gy = level.goal.y;
  const goalFn = opts.goalFn || ((m, cx, y) => Math.abs(cx + 0.5 - gx) <= 1.0 && Math.abs(y - gy) <= 1);
  const key = (m, cx, y) => ((m * 200) + cx) * 100 + y;
  const st = opts.start || { cx: Math.floor(level.start.x), y: level.start.y, mask: 0 };   // ヒント用：今の位置から探す
  const sx = st.cx, sy = st.y, sm = st.mask;
  const prev = new Map(), q = [[sm, sx, sy]];
  prev.set(key(sm, sx, sy), { from: null, node: { m: sm, cx: sx, y: sy, kind: 'start' } });
  const save = w.mask;
  let found = null;
  const push = (from, m, cx, y, kind, i) => {
    const k = key(m, cx, y);
    if (prev.has(k)) return;
    if (spikeAtNode(w, m, cx, y)) return;
    prev.set(k, { from, node: { m, cx, y, kind, i } });
    q.push([m, cx, y]);
  };
  while (q.length) {
    const [m, cx, y] = q.shift();
    if (goalFn(m, cx, y)) { found = key(m, cx, y); break; }
    const from = key(m, cx, y);
    const mg = opts.maxGap || CFG.solver.maxGap;
    for (let dx = -mg; dx <= mg; dx++) {
      if (dx === 0) continue;
      const nx = cx + dx, step = Math.sign(dx);
      let blocked = false;
      for (let k = cx + step; k !== nx; k += step)
        if (w.solid(k, y + 2, m) || w.solid(k, y + 3, m)) { blocked = true; break; }
      if (blocked) continue;
      let ys = surfaces(w, nx, m).filter(v => v <= y + CFG.solver.stepUp);
      // 上へ跳ぶときは、出発の列の頭上が空いている（天井にぶつからない）
      ys = ys.filter(v => { for (let r = y + 2; r <= v + 1; r++) if (w.solid(cx, r, m)) return false; return true; });
      if (!ys.length) continue;
      if (Math.abs(dx) === 1) { for (const v of ys) if (v >= y - 7) push(from, m, nx, v, 'move'); }
      else push(from, m, nx, Math.max(...ys), 'jump');
    }
    if (allowFold) {
      const hx = cx + 0.5;
      w.mask = m;
      for (let i = 0; i < w.folds.length; i++) {
        if (m >> i & 1) {
          const r = canUnfold(w, i, hx, y);
          if (r.ok) { const s = settle(w, r.nx, r.y, m & ~(1 << i)); if (s) push(from, m & ~(1 << i), s[0], s[1], 'unfold', i); }
        } else if (hingeDist(w.folds[i], hx, y) <= CFG.fold.near - 0.6 && canFold(w, i, hx, y).ok) {
          { const r = canFold(w, i, hx, y); const s = settle(w, r.x, r.y, m | (1 << i)); if (s) push(from, m | (1 << i), s[0], s[1], 'fold', i); }
        }
      }
    }
  }
  w.mask = save;
  if (found === null) return { solvable: false, nodes: [], steps: [], folds: 0 };
  const nodes = [];
  for (let k = found; k !== null; k = prev.get(k).from) nodes.unshift(prev.get(k).node);
  return { solvable: true, nodes, steps: nodes.slice(1).map(n => n.kind + (n.i !== undefined ? ' ' + n.i : '')), folds: nodes.filter(n => n.kind === 'fold').length };
}

// 小さな欠片 s に、折りを使って届く立ち位置があるか
function shardGoal(w, s) {
  return (m, cx, y) => {
    const c = w.itemCell(s, m);
    if (!c) return false;
    const dy = (c[1] + 0.5) - (y + 0.75);
    return Math.abs(c[0] - cx) <= 1 && dy >= -1 && dy <= 2.2;
  };
}
