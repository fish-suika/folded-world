
// ===== 検証 =====
let pass = 0, fail = 0;
function T(name, ok, why) {
  const d = document.createElement('div');
  d.className = 'r ' + (ok ? 'ok' : 'ng');
  d.textContent = name + (ok || !why ? '' : '  — ' + why);
  document.getElementById('out').appendChild(d);
  ok ? pass++ : fail++;
}
const flat = rects => ({ id: 't', w: 40, h: 14, start: { x: 2.5, y: 2 }, goal: { x: 0, y: 0 }, folds: [], rects });

// --- 物理 ---
(function () {
  const w = new World(flat([[0, 0, 40, 2]]));
  const sim = (inp, steps, h) => { for (let i = 0; i < steps; i++) stepHero(w, h, typeof inp === 'function' ? inp(i, h) : inp, 1 / 120); return h; };
  let h = newHero(flat([]), { x: 5, y: 2 }); sim({}, 240, h);
  T('平地に立っていられる', h.ground && Math.abs(h.y - 2) < 1e-6, 'y=' + h.y);
  h = newHero(flat([]), { x: 5, y: 2 }); let maxY = 0;
  sim((i, hh) => { maxY = Math.max(maxY, hh.y); return { jumpPressed: i === 0, jumpHeld: true }; }, 240, h);
  T('フルジャンプの高さ 2.4〜2.9 マス', maxY - 2 > 2.4 && maxY - 2 < 2.9, (maxY - 2).toFixed(2));
  const hj = newHero(flat([]), { x: 5, y: 2 }); let landX = 0;
  for (let i = 0; i < 400; i++) {
    stepHero(w, hj, { right: true, jumpPressed: i === 120, jumpHeld: true }, 1 / 120);
    if (i > 125 && hj.ground) { landX = hj.x; break; }
  }
  // 走り出しの位置から、ジャンプして着地するまでの水平距離
  const hk = newHero(flat([]), { x: 5, y: 2 });
  for (let i = 0; i < 200; i++) stepHero(w, hk, { right: true }, 1 / 120);
  const jx = hk.x; let lx = 0;
  for (let i = 0; i < 300; i++) { stepHero(w, hk, { right: true, jumpPressed: i === 0, jumpHeld: true }, 1 / 120); if (i > 5 && hk.ground) { lx = hk.x; break; } }
  T('走りジャンプの距離 4.3 マス以上', lx - jx > 4.3, (lx - jx).toFixed(2));
  const w3 = new World(flat([[0, 0, 40, 2], [10, 2, 2, 3]]));
  h = newHero(flat([]), { x: 5, y: 2 });
  for (let i = 0; i < 1200; i++) stepHero(w3, h, { right: true, jumpPressed: h.ground && h.x > 8.2, jumpHeld: true }, 1 / 120);
  T('3 マスの壁は跳び越せない', h.x < 10, 'x=' + h.x.toFixed(2));
  const w2 = new World(flat([[0, 0, 40, 2], [10, 2, 2, 2]]));
  h = newHero(flat([]), { x: 5, y: 2 }); let landedOn = false;
  for (let i = 0; i < 600; i++) { stepHero(w2, h, { right: true, jumpPressed: h.ground && h.x > 8.2 && h.x < 9.5, jumpHeld: true }, 1 / 120); if (h.ground && h.x > 10 && h.x < 12 && h.y > 3.99) landedOn = true; }
  T('2 マスの段には跳び乗れる', landedOn);
})();

