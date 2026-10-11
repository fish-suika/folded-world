
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
// 部品で小さなステージを作る
function mk(fn, opts) { const L = LB.make('t', 't', '', 1, 'meadow', opts || {}); fn(L); L.w = L.cur; L.goal = { x: L.cur - 2.5, y: 2 }; return L; }

// --- 物理 ---
(function () {
  const w = new World(flat([[0, 0, 40, 2]]));
  const sim = (inp, steps, h) => { for (let i = 0; i < steps; i++) stepHero(w, h, typeof inp === 'function' ? inp(i, h) : inp, 1 / 120); return h; };
  let h = newHero(flat([]), { x: 5, y: 2 }); sim({}, 240, h);
  T('平地に立っていられる', h.ground && Math.abs(h.y - 2) < 1e-6, 'y=' + h.y);
  h = newHero(flat([]), { x: 5, y: 2 }); let maxY = 0;
  sim((i, hh) => { maxY = Math.max(maxY, hh.y); return { jumpPressed: i === 0, jumpHeld: true }; }, 240, h);
  T('フルジャンプの高さ 2.4〜2.9 マス', maxY - 2 > 2.4 && maxY - 2 < 2.9, (maxY - 2).toFixed(2));
  const hk = newHero(flat([]), { x: 5, y: 2 });
  for (let i = 0; i < 200; i++) stepHero(w, hk, { right: true }, 1 / 120);
  const jx = hk.x; let lx = 0;
  for (let i = 0; i < 300; i++) { stepHero(w, hk, { right: true, jumpPressed: i === 0, jumpHeld: true }, 1 / 120); if (i > 5 && hk.ground) { lx = hk.x; break; } }
  T('走りジャンプの距離 4.3 マス以上、5 マス未満（検証の「届く」と食い違わない）', lx - jx > 4.3 && lx - jx < 5.0, (lx - jx).toFixed(2));
  const w3 = new World(flat([[0, 0, 40, 2], [10, 2, 2, 3]]));
  h = newHero(flat([]), { x: 5, y: 2 });
  for (let i = 0; i < 1200; i++) stepHero(w3, h, { right: true, jumpPressed: h.ground && h.x > 8.2, jumpHeld: true }, 1 / 120);
  T('3 マスの壁は跳び越せない', h.x < 10, 'x=' + h.x.toFixed(2));
  const w2 = new World(flat([[0, 0, 40, 2], [10, 2, 2, 2]]));
  h = newHero(flat([]), { x: 5, y: 2 }); let landedOn = false;
  for (let i = 0; i < 600; i++) { stepHero(w2, h, { right: true, jumpPressed: h.ground && h.x > 8.2 && h.x < 9.5, jumpHeld: true }, 1 / 120); if (h.ground && h.x > 10 && h.x < 12 && h.y > 3.99) landedOn = true; }
  T('2 マスの段には跳び乗れる', landedOn);
})();

