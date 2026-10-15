// ===== ゲーム本体（状態・ループ・保存） =====
const SAVE_KEY = 'foldedWorld.save.v1';
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.stages) { s.abilities = s.abilities || {}; return s; } } catch (e) {}
  return { stages: {}, abilities: {} };
}
function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
let save = loadSave();

const WORLD_NAME = { 1: 'ワールド1', 2: 'ワールド2', 3: 'ワールド3', 4: '最終・ひみつ', 5: '最終・ひみつ' };
const ABILITY_TEXT = {
  yfold: '新しい能力「横の折り目」を手に入れた！<br>高い足場を折り下ろしたり、崖を低くできる。',
  double: '新しい能力「二重折り」を手に入れた！<br>2か所を同時に折れる。（U / Shift で戻す）',
  final: '最後の大きな欠片を手に入れた！<br>最終ステージが開いた。',
};
const totalShards = () => Object.values(save.stages).reduce((n, s) => n + s.shards.filter(Boolean).length, 0);
const cleared = id => !!(save.stages[id] && save.stages[id].clear);
function unlocked(lv) {
  if (lv.needShards) return totalShards() >= lv.needShards;
  if (lv.world === 2) return cleared('1-3');
  if (lv.world === 3) return cleared('2-3');
  if (lv.world === 4) return cleared('3-3');
  return true;
}

let stageIdx = 0, level = LEVELS[0], world = new World(level);
let hero = newHero(level);
let state = 'title';          // title | select | play | pause | clear | ending
let anims = [];              // 動いている折り（同時に 2 つ：前の折りを戻しながら次を折る）
                              // { i, fold, t, carried, x0, y0, x1, y1 }
let shake = null;             // { i, t }
let time = 0, clock = 0, foldCount = 0, squash = 0, candidate = -1;
let got = [], flagsHit = [], cp = null, deadT = 0, deaths = 0, foldStack = [];

GAME3D.init($('view'));

function resetRun() {
  world.mask = 0; anims = []; shake = null; deadT = 0; foldStack = [];
  hero = newHero(level);
  got = world.shards.map(() => false);
  flagsHit = world.flags.map(() => false);
  cp = null; time = 0; foldCount = 0; deaths = 0; hintFold = -1; hintedDeaths = false;
  GAME3D.snapCamera(hero.x, hero.y);
}
function loadStage(i) {
  stageIdx = i; level = LEVELS[i]; world = new World(level);
  GAME3D.load(world, level);
  resetRun();
  HUD.stage(level.id + '　' + level.name);
  document.body.classList.toggle('double', world.maxFolds > 1);
}
function enterPlay() { state = 'play'; HUD.show(null); HUD.playing(true); }
function startStage(i) { loadStage(i); enterPlay(); SND.bgm(level.theme); }

// あそびかた（はじめて遊ぶときは、ステージの前に見せる）
let helpFrom = 'scTitle', pendingStage = -1, hintFold = -1, hintT = 0, hintedDeaths = false;
function showHelp(from) { helpFrom = from; HUD.show('scHelp'); }
function openStage(i) {
  if (!save.seenHelp) { save.seenHelp = true; writeSave(save); pendingStage = i; showHelp('scSelect'); }
  else startStage(i);
}

function respawn() {   // 落ちる・トゲ → 最後に取った旗から。折りも旗を取った時点に戻す
  deaths++; SND.play('death');
  if (deaths >= 3 && !hintedDeaths) { hintedDeaths = true; setTimeout(() => HUD.toast(INPUT.touch ? 'ポーズの「ヒント」で、次の折り目が光るよ' : 'ポーズ（Esc）の「ヒント」で、次の折り目が光るよ'), 1700); }
  world.mask = cp ? cp.mask : 0;
  foldStack = cp ? cp.stack.slice() : [];
  anims = []; shake = null;
  hero = newHero(level, cp ? { x: cp.x, y: cp.y } : null);
  deadT = 0.35;
  GAME3D.snapCamera(hero.x, hero.y);
  HUD.toast(cp ? '旗から再開' : 'もういちど');
}

function pause(on) {
  if (state === 'play' && on !== false) { state = 'pause'; HUD.show('scPause'); }
  else if (state === 'pause' && on !== true) { state = 'play'; HUD.show(null); }
}
onPause = () => pause();
onRetry = () => { if (state === 'play' || state === 'pause') { resetRun(); enterPlay(); } };

