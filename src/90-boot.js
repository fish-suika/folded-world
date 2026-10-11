// ===== ゲーム本体（状態・ループ・保存） =====
const SAVE_KEY = 'foldedWorld.save.v1';
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.stages) return s; } catch (e) {}
  return { stages: {} };
}
function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
let save = loadSave();

let stageIdx = 0, level = LEVELS[0], world = new World(level);
let hero = newHero(level);
let state = 'title';          // title | select | play | pause | clear
let anim = null;              // { i, fold, t, carried, x0, x1 }
let shake = null;             // { i, t }
let time = 0, clock = 0, foldCount = 0, squash = 0, candidate = -1;
let got = [], flagsHit = [], cp = null, deadT = 0, deaths = 0;

GAME3D.init($('view'));

function resetRun() {
  world.active = -1; anim = null; shake = null; deadT = 0;
  hero = newHero(level);
  got = world.shards.map(() => false);
  flagsHit = world.flags.map(() => false);
  cp = null; time = 0; foldCount = 0; deaths = 0;
  GAME3D.snapCamera(hero.x, hero.y);
}
function loadStage(i) {
  stageIdx = i; level = LEVELS[i]; world = new World(level);
  GAME3D.load(world, level);
  resetRun();
  HUD.stage(level.id + '　' + level.name);
}
function enterPlay() { state = 'play'; HUD.show(null); HUD.playing(true); }
function startStage(i) { loadStage(i); enterPlay(); }

function respawn() {   // 落ちる・トゲ → 最後に取った旗から。折りも旗を取った時点に戻す
  deaths++;
  world.active = cp ? cp.active : -1;
  anim = null; shake = null;
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
  LEVELS.forEach((lv, i) => {
    const sv = save.stages[lv.id];
    const b = document.createElement('button');
    b.className = 'card' + (sv && sv.clear ? ' done' : '');
    const n = sv ? sv.shards.filter(Boolean).length : 0;
    const stars = '◆'.repeat(n) + '◇'.repeat(lv.shards.length - n);
    b.innerHTML = `<b>${lv.id}</b><span class="nm">${lv.name}</span><span class="ht">${lv.hint}</span>` +
      `<span class="st">${stars}</span><span class="ht">${sv && sv.clear ? 'クリア　' + sv.best.toFixed(1) + ' 秒' : '未クリア'}</span>`;
    b.addEventListener('click', () => { if (INPUT.touch) tryLandscape(); startStage(i); });
    box.appendChild(b);
  });
  HUD.show('scSelect');
}

$('btnStart').addEventListener('click', () => { if (INPUT.touch) tryLandscape(); showSelect(); });
$('btnResume').addEventListener('click', () => pause(false));
$('btnRetry').addEventListener('click', () => onRetry());
$('btnToSelect1').addEventListener('click', showSelect);
$('btnToSelect2').addEventListener('click', showSelect);
$('btnAgain').addEventListener('click', () => startStage(stageIdx));
$('btnNext').addEventListener('click', () => startStage(Math.min(stageIdx + 1, LEVELS.length - 1)));

const WHY = {
  overlap: '紙が重なって折れない', onTab: '乗っている紙は折れない', void: '戻すと足場がなくなる',
};

function tryFold() {
  if (anim || !hero.ground) return;
  if (world.active >= 0) {
    const r = canUnfold(world, hero.x, hero.y);
    if (r.ok) { anim = { i: world.active, fold: false, t: 0, carried: r.carried, x0: hero.x, x1: r.nx }; }
    else { shake = { i: world.active, t: 0 }; HUD.toast(r.why === 'void' ? WHY.void : '紙が重なって戻せない'); }
    return;
  }
  let best = -1, bestD = 1e9, blocked = -1, why = '';
  for (let i = 0; i < world.folds.length; i++) {
    const r = canFold(world, i, hero.x, hero.y), d = Math.abs(hero.x - world.folds[i].f);
    if (r.ok) { if (d < bestD) { bestD = d; best = i; } }
    else if ((r.why === 'overlap' || r.why === 'onTab') && blocked < 0) { blocked = i; why = r.why; }
  }
  if (best >= 0) { anim = { i: best, fold: true, t: 0, carried: false, x0: hero.x, x1: hero.x }; foldCount++; }
  else if (blocked >= 0) { shake = { i: blocked, t: 0 }; HUD.toast(WHY[why]); }
}