// --- 折りのルール ---
(function () {
  // 板：x=7 から穴 8 マス（7..14）、向こう岸 15..24
  let L = mk(l => { LB.run(l, 7); LB.plank(l, 8, 10); LB.run(l, 4); });
  let w = new World(L);
  w.mask = 1;
  let ok = true; for (let cx = 7; cx <= 14; cx++) if (!w.solid(cx, 1)) ok = false;
  T('板を折ると穴（7〜14）にかかり、元の位置（15〜22 の行1）は空になる', ok && !w.solid(15, 1) && !w.solid(22, 1) && w.solid(15, 0));
  w.mask = 0;
  T('近づくと折れる／遠いと折れない', canFold(w, 0, 6.5, 2).ok && !canFold(w, 0, 0.5, 2).ok);
  T('耳の反対側（向こう岸）からは折れない', !canFold(w, 0, 17, 2).ok);
  // 板の上で戻すと、板ごと向こう岸へ運ばれる
  w.mask = 1;
  const u = canUnfold(w, 0, 10.5, 2);
  T('板の上で戻すと向こう岸へ運ばれる', u.ok && u.carried && Math.abs(u.nx - 19.5) < 1e-6, JSON.stringify(u));
  const u2 = canUnfold(w, 0, 5, 2);
  T('手前の地面で戻しても動かない', u2.ok && !u2.carried && u2.nx === 5);
  w.mask = 0;

  // 壁の段：折り先に体が重なるときは、持ち上げて紙の上に乗せる
  L = mk(l => { LB.run(l, 8); LB.wallStep(l); LB.run(l, 4); });
  w = new World(L);
  const f = canFold(w, 0, 6.5, 2);   // 段が降りる位置（6〜7, 行2）に立っている
  T('折り先に立っていても折れる（紙の上に持ち上げられる）', f.ok && f.y === 3 && f.x === 6.5, JSON.stringify(f));
  w.mask = 1;
  T('折ると段（6〜7, 行2）ができる', w.solid(6, 2) && w.solid(7, 2) && !w.solid(8, 2) && w.solid(8, 3));

  // 次の折りを折るとき、前の折りが自動で戻る
  L = mk(l => { LB.run(l, 7); LB.plank(l, 8, 10); LB.run(l, 2); LB.plate(l, 6); LB.run(l, 3); });
  w = new World(L);
  w.mask = 1;
  const direct = canFold(w, 1, 24.5, 2);
  T('前の折りが残っていると、そのままでは折れない（max）', !direct.ok && direct.why === 'max');
  const plan = planFold(w, 1, 24.5, 2, [0]);
  T('自動で前の折りを戻して、次を折れる', plan.ok && plan.unfold === 0, JSON.stringify(plan));
  w.mask = 1;
  const plan2 = planFold(w, 1, 10.5, 2, [0]);   // 板の上（戻すと運ばれる）では自動で戻さない
  T('板の上にいて戻すと運ばれてしまうときは、自動切り替えをしない', !plan2.ok, JSON.stringify(plan2));

  // トゲ：かぶせると働かない
  L = mk(l => { LB.run(l, 7); LB.plate(l, 6); LB.run(l, 3); });
  w = new World(L);
  const sp = w.spikes[0];
  T('トゲは折っていないとき働く', w.spikeCell(sp, 0) !== null);
  T('板をかぶせるとトゲは働かない', w.spikeCell(sp, 1) === null);
  T('トゲの上に立つと当たる', (() => { w.mask = 0; return hitsSpike(w, newHero(L, { x: 8.5, y: 2 })); })());
  T('板の上に立ってもトゲに当たらない', (() => { w.mask = 1; return !hitsSpike(w, newHero(L, { x: 8.5, y: 3 })); })());
})();

