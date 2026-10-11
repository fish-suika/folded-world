"use strict";
// ===== 調整用の数値（ここだけ触れば遊び心地が変わる） =====
// 長さの単位は「マス目 1 つ = 1」。x は右、y は上。マス (cx,cy) は [cx,cx+1]×[cy,cy+1]。
const CFG = {
  hero: {
    hw: 0.32,        // 体の半分の幅
    h: 1.5,          // 体の高さ（足元が y）
    speed: 6.4,      // 走る速さ（マス/秒）
    accelG: 70,      // 地上の加速
    accelA: 42,      // 空中の加速（空中制御）
    frictionG: 80,   // 地上で止まる強さ
    gravity: 38,
    jumpV: 14.2,     // ジャンプの初速。最高到達 = jumpV^2/(2g) ≒ 2.65 マス
    cutV: 0.45,      // ジャンプボタンを離したときの上昇の減衰
    maxFall: 26,
    coyote: 0.09,    // 足場を離れても跳べる猶予
    buffer: 0.12,    // 着地前の先行入力
    deathY: -6,      // これより下に落ちたらやり直し
  },
  fold: {
    near: 9.5,       // 折り目からこの距離（マス）以内で「折る」が効く
    dur: 0.62,       // 折るアニメーションの長さ（この間は主人公も止まる）
    shakeDur: 0.4,   // 折れないときの震え
    lift: 3,         // 折り先に体が重なったとき、上へ持ち上げられる最大の高さ
    push: 0,         // 横への押し出しは使わない（壁越しにワープしてしまうため）
  },
  item: {
    shardR: 1.0,     // 小さな欠片を取れる距離（体の中心から）
    flagR: 1.1,      // 旗に触れる距離
    spikeH: 0.55,    // トゲの高さ（マスの下から）
  },
  solver: { stepUp: 2, maxGap: 4 },   // 検証用の「届く」判定（実物のジャンプ 約4.8マス・2.65マスより控えめ）
  cam: { fov: 36, dist: 21, smooth: 6, minY: 5.2 },
};

