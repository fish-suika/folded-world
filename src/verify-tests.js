
// ===== 検証 =====
let pass = 0, fail = 0;
function T(name, ok, why) {
  const d = document.createElement('div');
  d.className = 'r ' + (ok ? 'ok' : 'ng');
  d.textContent = name + (ok || !why ? '' : '  — ' + why);
  document.getElementById('out').appendChild(d);
  ok ? pass++ : fail++;
}
const W0 = () => new World(LEVEL);

// --- 物理 ---
(function () {
  const w = new World({ w: 40, h: 14, start: { x: 2.5, y: 2 }, goal: { x: 0, y: 0 }, folds: [], rects: [[0, 0, 40, 2]] });
  const sim = (inp, steps, h) => { for (let i = 0; i < steps; i++) { stepHero(w, h, typeof inp === 'function' ? inp(i, h) : inp, 1 / 120); } return h; };
  // 平地で止まっていられる
  let h = newHero({ start: { x: 5, y: 2 } }); sim({}, 240, h);
  T('平地に立っていられる', h.ground && Math.abs(h.y - 2) < 1e-6, 'y=' + h.y);
  // ジャンプの高さ
  h = newHero({ start: { x: 5, y: 2 } }); let maxY = 0;
  sim((i, hh) => { maxY = Math.max(maxY, hh.y); return { jumpPressed: i === 0, jumpHeld: true }; }, 240, h);
  T('フルジャンプの高さ 2.4〜2.9 マス', maxY - 2 > 2.4 && maxY - 2 < 2.9, (maxY - 2).toFixed(2));
  // ジャンプの距離（走りながら）
  h = newHero({ start: { x: 5, y: 2 } }); let air = 0; const x0 = 5;
  sim((i, hh) => { if (!hh.ground) air++; return { right: true, jumpPressed: i === 0, jumpHeld: true }; }, 120, h);
  const dist = h.x - x0;
  T('走りジャンプで 4 マス以上の穴を越えられる', (() => { const hh = newHero({ start: { x: 5, y: 2 } }); let xl = 0, went = false;
    for (let i = 0; i < 400; i++) { stepHero(w, hh, { right: true, jumpPressed: i === 120, jumpHeld: true }, 1 / 120); if (i > 120 && hh.ground) { xl = hh.x; break; } }
    return (xl > 0); })(), '');
  // 3 マスの壁は越えられない
  const w3 = new World({ w: 40, h: 14, start: { x: 2.5, y: 2 }, goal: { x: 0, y: 0 }, folds: [], rects: [[0, 0, 40, 2], [10, 2, 2, 3]] });
  h = newHero({ start: { x: 5, y: 2 } });
  for (let i = 0; i < 1200; i++) {
    const near = h.x > 8.2;
    stepHero(w3, h, { right: true, jumpPressed: h.ground && near, jumpHeld: true }, 1 / 120);
  }
  T('3 マスの壁は跳び越せない', h.x < 10, 'x=' + h.x.toFixed(2));
  // 2 マスの段は跳び乗れる
  const w2 = new World({ w: 40, h: 14, start: { x: 2.5, y: 2 }, goal: { x: 0, y: 0 }, folds: [], rects: [[0, 0, 40, 2], [10, 2, 2, 2]] });
  h = newHero({ start: { x: 5, y: 2 } }); let peak = 0, landedOn = false;
  for (let i = 0; i < 600; i++) { stepHero(w2, h, { right: true, jumpPressed: h.ground && h.x > 8.2 && h.x < 9.5, jumpHeld: true }, 1 / 120); if (h.ground && h.x > 10 && h.x < 12 && h.y > 3.99) landedOn = true; }
  T('2 マスの段には跳び乗れる', landedOn, 'x=' + h.x.toFixed(2) + ' y=' + h.y.toFixed(2));
})();