// --- 裏面・横の折り目・二重折り ---
(function () {
  let L = mk(l => { LB.run(l, 7); LB.plankBackHigh(l, 8, 10); LB.run(l, 4); });
  let w = new World(L);
  T('裏面の板は折る前は存在しない', !w.solid(7, 2) && !w.solid(15, 2));
  w.mask = 1;
  let ok = true; for (let cx = 7; cx <= 14; cx++) if (!w.solid(cx, 2)) ok = false;
  T('折ると裏面の板（上面 3）が穴にかかる', ok);
  T('裏面の板の上で戻そうとすると「足場がない」で戻せない', (() => { const u = canUnfold(w, 0, 10.5, 3); return !u.ok && u.why === 'void'; })());

  L = mk(l => { LB.run(l, 7); LB.cliffY(l, 4, 6); LB.run(l, 4); });
  w = new World(L);
  T('崖の高さが 6 のとき、折らないと越えられない', !solve(w, L, { allowFold: false }).solvable);
  w.mask = 1;
  T('横に折ると崖の上（行4〜5）が下へ折り返り、上面が 4 になる', !w.solid(8, 4) && !w.solid(8, 5) && w.solid(8, 3) && w.solid(8, 2));
  w.mask = 0;
  T('横の折りは、耳の下から折る（上にいると折れない）', canFold(w, 0, 5, 2).ok && !canFold(w, 0, 8, 6).ok);

  L = mk(l => { LB.run(l, 7); LB.stairsY(l, 2, 8, 7); }, {});
  w = new World(L);
  w.mask = 1;
  T('階段が下りてくる（行3 と 行5）', w.solid(7, 3) && w.solid(9, 5) && !w.solid(7, 12) && !w.solid(9, 10));
  const hh = canUnfold(w, 0, 7.5, 4);
  T('階段の上で戻すと、階段が上がって落ちる（戻せる）', hh.ok && !hh.carried, JSON.stringify(hh));

  // 二重折り
  L = mk(l => { LB.run(l, 7); LB.doubleBridge(l, 12, 14); LB.run(l, 4); }, { maxFolds: 2 });
  w = new World(L);
  w.mask = 1;
  T('裏の板を折ってから、表の板も折れる', canFold(w, 1, 12.5, 2).ok);
  w.mask = 3;
  ok = true; for (let cx = 7; cx <= 18; cx++) if (!w.solid(cx, 1)) ok = false;
  T('2 枚とも折ると穴（7〜18）が全部ふさがる', ok);
  const w1 = new World(Object.assign({}, L, { maxFolds: 1 }));
  w1.mask = 1;
  T('1 か所しか折れない面では、2 つ目は折れない', canFold(w1, 1, 12.5, 2).why === 'max');
  // 乗って折る
  L = mk(l => { LB.run(l, 7); LB.ride(l, 6, 8); }, {});
  w = new World(L);
  const rd = canFold(w, 0, 7.5, 2);
  T('板の上に乗って折ると、向こう側の端（x=18.5）へ運ばれる', rd.ok && rd.carried && Math.abs(rd.x - 18.5) < 1e-6, JSON.stringify(rd));
  T('板に乗らずに手前の地面からは折れない', !canFold(w, 0, 5, 2).ok);
  T('向こう側（ゴール側）へ着いたら、乗った板は元に戻せる', (() => { w.mask = 1; const u = canUnfold(w, 0, 18.5, 2); return u.ok && u.carried; })());
  w.mask = 0;
  // 乗って折った板の上では、前の折りを自動で戻せない（二重折りが必要）
  L = mk(l => { LB.run(l, 7); LB.rideChain(l, 10); }, { maxFolds: 1 });
  w = new World(L);
  w.mask = 1;
  const pl = planFold(w, 1, 16.5, 2, [0]);
  T('1 か所しか折れない面では、乗って折った板の上から次の板を折れない', !pl.ok, JSON.stringify(pl));
  T('全 11 ステージ（3×3 + 最終 + ひみつ）', LEVELS.length === 11, 'n=' + LEVELS.length);
  T('大きな欠片は 1-3, 2-3, 3-3 のゴールにある', LEVELS.filter(l => l.big).map(l => l.id).join() === '1-3,2-3,3-3');
})();