// ---- ステージ選択 ----
function showSelect() {
  state = 'select'; HUD.playing(false);
  const box = $('cards'); box.innerHTML = '';
  [[1], [2], [3], [4, 5]].forEach(ws => {
    const wn = ws[0];
    const list = LEVELS.map((lv, i) => ({ lv, i })).filter(e => ws.includes(e.lv.world));
    if (!list.length) return;
    const row = document.createElement('div'); row.className = 'wrow';
    const lab = document.createElement('div'); lab.className = 'wlab'; lab.textContent = WORLD_NAME[wn];
    row.appendChild(lab);
    list.forEach(({ lv, i }) => {
      const sv = save.stages[lv.id];
      const ok = unlocked(lv);
      const b = document.createElement('button');
      b.className = 'card' + (sv && sv.clear ? ' done' : '') + (ok ? '' : ' lock');
      const n = sv ? sv.shards.filter(Boolean).length : 0;
      const stars = '◆'.repeat(n) + '◇'.repeat(lv.shards.length - n);
      let info = sv && sv.clear ? 'クリア　' + sv.best.toFixed(1) + ' 秒' : '未クリア';
      if (!ok) info = lv.needShards ? `小さな欠片 ${lv.needShards} 個で開く（いま ${totalShards()}）` : '前のワールドをクリアで開く';
      b.innerHTML = `<b>${lv.id}</b><span class="nm">${ok ? lv.name : '？？？'}</span><span class="st">${stars}</span><span class="ht">${info}</span>`;
      if (ok) b.addEventListener('click', () => { SND.play('click'); if (INPUT.touch) tryLandscape(); openStage(i); });
      row.appendChild(b);
    });
    box.appendChild(row);
  });
  HUD.show('scSelect');
}

$('btnStart').addEventListener('click', () => { SND.play('click'); if (INPUT.touch) tryLandscape(); showSelect(); });
$('btnHelp1').addEventListener('click', () => showHelp('scTitle'));
$('btnHelp2').addEventListener('click', () => showHelp('scPause'));
$('btnHelpBack').addEventListener('click', () => {
  if (pendingStage >= 0) { const i = pendingStage; pendingStage = -1; startStage(i); }
  else HUD.show(helpFrom);
});
$('btnHint').addEventListener('click', () => {
  const r = solve(world, level, { start: { cx: Math.floor(hero.x), y: Math.round(hero.y), mask: world.mask } });
  const n = r.solvable ? r.nodes.find(k => k.kind === 'fold' || k.kind === 'unfold') : null;
  pause(false);
  if (n) { hintFold = n.i; hintT = 6; HUD.toast(n.kind === 'fold' ? 'ヒント：光っている折り目を折ってみよう' : 'ヒント：光っている折り目を戻してみよう'); }
  else if (r.solvable) HUD.toast('ヒント：折らずに、そのまま進めるよ');
  else HUD.toast(INPUT.touch ? 'ここからは進めないかも。ポーズからやり直そう' : 'ここからは進めないかも。R でやり直そう');
});
const muteLabel = () => { $('bMute').textContent = SND.muted ? '♪ OFF' : '♪ ON'; };
onMute = () => { SND.toggleMute(); muteLabel(); };
$('bMute').addEventListener('click', () => onMute());
muteLabel();
$('btnResume').addEventListener('click', () => pause(false));
$('btnRetry').addEventListener('click', () => onRetry());
$('btnToSelect1').addEventListener('click', showSelect);
$('btnToSelect2').addEventListener('click', showSelect);
$('btnEndSel').addEventListener('click', showSelect);
$('btnAgain').addEventListener('click', () => startStage(stageIdx));
$('btnNext').addEventListener('click', () => {
  let n = stageIdx + 1;
  while (n < LEVELS.length && (!unlocked(LEVELS[n]) || LEVELS[n].needShards)) n++;
  startStage(n < LEVELS.length ? n : stageIdx);
});

const WHY = {
  overlap: '紙が重なって折れない', onTab: '乗っている紙は折れない', void: '戻すと足場がなくなる',
  compat: 'その折りとは同時に折れない', onLayer: '乗っている紙は戻せない', max: 'これ以上は同時に折れない',
};

function mkAnim(i, fold, r, carried) {
  return { i, fold, t: 0, carried: !!carried, x0: hero.x, y0: hero.y, x1: r.x !== undefined ? r.x : r.nx, y1: r.y };
}