// ===== ステージの部品 =====
// 地面は行 0〜1（上面 y=2）。L.cur が「いま置いている x」。部品を順に並べるとステージになる。
// folds: 折り目。縦の折り目 {f, w, dir, y0, y1}（折り目 f の縦線で、幅 w・高さ y0〜y1 の耳を右(dir=+1)か左に持つ。耳は x → 2f-1-x へ）
//        横の折り目 {axis:'y', f, h, dir, x0, x1}（折り目の高さ f の線で、x0〜x1 の耳を上(dir=+1)に高さ h。行 y → 2f-1-y へ）
//        back: 耳の「裏面」にだけある足場（[x, y, 幅, 高さ]、元の位置の座標）。折って裏返ったときだけ現れる。
const LB = {
  make(id, name, hint, world, theme, opts = {}) {
    return Object.assign({ id, name, hint, world, theme, w: 0, h: 14, cur: 0, start: { x: 2.5, y: 2 }, rects: [], folds: [], spikes: [], flags: [], shards: [] }, opts);
  },
  run(L, n) { L.rects.push([L.cur, 0, n, 2]); L.cur += n; },
  pit(L, n) { L.cur += n; },
  flag(L) { L.flags.push({ x: L.cur - 1.5, y: 2 }); },
  shard(L, x, y, back) { L.shards.push(back === undefined ? { x, y } : { x, y, back }); },
  // 小さな足場を、間をあけて並べる（間は落ちる）。ジャンプの正確さ
  hop(L, n, gap, w = 2) {
    for (let i = 0; i < n; i++) { L.rects.push([L.cur, 0, w, 2]); L.cur += w; if (i < n - 1) L.cur += gap; }
  },
  // 低い壁。足元の 1 段を折って、小さな段を作る
  wallStep(L) {
    const x = L.cur; LB.run(L, 2);
    L.rects.push([x, 2, 2, 3]); L.folds.push({ f: x, w: 2, dir: 1, y0: 2, y1: 3 });
    LB.run(L, 6);   // 次の障害物までの距離（段の上から跳び移れないように）
  },
  // 高い崖（上面 6）。足元の 2 段を折って階段にする
  cliffStep(L) {
    const x = L.cur; LB.run(L, 4);
    L.rects.push([x, 2, 4, 4]); L.folds.push({ f: x, w: 2, dir: 1, y0: 2, y1: 4 });
    LB.run(L, 6);
  },
  // 穴（幅 g）。向こう岸の地面の表面を板にして、穴にかぶせる
  plank(L, g, after) {
    LB.pit(L, g); const x = L.cur; LB.run(L, after);
    L.folds.push({ f: x, w: g, dir: 1, y0: 1, y1: 2 });
  },
  // 穴（幅 g）。裏面にだけある板（折るまで見えない。上面が 3 になる）
  plankBackHigh(L, g, after) {
    LB.pit(L, g); const x = L.cur; LB.run(L, after);
    L.folds.push({ f: x, w: g, dir: 1, y0: 2, y1: 3, back: [[x, 2, g, 1]] });
  },
  // 広い穴（幅 g）。手前の半分は裏の板、向こうの半分は表の板（二重折り）
  doubleBridge(L, g, after) {
    const h = g / 2;
    LB.pit(L, g); const x = L.cur; LB.run(L, after);
    L.folds.push({ f: x - h, w: h, dir: 1, y0: 1, y1: 2, back: [[x - h, 1, h, 1]] });   // 裏の板（穴の中ほどが折り目）
    L.folds.push({ f: x, w: h, dir: 1, y0: 1, y1: 2 });
  },
  // トゲ（幅 n）と、その右の出っ張り。折ってトゲにかぶせる
  plate(L, n) {
    const x = L.cur; LB.run(L, 2 * n);
    L.spikes.push([x, 2, n]); L.rects.push([x + n, 2, n, 1]); L.folds.push({ f: x + n, w: n, dir: 1, y0: 2, y1: 3 });
    LB.run(L, 6);
  },
  // 高い崖（上面 top）。横の折り目で上を折り下ろすと、上面が 4 になる
  cliffY(L, w, top) {
    const x = L.cur; LB.run(L, w);
    L.rects.push([x, 2, w, top - 2]); L.folds.push({ axis: 'y', f: 4, h: top - 4, dir: 1, x0: x, x1: x + w });
    LB.run(L, 6);
  },
  // 空中の足場（2マス幅×n 段）を折り下ろして階段にし、高い床（幅 gW、行 gRow）へ
  stairsY(L, n, gW, gRow) {
    const x = L.cur; LB.run(L, 2 * n); LB.pit(L, gW);   // 床の下は穴（階段を使わないと通れない）
    for (let i = 0; i < n; i++) L.rects.push([x + 2 * i, 12 - 2 * i, 2, 1]);
    L.folds.push({ axis: 'y', f: 8, h: 5, dir: 1, x0: x, x1: x + 2 * n });
    L.rects.push([x + 2 * n, gRow, gW, 1]);
  },
  // 階段（3 段）の先の床に、塔。塔の上を折り下ろして低くし、先の床（上面 10）へ
  stairsTower(L) {
    const x = L.cur; LB.run(L, 6); LB.pit(L, 11 + 10);
    for (let i = 0; i < 3; i++) L.rects.push([x + 2 * i, 12 - 2 * i, 2, 1]);
    L.folds.push({ axis: 'y', f: 8, h: 5, dir: 1, x0: x, x1: x + 6 });
    L.rects.push([x + 6, 7, 11, 1]);
    L.rects.push([x + 15, 8, 2, 5]);
    L.folds.push({ axis: 'y', f: 10, h: 3, dir: 1, x0: x + 15, x1: x + 17 });
    L.rects.push([x + 17, 9, 10, 1]);
    L.towerX = x;
  },
  // 裏面の階段（縦の折り目）と、高い床
  backStairsX(L, gW) {
    const x = L.cur; LB.run(L, gW);
    L.folds.push({ f: x, w: 4, dir: 1, y0: 3, y1: 7, back: [[x + 2, 3, 2, 1], [x, 5, 2, 1]] });
    L.rects.push([x, 7, gW, 1]);
  },
  // 穴（幅 8）の上に、裏面のアーチ
  backArch(L, after) {
    LB.pit(L, 8); const x = L.cur; LB.run(L, after);
    L.folds.push({ f: x, w: 8, dir: 1, y0: 3, y1: 6, back: [[x + 6, 3, 2, 1], [x + 4, 5, 2, 1], [x + 2, 5, 2, 1], [x, 3, 2, 1]] });
  },
  // 穴（幅 7）と、向こうの崖。板と階段を同時に折る（二重折り）
  bridgeStairs(L, after) {
    LB.pit(L, 7); const x = L.cur; LB.run(L, after);
    L.rects.push([x + 2, 2, 5, 4]);
    L.folds.push({ f: x, w: 7, dir: 1, y0: 1, y1: 2 });
    L.rects.push([x - 2, 12, 2, 1], [x, 10, 2, 1]);
    L.folds.push({ axis: 'y', f: 8, h: 5, dir: 1, x0: x - 2, x1: x + 2 });
  },
  // 乗って折る：穴（幅 2w）の手前の半分に、地面から張り出した板。板の上に乗って折ると、板ごとひっくり返って
  // 向こうの半分にかかり、主人公は向こう側の端へ運ばれる
  ride(L, w, after) {
    const x0 = L.cur;
    L.rects.push([x0, 1, w, 1]);
    L.folds.push({ f: x0 + w, w, dir: -1, y0: 1, y1: 2, ride: true });
    L.cur = x0 + 2 * w; LB.run(L, after);
  },
  // 乗って折ったあとも、板の上に乗ったまま次の板を折る（二重折り）。間は 3 マス跳ぶ
  rideChain(L, after) {
    const x0 = L.cur;
    L.rects.push([x0, 1, 5, 1]);
    L.folds.push({ f: x0 + 5, w: 5, dir: -1, y0: 1, y1: 2, ride: true });
    L.cur = x0 + 18; LB.run(L, after);
    L.folds.push({ f: x0 + 18, w: 5, dir: 1, y0: 1, y1: 2 });
  },
  // 乗って折った板の上で、そのまま階段を折って崖を登る（二重折り）
  rideStairs(L, after) {
    const x0 = L.cur;
    L.rects.push([x0, 1, 6, 1]);
    L.folds.push({ f: x0 + 6, w: 6, dir: -1, y0: 1, y1: 2, ride: true });
    L.cur = x0 + 14; LB.run(L, after);
    L.rects.push([x0 + 14, 2, 5, 4]);
    L.rects.push([x0 + 10, 12, 2, 1], [x0 + 12, 10, 2, 1]);
    L.folds.push({ axis: 'y', f: 8, h: 5, dir: 1, x0: x0 + 10, x1: x0 + 14 });
  },
  goal(L, y = 2) { L.goal = { x: L.cur - 2.5, y }; L.w = L.cur; },
};