// --- 折りのルール（1-1） ---
(function () {
  const w = new World(LEVELS[0]);
  w.active = 1;
  let ok = true; for (let cx = 18; cx <= 23; cx++) if (!w.solid(cx, 1)) ok = false;
  T('1-1 T1 を折ると板が穴（18〜23）に架かる', ok);
  T('1-1 T1 を折ると元の位置（24〜29 の行1）は空になり行0 は残る', !w.solid(24, 1) && !w.solid(29, 1) && w.solid(24, 0));
  w.active = 2;
  T('1-1 T2 を折ると崖の足元が手前（39〜40, 行2〜3）に来る', w.solid(39, 2) && w.solid(40, 3) && !w.solid(41, 2) && w.solid(41, 4));
  w.active = 0;
  T('1-1 T0 を折ると段（6〜7, 行2）ができる', w.solid(6, 2) && w.solid(7, 2) && !w.solid(8, 2) && w.solid(8, 3));
  w.active = -1;
  T('折れない: 段の位置に立っている', !canFold(w, 2, 39.6, 2).ok && canFold(w, 2, 39.6, 2).why === 'overlap');
  T('折れる: 離れた位置から', canFold(w, 2, 36.5, 2).ok);
  T('折れない: 耳の反対側にいない', !canFold(w, 2, 43, 6).ok);
  T('折れない: 遠すぎる／近づくと折れる', !canFold(w, 1, 2.5, 2).ok && canFold(w, 1, 15.3, 2).ok);
  w.active = 1;
  const u = canUnfold(w, 20.5, 2);
  T('板の上で戻すと向こう岸（x=27.5）へ運ばれる', u.ok && u.carried && Math.abs(u.nx - 27.5) < 1e-6, JSON.stringify(u));
  const u2 = canUnfold(w, 12, 2);
  T('手前の地面で戻しても動かない', u2.ok && !u2.carried);
  w.active = 0;
  T('段の上からは壁が邪魔で戻せない', !canUnfold(w, 6.5, 3).ok);
})();

// --- 裏面・トゲ・アイテム（1-2） ---
(function () {
  const w = new World(LEVELS[1]);
  T('裏面の足場は折る前は存在しない', !w.solid(15, 2) && !w.solid(25, 2) && !w.srcSolid(w.folds[0], 25, 2) === false);
  w.active = 0;
  let ok = true; for (let cx = 15; cx <= 22; cx++) if (!w.solid(cx, 2)) ok = false;
  T('Ta を折ると裏面の橋が穴（15〜22, 行2）に現れる', ok);
  T('裏面にだけある欠片は折ったときだけ現れる', w.itemCell(w.shards[0], 0)[0] === 19 && w.itemCell(w.shards[0], -1) === null);
  // 裏面の橋の上で戻すと、元の位置に足場がない
  const u = canUnfold(w, 18.5, 3);
  T('裏面の橋の上で戻そうとすると「足場がない」で戻せない', !u.ok && u.why === 'void', JSON.stringify(u));
  const u2 = canUnfold(w, 30, 2);
  T('向こう岸（残る紙）に立っていれば戻せる', u2.ok && !u2.carried);
  w.active = -1;
  const sp = w.spikes[0];
  T('トゲは折っていないとき働く', w.spikeCell(sp, -1) !== null);
  w.active = 1;
  T('板をかぶせるとトゲは働かない', w.spikeCell(sp, 1) === null && w.solid(36, 2) && w.solid(39, 2));
  const h = newHero(LEVELS[1], { x: 36.5, y: 3 });
  T('板の上に立ってもトゲに当たらない', !hitsSpike(w, h));
  w.active = -1;
  const h2 = newHero(LEVELS[1], { x: 36.5, y: 2 });
  T('トゲの上に立つと当たる', hitsSpike(w, h2));
})();

// --- 到達検証（全ステージ） ---
for (const lv of LEVELS) {
  const w = new World(lv);
  const a = solve(w, lv), b = solve(w, lv, { allowFold: false });
  T(lv.id + ' 折らないとゴールに着けない', !b.solvable);
  T(lv.id + ' 折ればゴールに着ける', a.solvable, '');
  if (a.solvable) T(lv.id + ' 解答の折り: ' + a.folds + ' 回 [' + a.steps.join(', ') + ']', a.folds >= 1);
  lv.shards.forEach((s, i) => {
    const r = solve(w, lv, { goalFn: shardGoal(w, w.shards[i]) });
    T(lv.id + ' 欠片 ' + (i + 1) + ' に届く' + (s.back !== undefined ? '（裏面）' : ''), r.solvable);
  });
  lv.flags.forEach((f, i) => {
    const r = solve(w, lv, { goalFn: (aa, cx, y) => Math.abs(cx + 0.5 - f.x) <= 1 && y === f.y });
    T(lv.id + ' 旗 ' + (i + 1) + ' に届く', r.solvable);
  });
}