// 次に折りたい折り目 j を、前の折りを自動で戻しながら折る
function startFold(j, plan) {
  SND.play('fold');
  if (plan.unfold >= 0) { anims.push(mkAnim(plan.unfold, false, { nx: hero.x, y: hero.y }, false)); }
  anims.push(mkAnim(j, true, plan.r, plan.r.carried));
  foldCount++;
}
function startUnfold(i) {
  const r = canUnfold(world, i, hero.x, hero.y);
  if (r.ok) { SND.play('unfold'); anims.push(mkAnim(i, false, r, r.carried)); return true; }
  SND.play('shake'); shake = { i, t: 0 }; HUD.toast(WHY[r.why] || '紙が重なって戻せない');
  return false;
}

// 折れる候補の中から、いちばん近いものを選ぶ（前の折りの自動切り替えも含む）
function bestPlan() {
  let best = null;
  for (let i = 0; i < world.folds.length; i++) {
    if (world.isOn(i)) continue;
    const p = planFold(world, i, hero.x, hero.y, foldStack);
    const d = hingeDist(world.folds[i], hero.x, hero.y);
    if (p.ok) { if (!best || d < best.d) best = { j: i, d, plan: p }; }
  }
  return best;
}

// F：いちばん近い折れる折り目を折る（前の折りは自動で戻す）。なければ、いちばん新しく折ったものを戻す。U / Shift：戻す
function tryFold() {
  if (anims.length || !hero.ground) return;
  const b = bestPlan();
  if (b) { startFold(b.j, b.plan); return; }
  if (foldStack.length) { startUnfold(foldStack[foldStack.length - 1]); return; }
}
function tryUnfold() {
  if (anims.length || !hero.ground || !foldStack.length) return;
  startUnfold(foldStack[foldStack.length - 1]);
}

function updateCandidate() {
  candidate = -1;
  if (anims.length) return;
  const b = bestPlan();
  if (b) { candidate = b.j; return; }
  if (foldStack.length) candidate = foldStack[foldStack.length - 1];
}

function collectItems() {
  const cx = hero.x, cy = hero.y + 0.75;
  world.shards.forEach((s, i) => {
    if (got[i]) return;
    const c = world.itemCell(s);
    if (!c) return;
    if (Math.hypot(c[0] + 0.5 - cx, c[1] + 0.5 - cy) < CFG.item.shardR) { got[i] = true; HUD.toast('小さな欠片をひろった！'); SND.play('shard'); GAME3D.confetti(c[0] + 0.5, c[1] + 0.5, 12, 5); }
  });
  world.flags.forEach((f, i) => {
    if (flagsHit[i] || !hero.ground || anims.length) return;
    if (Math.hypot(f.x - hero.x, f.y + 0.5 - cy) < CFG.item.flagR) {
      flagsHit[i] = true;
      cp = { x: f.x, y: f.y, mask: world.mask, stack: foldStack.slice() };
      HUD.toast('チェックポイント'); SND.play('flag'); GAME3D.confetti(f.x, f.y + 1.2, 10, 5);
    }
  });
}

function clearStage() {
  state = 'clear'; HUD.playing(false);
  SND.play(level.big ? 'big' : 'clear');
  GAME3D.confetti(level.goal.x, level.goal.y + 2, level.big ? 150 : 80, level.big ? 10 : 8);
  const n = got.filter(Boolean).length;
  const old = save.stages[level.id] || { clear: false, best: 1e9, shards: level.shards.map(() => false) };
  save.stages[level.id] = {
    clear: true, best: Math.min(old.best, time),
    shards: level.shards.map((_, i) => !!(old.shards[i] || got[i])),
  };
  let abilityMsg = '';
  if (level.big) { save.abilities[level.big] = true; abilityMsg = '<br><br>◆◆◆ ' + ABILITY_TEXT[level.big] + ' ◆◆◆'; }
  writeSave(save);
  $('clearInfo').innerHTML = `${level.id} ${level.name}<br>タイム ${time.toFixed(1)} 秒　／　折った回数 ${foldCount} 回<br>小さな欠片 ${n}/${level.shards.length}　／　やり直し ${deaths} 回${abilityMsg}`;
  wrapPhrases($('clearInfo'));
  const hasNext = LEVELS.some((lv, i) => i > stageIdx && unlocked(lv) && !lv.needShards);
  $('btnNext').style.display = hasNext && !level.final ? '' : 'none';
  if (level.final) {
    const sum = Object.values(save.stages).reduce((t, s) => t + (s.clear ? s.best : 0), 0);
    $('endInfo').innerHTML = `最終ステージ クリア！<br>小さな欠片 ${totalShards()} / ${LEVELS.reduce((a, l) => a + l.shards.length, 0)}　／　最短タイムの合計 ${sum.toFixed(1)} 秒`;
    wrapPhrases($('endInfo'));
    HUD.show('scEnding'); state = 'ending';
  } else HUD.show('scClear');
}

