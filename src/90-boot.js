// ===== ゲーム本体（状態・ループ） =====
const world = new World(LEVEL);
let hero = newHero(LEVEL);
let state = 'title';          // title | play | pause | clear
let anim = null;              // { i, fold, t, carried, x0, x1 }
let shake = null;             // { i, t }
let time = 0, clock = 0, foldCount = 0, squash = 0, candidate = -1, fade = 0;

GAME3D.init($('view'), world, LEVEL);

function resetStage() {
  world.active = -1; anim = null; shake = null;
  hero = newHero(LEVEL);
  GAME3D.snapCamera(hero.x, hero.y);
}
function startGame() {
  resetStage(); time = 0; foldCount = 0;
  state = 'play'; HUD.show(null); HUD.playing(true);
}
function respawn() {   // 落ちたら最初の位置から。折りも元に戻す
  resetStage(); fade = 1; HUD.toast('落ちた！ もういちど');
}
function pause(on) {
  if (state === 'play' && on !== false) { state = 'pause'; HUD.show('scPause'); }
  else if (state === 'pause' && on !== true) { state = 'play'; HUD.show(null); }
}
onPause = () => pause();
onRetry = () => { if (state === 'play' || state === 'pause') { resetStage(); time = 0; foldCount = 0; state = 'play'; HUD.show(null); } };

$('btnStart').addEventListener('click', () => { if (INPUT.touch) tryLandscape(); startGame(); });
$('btnResume').addEventListener('click', () => pause(false));
$('btnRetry').addEventListener('click', () => onRetry());
$('btnAgain').addEventListener('click', () => startGame());

const WHY = {
  overlap: '紙が重なって折れない', onTab: '乗っている紙は折れない',
};

function tryFold() {
  if (anim || !hero.ground) return;
  if (world.active >= 0) {
    const r = canUnfold(world, hero.x, hero.y);
    if (r.ok) { anim = { i: world.active, fold: false, t: 0, carried: r.carried, x0: hero.x, x1: r.nx }; }
    else { shake = { i: world.active, t: 0 }; HUD.toast('紙が重なって戻せない'); }
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

function update(dt) {
  time += dt;
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
      if (hero.y < CFG.hero.deathY) respawn();
      if (Math.abs(hero.x - LEVEL.goal.x) < 0.9 && Math.abs(hero.y - LEVEL.goal.y) < 1.2) {
        state = 'clear'; HUD.playing(false);
        $('clearInfo').innerHTML = `タイム ${time.toFixed(1)} 秒　／　折った回数 ${foldCount} 回`;
        HUD.show('scClear');
      }
    }
  }
  INPUT.foldPressed = false; INPUT.jumpPressed = false;
  if (shake) { shake.t += dt; if (shake.t > CFG.fold.shakeDur) shake = null; }
  squash = Math.max(0, squash - dt * 5);
  updateCandidate();
  // ガイド表示
  if (anim) HUD.prompt('');
  else if (world.active >= 0) { const r = canUnfold(world, hero.x, hero.y); HUD.prompt(r.ok ? (r.carried ? 'F：元に戻す（紙ごと運ばれる）' : 'F：元に戻す') : '重なっていて戻せない', !r.ok); }
  else if (candidate >= 0) { const r = canFold(world, candidate, hero.x, hero.y); HUD.prompt(r.ok ? 'F：折る' : WHY[r.why], !r.ok); }
  else HUD.prompt('');
  HUD.canFold(!anim && candidate >= 0);
  HUD.time(time);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; clock += dt;
  if (state === 'play' && !portrait.matches) {
    let rest = dt;                       // 物理は 1/120 秒刻み
    while (rest > 1e-6) { const s = Math.min(rest, 1 / 120); update(s); rest -= s; if (state !== 'play') break; }
  }
  GAME3D.update(dt, { hero, world, anim, shake, candidate, time: clock, squash });
  GAME3D.render();
  requestAnimationFrame(frame);
}
GAME3D.snapCamera(hero.x, hero.y);
requestAnimationFrame(frame);

// 検証用に外から見られるようにしておく（遊びには影響しない）
window.__game = { world, get hero() { return hero; }, get state() { return state; }, startGame };