// --- 全ステージの到達検証 ---
for (const lv of LEVELS) {
  const w = new World(lv);
  const a = solve(w, lv), b = solve(w, lv, { allowFold: false, maxGap: 5 });
  T(lv.id + ' 折らないとゴールに着けない（幅 ' + lv.w + '）', !b.solvable);
  T(lv.id + ' 折ればゴールに着ける', a.solvable, '');
  if (a.solvable) T(lv.id + ' 解答の折り: ' + a.folds + ' 回', a.folds >= 3);
  lv.shards.forEach((s, i) => {
    const r = solve(w, lv, { goalFn: shardGoal(w, w.shards[i]) });
    T(lv.id + ' 欠片 ' + (i + 1) + ' に届く' + (s.back !== undefined ? '（裏面）' : ''), r.solvable);
  });
  lv.flags.forEach((f, i) => {
    const r = solve(w, lv, { goalFn: (aa, cx, y) => Math.abs(cx + 0.5 - f.x) <= 1 && y === f.y });
    T(lv.id + ' 旗 ' + (i + 1) + ' に届く', r.solvable);
  });
  // どの折り目も、使わないと通れない（折らずに抜けられる所がない）
  let allNeeded = true; const which = [];
  lv.folds.forEach((_, k) => {
    const lv2 = Object.assign({}, lv, { folds: lv.folds.filter((__, i) => i !== k), shards: [] });
    if (solve(new World(lv2), lv2, { maxGap: 5 }).solvable) { allNeeded = false; which.push(k); }
  });
  T(lv.id + ' どの折り目も必要（使わずに通れる所がない）', allNeeded, '不要な折り目: ' + which.join(','));
  if (lv.maxFolds === 2) {
    const w1 = new World(Object.assign({}, lv, { maxFolds: 1 }));
    T(lv.id + ' 二重折りが必要（1 か所だけでは着けない）', !solve(w1, lv).solvable);
  }
}

// --- 実際の物理で通しで遊ぶボット（解答の経路をたどる） ---
function runBot(lv) {
  const w = new World(lv);
  const r = solve(w, lv);
  if (!r.solvable) return { ok: false, why: 'unsolvable' };
  const h = newHero(lv), dt = 1 / 120;
  const log = [];
  let ni = 1, nodeT = 0, t = 0;
  while (ni < r.nodes.length && t < 300) {
    const nd = r.nodes[ni];
    if (nd.kind === 'fold' || nd.kind === 'unfold') {
      const ccx = r.nodes[ni - 1].cx + 0.5;   // 立っているマスの中央に寄ってから折る
      if (!h.ground || Math.abs(h.x - ccx) > 0.15) {
        const dd = ccx - h.x;
        stepHero(w, h, h.ground ? { left: dd < 0, right: dd > 0 } : {}, dt); t += dt; nodeT += dt;
        if (nodeT > 6) return { ok: false, why: 'not ready for ' + nd.kind + ' x=' + h.x.toFixed(2), log };
        continue;
      }
      if (nd.kind === 'fold') {
        const c = canFold(w, nd.i, h.x, h.y);
        if (!c.ok) return { ok: false, why: 'cannot fold ' + nd.i + ' (' + c.why + ') x=' + h.x.toFixed(2), log };
        w.mask |= 1 << nd.i; h.x = c.x; h.y = c.y; log.push('fold' + nd.i + '@' + h.x.toFixed(1));
      } else {
        const c = canUnfold(w, nd.i, h.x, h.y);
        if (!c.ok) return { ok: false, why: 'cannot unfold (' + c.why + ') x=' + h.x.toFixed(2), log };
        w.mask &= ~(1 << nd.i); h.x = c.nx; h.y = c.y; log.push('unfold@' + h.x.toFixed(1));
      }
      h.vx = 0; h.vy = 0; ni++; nodeT = 0; continue;
    }
    // 歩き・ジャンプ
    const tx = nd.cx + 0.5;
    if (h.ground && Math.floor(h.x) === nd.cx && Math.abs(h.y - nd.y) < 0.05 && w.mask === nd.m) { ni++; nodeT = 0; continue; }
    const dx = tx - h.x, dir = Math.abs(dx) < 0.12 ? 0 : Math.sign(dx);
    let jump = false;
    if (h.ground && dir !== 0) {
      const ahead = Math.floor(h.x + dir * 0.7), fr = Math.floor(h.y), sup = Math.floor(h.y - 0.05);
      if (w.solid(ahead, fr) || w.solid(ahead, fr + 1)) jump = true;                       // 壁
      if (!w.solid(ahead, sup) && !w.solid(ahead, sup - 1)) jump = true;                   // 穴
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