function update(dt) {
  time += dt;
  if (deadT > 0) deadT -= dt;
  if (anims.length) {
    for (const a of anims) a.t += dt;
    if (anims[0].t >= CFG.fold.dur) {
      for (const a of anims) {
        if (a.fold) { world.mask |= 1 << a.i; foldStack.push(a.i); }
        else { world.mask &= ~(1 << a.i); foldStack = foldStack.filter(k => k !== a.i); }
        if (a.carried || a.x1 !== a.x0 || a.y1 !== a.y0) { hero.x = a.x1; hero.y = a.y1; hero.vx = 0; hero.vy = 0; }
      }
      anims = [];
    }
  } else {
    if (INPUT.unfoldPressed) tryUnfold();
    else if (INPUT.foldPressed) tryFold();
    if (!anims.length) {
      stepHero(world, hero, INPUT, dt);
      if (hero.jumped) SND.play('jump');
      if (hero.landed) { squash = Math.max(squash, hero.landed); SND.play('land'); }
      if (hero.y < CFG.hero.deathY || hitsSpike(world, hero)) respawn();
      else {
        collectItems();
        if (Math.abs(hero.x - level.goal.x) < 0.9 && Math.abs(hero.y - level.goal.y) < 1.2) clearStage();
      }
    }
  }
  INPUT.foldPressed = false; INPUT.unfoldPressed = false; INPUT.jumpPressed = false;
  if (shake) { shake.t += dt; if (shake.t > CFG.fold.shakeDur) shake = null; }
  squash = Math.max(0, squash - dt * 5);
  updateCandidate();
  // ガイド表示
  if (anims.length) HUD.prompt('');
  else if (candidate >= 0 && !world.isOn(candidate)) {
    const b = bestPlan();
    HUD.prompt(b && b.plan.r.carried ? 'F：乗ったまま折る（紙ごと運ばれる）' : b && b.plan.unfold >= 0 ? 'F：折る（前の折りは自動で戻る）' : 'F：折る');
  } else if (foldStack.length) {
    const top = foldStack[foldStack.length - 1], r = canUnfold(world, top, hero.x, hero.y);
    HUD.prompt(r.ok ? (r.carried ? 'F：元に戻す（紙ごと運ばれる）' : 'F：元に戻す') : WHY[r.why] || '重なっていて戻せない', !r.ok);
  } else HUD.prompt('');
  HUD.canFold(!anims.length && candidate >= 0);
  HUD.time(time);
  HUD.shards(got.filter(Boolean).length, got.length);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; clock += dt;
  if (state === 'play' && !portrait.matches) {
    let rest = dt;                       // 物理は 1/120 秒刻み
    while (rest > 1e-6) { const s = Math.min(rest, 1 / 120); update(s); rest -= s; if (state !== 'play') break; }
  }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) hintFold = -1; }
  GAME3D.update(dt, { hero, world, anims, shake, candidate, time: clock, squash, got, flagsHit, dead: false, hint: hintFold, groundY: groundBelow() });
  GAME3D.render();
  requestAnimationFrame(frame);
}
loadStage(0);
requestAnimationFrame(frame);

// 検証用に外から見られるようにしておく（遊びには影響しない）
window.__game = { get world() { return world; }, get hero() { return hero; }, get state() { return state; }, get got() { return got; }, startStage, showSelect, LEVELS, get save() { return save; } };

// 足元の地面の高さ（影を落とす位置）
function groundBelow() {
  if (state === 'title' || state === 'select') return null;
  const cx = Math.floor(hero.x);
  for (let cy = Math.min(world.H - 1, Math.floor(hero.y + 0.01)); cy >= 0; cy--) if (world.solid(cx, cy)) return cy + 1;
  return null;
}