// ===== ステージ =====
const LEVELS = [];
(function () {
  let L, a, b;
  const done = lv => { LB.goal(lv); LEVELS.push(lv); };

  // 1-1 はじめの紙：縦の折り目の基本。壁の足元、板、トゲの板、崖
  L = LB.make('1-1', 'はじめの紙', '折ると、遠くの紙が手前に来る', 1, 'meadow');
  LB.run(L, 7);
  LB.wallStep(L); LB.run(L, 5);
  a = L.cur; LB.hop(L, 3, 3); LB.shard(L, a + 4, 4);
  LB.run(L, 4); LB.flag(L);
  a = L.cur; LB.plank(L, 8, 10); LB.shard(L, a + 4, 4);
  LB.run(L, 2); LB.flag(L);
  LB.plate(L, 6); LB.run(L, 4); LB.flag(L);
  a = L.cur; LB.cliffStep(L); LB.shard(L, a + 2, 8); LB.run(L, 3);
  LB.hop(L, 3, 3); LB.run(L, 3); LB.flag(L);
  LB.plank(L, 7, 9); LB.run(L, 6);
  done(L);

  // 1-2 紙のうら：裏面にだけある足場。そして「乗って折る」
  L = LB.make('1-2', '紙のうら', '折ると、裏にだけある足場が現れる', 1, 'meadow');
  LB.run(L, 7);
  a = L.cur; LB.plankBackHigh(L, 8, 10); LB.shard(L, a + 4, 3, 0);
  LB.run(L, 2); LB.flag(L);
  LB.plate(L, 7); LB.run(L, 3); LB.shard(L, L.cur - 10, 5);
  LB.hop(L, 4, 3); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.ride(L, 6, 10); LB.shard(L, a + 6, 4); LB.run(L, 3); LB.flag(L);
  LB.plate(L, 6); LB.run(L, 4); LB.flag(L);
  a = L.cur; LB.backStairsX(L, 10);
  LB.run(L, 4);
  L.goal = { x: a + 8.5, y: 8 }; L.w = L.cur;
  LEVELS.push(L);

  // 1-3 折り重ねる：裏面のアーチと総まとめ。最後は「乗って折って」ゴールへ（ワールド1の最後：大きな欠片＝横の折り目）
  L = LB.make('1-3', '折り重ねる', '橋・板・階段を、順番に折っていく', 1, 'meadow', { big: 'yfold' });
  LB.run(L, 7);
  a = L.cur; LB.backArch(L, 10); LB.shard(L, a + 3, 7);
  LB.run(L, 2); LB.flag(L);
  LB.plate(L, 7); LB.run(L, 3);
  LB.wallStep(L); LB.run(L, 4);
  a = L.cur; LB.hop(L, 4, 3); LB.shard(L, a + 7, 4);
  LB.run(L, 3); LB.flag(L);
  LB.plank(L, 8, 10); LB.run(L, 2);
  LB.cliffStep(L); LB.run(L, 3); LB.flag(L);
  LB.plate(L, 8); LB.run(L, 4); LB.flag(L);
  LB.hop(L, 3, 3); LB.shard(L, L.cur - 5, 4); LB.run(L, 4); LB.flag(L);
  LB.ride(L, 7, 8);
  done(L);

  // 2-1 たかさを折る：横の折り目
  L = LB.make('2-1', 'たかさを折る', '横の折り目で、崖を低くする・高い足場を下ろす', 2, 'sunset');
  LB.run(L, 7);
  a = L.cur; LB.cliffY(L, 4, 6); LB.shard(L, a + 1, 6);
  LB.run(L, 4); LB.flag(L);
  LB.hop(L, 4, 3); LB.run(L, 3);
  LB.cliffY(L, 3, 8); LB.run(L, 4); LB.flag(L);
  LB.plate(L, 6); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.plank(L, 8, 10); LB.shard(L, a + 4, 4); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.stairsY(L, 2, 12, 7); LB.shard(L, a + 8, 10);
  L.goal = { x: a + 14.5, y: 8 }; L.w = L.cur;
  LEVELS.push(L);

  // 2-2 がけと穴：縦と横の折りを、順番に。乗って折る板も
  L = LB.make('2-2', 'がけと穴', '縦と横の折りを、順番に', 2, 'sunset');
  LB.run(L, 6);
  LB.plank(L, 8, 10); LB.run(L, 2);
  LB.cliffY(L, 3, 9); LB.run(L, 3); LB.flag(L);
  LB.plate(L, 7); LB.run(L, 3);
  LB.hop(L, 4, 3); LB.shard(L, L.cur - 5, 4); LB.run(L, 3); LB.flag(L);
  LB.cliffStep(L); LB.run(L, 3);
  LB.cliffY(L, 4, 7); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.ride(L, 6, 10); LB.shard(L, a + 6, 4); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.plankBackHigh(L, 8, 10); LB.shard(L, a + 4, 3, 6); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.stairsY(L, 2, 12, 7); LB.shard(L, a + 8, 10);
  L.goal = { x: a + 14.5, y: 8 }; L.w = L.cur;
  LEVELS.push(L);

  // 2-3 さかさの塔（ワールド2の最後：大きな欠片＝二重折り）。乗って折ってゴールへ
  L = LB.make('2-3', 'さかさの塔', '板と階段で空へ。最後の塔を低くする', 2, 'sunset', { big: 'double' });
  LB.run(L, 6);
  a = L.cur; LB.plank(L, 8, 10); LB.shard(L, a + 4, 4); LB.run(L, 2); LB.flag(L);
  LB.plate(L, 8); LB.run(L, 3);
  LB.cliffY(L, 4, 7); LB.run(L, 3); LB.flag(L);
  LB.hop(L, 4, 3); LB.run(L, 3);
  LB.stairsY(L, 2, 12, 7); LB.run(L, 3); LB.flag(L);
  LB.plank(L, 7, 9); LB.run(L, 4); LB.flag(L);
  LB.stairsTower(L);
  L.spikes.push([L.towerX + 9, 8, 2]);
  L.flags.push({ x: L.towerX + 7.5, y: 8 }, { x: L.towerX + 19.5, y: 10 });
  LB.shard(L, L.towerX + 3, 8); LB.shard(L, L.towerX + 22, 12);
  LB.run(L, 4); LB.flag(L);
  LB.ride(L, 7, 8);
  done(L);

  // 3-1 ふたつ同時：二重折り。乗ったまま次を折る
  L = LB.make('3-1', 'ふたつ同時', '2か所を同時に折る。乗ったまま、次を折る', 3, 'night', { maxFolds: 2 });
  LB.run(L, 7);
  a = L.cur; LB.doubleBridge(L, 12, 14); LB.shard(L, a + 3, 4); LB.shard(L, a + 9, 4);
  LB.run(L, 2); LB.flag(L);
  LB.plate(L, 7); LB.run(L, 3);
  LB.hop(L, 4, 3); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.rideChain(L, 10); LB.shard(L, a + 10, 4); LB.run(L, 3); LB.flag(L);
  LB.plate(L, 6); LB.run(L, 4);
  LB.shard(L, L.cur - 6, 4);
  done(L);

  // 3-2 橋と階段：板の上で階段を折る。乗って折った板の上で階段を折る
  L = LB.make('3-2', '橋と階段', '板や階段を、乗ったまま折る', 3, 'night', { maxFolds: 2 });
  LB.run(L, 7);
  a = L.cur; LB.bridgeStairs(L, 14); LB.shard(L, a + 1, 4); LB.shard(L, a + 6, 7);
  LB.run(L, 2); LB.flag(L);
  LB.plate(L, 7); LB.run(L, 3);
  LB.hop(L, 3, 3); LB.shard(L, L.cur - 5, 4); LB.run(L, 3); LB.flag(L);
  LB.rideStairs(L, 12); LB.run(L, 4); LB.flag(L);
  LB.plankBackHigh(L, 8, 10); LB.run(L, 3);
  LB.cliffY(L, 4, 7); LB.run(L, 5);
  done(L);

  // 3-3 みっつの橋（ワールド3の最後：大きな欠片）
  L = LB.make('3-3', 'みっつの橋', '二重の橋、トゲの板、橋と階段', 3, 'night', { maxFolds: 2, big: 'final' });
  LB.run(L, 6);
  a = L.cur; LB.doubleBridge(L, 12, 14); LB.shard(L, a + 6, 4);
  LB.run(L, 2); LB.flag(L);
  LB.plate(L, 8); LB.run(L, 3); LB.flag(L);
  LB.rideChain(L, 10); LB.run(L, 3);
  LB.hop(L, 4, 3); LB.run(L, 3); LB.flag(L);
  LB.cliffStep(L); LB.run(L, 3);
  LB.plate(L, 7); LB.run(L, 4); LB.flag(L);
  LB.bridgeStairs(L, 14); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.rideStairs(L, 12); LB.shard(L, a + 11, 7); LB.run(L, 4);
  LB.hop(L, 4, 3); LB.shard(L, L.cur - 5, 4); LB.run(L, 4); LB.flag(L);
  LB.ride(L, 7, 8);
  done(L);

  // 4 おりたたまれた世界（最終ステージ）
  L = LB.make('4', 'おりたたまれた世界', 'これまでの折りを、すべて使って', 4, 'night', { maxFolds: 2, final: true });
  LB.run(L, 6);
  a = L.cur; LB.doubleBridge(L, 12, 14); LB.shard(L, a + 6, 4);
  LB.run(L, 2); LB.flag(L);
  LB.cliffY(L, 4, 8); LB.run(L, 3);
  LB.plate(L, 8); LB.run(L, 3); LB.flag(L);
  LB.hop(L, 5, 3); LB.run(L, 3);
  LB.rideChain(L, 10); LB.run(L, 3); LB.flag(L);
  LB.cliffStep(L); LB.run(L, 3);
  LB.bridgeStairs(L, 14); LB.run(L, 3); LB.flag(L);
  LB.plankBackHigh(L, 8, 10); LB.run(L, 3);
  LB.backArch(L, 10); LB.run(L, 3); LB.flag(L);
  LB.rideStairs(L, 12); LB.run(L, 3);
  LB.plate(L, 8); LB.run(L, 3);
  LB.hop(L, 4, 3); LB.shard(L, L.cur - 5, 4); LB.run(L, 3); LB.flag(L);
  LB.stairsTower(L);
  L.spikes.push([L.towerX + 9, 8, 2]);
  L.flags.push({ x: L.towerX + 7.5, y: 8 }, { x: L.towerX + 19.5, y: 10 });
  LB.shard(L, L.towerX + 22, 12);
  LB.run(L, 4); LB.flag(L);
  LB.ride(L, 7, 8);
  done(L);

  // H ひみつの紙（小さな欠片を 20 個集めると開く）
  L = LB.make('H', 'ひみつの紙', '小さな欠片をたくさん集めた人だけの、おまけ', 5, 'secret', { maxFolds: 2, needShards: 20 });
  LB.run(L, 6);
  a = L.cur; LB.rideChain(L, 10); LB.shard(L, a + 10, 4);
  LB.run(L, 3); LB.flag(L);
  LB.plate(L, 8); LB.run(L, 3);
  LB.hop(L, 5, 3); LB.shard(L, L.cur - 8, 4); LB.run(L, 3); LB.flag(L);
  LB.cliffY(L, 3, 9); LB.run(L, 3);
  LB.wallStep(L); LB.run(L, 3); LB.flag(L);
  a = L.cur; LB.stairsY(L, 3, 8, 7); LB.shard(L, a + 10, 10);
  L.goal = { x: a + 12.5, y: 8 }; L.w = L.cur;
  LEVELS.push(L);
})();