// --- 折りのルール ---
(function () {
  const w = W0();
  // T1: 板が穴の上に来る（x 18..23, 行 1）
  w.active = 1;
  let ok = true; for (let cx = 18; cx <= 23; cx++) if (!w.solid(cx, 1)) ok = false;
  T('T1 を折ると板が穴（18〜23）に架かる', ok);
  T('T1 を折ると元の位置（24〜29 の行1）は空になる', !w.solid(24, 1) && !w.solid(29, 1) && w.solid(24, 0));
  T('T1 を折っても行0 は残る', w.solid(25, 0));
  w.active = 2;
  T('T2 を折ると崖の足元が手前（39〜40, 行2〜3）に来る', w.solid(39, 2) && w.solid(40, 3) && !w.solid(41, 2) && w.solid(41, 4));
  w.active = 0;
  T('T0 を折ると段（6〜7, 行2）ができる', w.solid(6, 2) && w.solid(7, 2) && !w.solid(8, 2) && w.solid(8, 3));
  w.active = -1;
  // 折れない：主人公が重なる
  T('T2: 段の位置に立っていると折れない', !canFold(w, 2, 39.6, 2).ok && canFold(w, 2, 39.6, 2).why === 'overlap');
  T('T2: 離れた位置からは折れる', canFold(w, 2, 36.5, 2).ok);
  T('T2: 崖の上（耳の反対側ではない）からは折れない', !canFold(w, 2, 43, 6).ok);
  T('T1: 遠すぎると折れない', !canFold(w, 1, 2.5, 2).ok && canFold(w, 1, 15.3, 2).ok);
  // 戻す：板の上にいると板ごと向こう岸へ運ばれる
  w.active = 1;
  const u = canUnfold(w, 20.5, 2);
  T('T1: 板の上で戻すと向こう岸（x=27.5）へ運ばれる', u.ok && u.carried && Math.abs(u.nx - 27.5) < 1e-6, JSON.stringify(u));
  const u2 = canUnfold(w, 12, 2);
  T('T1: 手前の地面で戻しても動かない', u2.ok && !u2.carried);
  w.active = 0;
  T('T0: 段の上からは壁が邪魔で戻せない', !canUnfold(w, 6.5, 3).ok);
  w.active = -1;
})();

// --- 到達検証 ---
(function () {
  const w = W0();
  const a = solve(w, LEVEL), b = solve(w, LEVEL, { allowFold: false });
  T('折らないとゴールに着けない', !b.solvable);
  T('折ればゴールに着ける', a.solvable, '');
  if (a.solvable) T('必要な折りは 4 回', a.folds === 4, 'folds=' + a.folds + ' [' + a.steps.join(', ') + ']');
})();

// --- 実際の物理で通しで遊ぶボット ---
(function () {
  const w = W0();
  let h = newHero(LEVEL), t = 0;
  const plan = [[0, 3.5], [1, 14.6], [2, 35.5], [3, 46.5]];   // [折り目, この x を超えたら折る]
  let pi = 0, log = [], foldN = 0, reached = false;
  for (let i = 0; i < 120 * 90; i++) {
    t = i / 120;
    // 折る・戻す（アニメーション中は止まる分を無視して即反映）
    if (pi < plan.length && h.ground && h.x >= plan[pi][1]) {
      const want = plan[pi][0];
      if (w.active >= 0) { const r = canUnfold(w, h.x, h.y); if (r.ok) { w.active = -1; if (r.carried) h.x = r.nx; log.push('unfold@' + h.x.toFixed(1)); } }
      else { const r = canFold(w, want, h.x, h.y); if (r.ok) { w.active = want; foldN++; pi++; log.push('fold' + want + '@' + h.x.toFixed(1)); } }
    }
    // 先を見て跳ぶ
    const ahead = Math.floor(h.x + 0.7), fr = Math.floor(h.y);
    let jump = false;
    if (h.ground) {
      if (w.solid(ahead, fr) || w.solid(ahead, fr + 1)) jump = true;
      const sup = Math.floor(h.y - 0.05);
      if (!w.solid(ahead, sup) && !w.solid(ahead + 1, sup)) jump = true;
    }
    const pending = pi < plan.length && h.x >= plan[pi][1];
    stepHero(w, h, { right: !pending, jumpPressed: jump, jumpHeld: jump || !h.ground }, 1 / 120);
    if (h.y < CFG.hero.deathY) { log.push('fell@' + h.x.toFixed(1)); break; }
    if (Math.abs(h.x - LEVEL.goal.x) < 0.9 && Math.abs(h.y - LEVEL.goal.y) < 1.2) { reached = true; break; }
  }
  T('ボットが実際の物理でゴールに着く（' + t.toFixed(1) + ' 秒）', reached, log.join(' ') + ' x=' + h.x.toFixed(1) + ' y=' + h.y.toFixed(1));
  T('ボットは 4 か所すべて折った', foldN === 4, 'foldN=' + foldN);
})();

document.getElementById('sum').textContent = `${pass} PASS / ${fail} FAIL`;
document.title = (fail ? 'FAIL ' : 'OK ') + pass + '/' + (pass + fail);