function updateCandidate() {
  candidate = -1;
  if (anim) return;
  if (world.active >= 0) { candidate = world.active; return; }
  let bestD = 1e9;
  for (let i = 0; i < world.folds.length; i++) {
    const r = canFold(world, i, hero.x, hero.y);
    if (r.ok || r.why === 'overlap' || r.why === 'onTab') {
      const d = Math.abs(hero.x - world.folds[i].f);
      if (d < bestD) { bestD = d; candidate = i; }
    }
  }
}

function collectItems() {
  const cx = hero.x, cy = hero.y + 0.75;
  world.shards.forEach((s, i) => {
    if (got[i]) return;
    const c = world.itemCell(s);
    if (!c) return;
    if (Math.hypot(c[0] + 0.5 - cx, c[1] + 0.5 - cy) < CFG.item.shardR) { got[i] = true; HUD.toast('小さな欠片をひろった！'); }
  });
  world.flags.forEach((f, i) => {
    if (flagsHit[i] || !hero.ground || anim) return;
    if (Math.hypot(f.x - hero.x, f.y + 0.5 - cy) < CFG.item.flagR) {
      flagsHit[i] = true;
      cp = { x: f.x, y: f.y, active: world.active };
      HUD.toast('チェックポイント');
    }
  });
}

function clearStage() {
  state = 'clear'; HUD.playing(false);
  const n = got.filter(Boolean).length;
  const old = save.stages[level.id] || { clear: false, best: 1e9, shards: level.shards.map(() => false) };
  save.stages[level.id] = {
    clear: true, best: Math.min(old.best, time),
    shards: level.shards.map((_, i) => !!(old.shards[i] || got[i])),
  };
  writeSave(save);
  $('clearInfo').innerHTML = `${level.id} ${level.name}<br>タイム ${time.toFixed(1)} 秒　／　折った回数 ${foldCount} 回<br>小さな欠片 ${n}/${level.shards.length}　／　やり直し ${deaths} 回`;
  $('btnNext').style.display = stageIdx < LEVELS.length - 1 ? '' : 'none';
  HUD.show('scClear');
}

function update(dt) {
  time += dt;
  if (deadT > 0) deadT -= dt;
  if (anim) {
    anim.t += dt;
    if (anim.t >= CFG.fold.dur) {
      world.active = anim.fold ? anim.i : -1;
      if (anim.carried) { hero.x = anim.x1; hero.vx = 0; hero.vy = 0; }
      anim = null;
    }
  } else {
    if (INPUT.foldPressed) tryFold();
    if (!anim) {
      stepHero(world, hero, INPUT, dt);
      if (hero.landed) squash = Math.max(squash, hero.landed);
      if (hero.y < CFG.hero.deathY || hitsSpike(world, hero)) respawn();
      else {
        collectItems();
        if (Math.abs(hero.x - level.goal.x) < 0.9 && Math.abs(hero.y - level.goal.y) < 1.2) clearStage();
      }
    }
  }
  INPUT.foldPressed = false; INPUT.jumpPressed = false;
  if (shake) { shake.t += dt; if (shake.t > CFG.fold.shakeDur) shake = null; }
  squash = Math.max(0, squash - dt * 5);
  updateCandidate();
  // ガイド表示
  if (anim) HUD.prompt('');
  else if (world.active >= 0) {
    const r = canUnfold(world, hero.x, hero.y);
    HUD.prompt(r.ok ? (r.carried ? 'F：元に戻す（紙ごと運ばれる）' : 'F：元に戻す') : (r.why === 'void' ? WHY.void : '重なっていて戻せない'), !r.ok);
  } else if (candidate >= 0) { const r = canFold(world, candidate, hero.x, hero.y); HUD.prompt(r.ok ? 'F：折る' : WHY[r.why], !r.ok); }
  else HUD.prompt('');
  HUD.canFold(!anim && candidate >= 0);
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
  GAME3D.update(dt, { hero, world, anim, shake, candidate, time: clock, squash, got, flagsHit, dead: false });
  GAME3D.render();
  requestAnimationFrame(frame);
}
loadStage(0);
requestAnimationFrame(frame);

// 検証用に外から見られるようにしておく（遊びには影響しない）
window.__game = { get world() { return world; }, get hero() { return hero; }, get state() { return state; }, get got() { return got; }, startStage, LEVELS };