// --- 実際の物理で通しで遊ぶボット（解答の経路をたどる） ---
function runBot(lv) {
  const w = new World(lv);
  const r = solve(w, lv);
  if (!r.solvable) return { ok: false, why: 'unsolvable' };
  const h = newHero(lv), dt = 1 / 120;
  const log = [];
  let ni = 1, nodeT = 0, t = 0;
  while (ni < r.nodes.length && t < 240) {
    const nd = r.nodes[ni];
    if (nd.kind === 'fold' || nd.kind === 'unfold') {
      const ccx = r.nodes[ni - 1].cx + 0.5;   // 立っているマスの中央に寄ってから折る
      if (!h.ground || Math.abs(h.x - ccx) > 0.15) {
        const dd = ccx - h.x;
        stepHero(w, h, h.ground ? { left: dd < 0, right: dd > 0 } : {}, dt); t += dt; nodeT += dt;
        if (nodeT > 6) return { ok: false, why: "not ready for " + nd.kind + " x=" + h.x.toFixed(2), log };
        continue;
      }
      if (nd.kind === 'fold') {
        const c = canFold(w, nd.i, h.x, h.y);
        if (!c.ok) return { ok: false, why: 'cannot fold ' + nd.i + ' (' + c.why + ') x=' + h.x.toFixed(2), log };
        w.active = nd.i; log.push('fold' + nd.i + '@' + h.x.toFixed(1));
      } else {
        const c = canUnfold(w, h.x, h.y);
        if (!c.ok) return { ok: false, why: 'cannot unfold (' + c.why + ') x=' + h.x.toFixed(2), log };
        w.active = -1; if (c.carried) h.x = c.nx; log.push('unfold@' + h.x.toFixed(1));
      }
      h.vx = 0; ni++; nodeT = 0; continue;
    }
    // 歩き・ジャンプ
    const tx = nd.cx + 0.5;
    if (h.ground && Math.floor(h.x) === nd.cx && Math.abs(h.y - nd.y) < 0.05 && w.active === nd.a) { ni++; nodeT = 0; continue; }
    const dx = tx - h.x, dir = Math.abs(dx) < 0.12 ? 0 : Math.sign(dx);
    let jump = false;
    if (h.ground && dir !== 0) {
      const ahead = Math.floor(h.x + dir * 0.7), fr = Math.floor(h.y), sup = Math.floor(h.y - 0.05);
      if (w.solid(ahead, fr) || w.solid(ahead, fr + 1)) jump = true;                       // 壁
      if (!w.solid(ahead, sup) && !w.solid(ahead + dir, sup)) jump = true;                 // 穴
      for (const sp of w.spikes) { const c = w.spikeCell(sp); if (c && c[1] === fr && (c[0] === ahead || c[0] === ahead + dir)) jump = true; }   // トゲ
    }
    stepHero(w, h, { left: dir < 0, right: dir > 0, jumpPressed: jump, jumpHeld: jump || !h.ground }, dt);
    t += dt; nodeT += dt;
    if (h.y < CFG.hero.deathY) return { ok: false, why: 'fell at x=' + h.x.toFixed(1) + ' node ' + ni + ' ' + JSON.stringify(nd), log };
    if (hitsSpike(w, h)) return { ok: false, why: 'spike at x=' + h.x.toFixed(1) + ' node ' + ni, log };
    if (nodeT > 8) return { ok: false, why: 'stuck at x=' + h.x.toFixed(1) + ' y=' + h.y.toFixed(1) + ' node ' + ni + ' ' + JSON.stringify(nd), log };
  }
  const reached = Math.abs(h.x - lv.goal.x) < 1.6 && Math.abs(h.y - lv.goal.y) < 1.2;
  return { ok: reached, why: reached ? '' : 'end at x=' + h.x.toFixed(1) + ' y=' + h.y.toFixed(1), log, t };
}
for (const lv of LEVELS) {
  const r = runBot(lv);
  T(lv.id + ' ボットが実際の物理でゴールに着く' + (r.t ? '（' + r.t.toFixed(1) + ' 秒）' : ''), r.ok, r.why + ' ' + (r.log || []).join(' '));
}

document.getElementById('sum').textContent = `${pass} PASS / ${fail} FAIL`;
document.title = (fail ? 'FAIL ' : 'OK ') + pass + '/' + (pass + fail);
