// ===== 入力・HUD・画面の出し入れ =====
const $ = id => document.getElementById(id);
const INPUT = { left: false, right: false, jumpHeld: false, jumpPressed: false, foldPressed: false, unfoldPressed: false, touch: false };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyF: 'fold', KeyJ: 'fold', KeyU: 'unfold', ShiftLeft: 'unfold', ShiftRight: 'unfold',
};
let onPause = () => {}, onRetry = () => {}, onMute = () => {};
addEventListener('pointerdown', () => SND.unlock(), { passive: true });

function setKey(code, down) {
  const a = KEYMAP[code];
  if (!a) return false;
  if (a === 'left' || a === 'right') INPUT[a] = down;
  else if (a === 'jump') { if (down && !INPUT.jumpHeld) INPUT.jumpPressed = true; INPUT.jumpHeld = down; }
  else if (a === 'fold') { if (down) INPUT.foldPressed = true; }
  else if (a === 'unfold') { if (down) INPUT.unfoldPressed = true; }
  return true;
}
addEventListener('keydown', e => {
  SND.unlock();
  if (e.code === 'KeyM' && !e.repeat) { onMute(); return; }
  if (e.repeat) { if (KEYMAP[e.code]) e.preventDefault(); return; }
  if (e.code === 'Escape') { onPause(); return; }
  if (e.code === 'KeyR') { onRetry(); return; }
  if (setKey(e.code, true)) e.preventDefault();
});
addEventListener('keyup', e => { if (setKey(e.code, false)) e.preventDefault(); });
addEventListener('blur', () => { INPUT.left = INPUT.right = INPUT.jumpHeld = false; });

// タッチボタン
function bindBtn(id, down, up) {
  const el = $(id);
  const on = e => { e.preventDefault(); INPUT.touch = true; document.body.classList.add('touch'); el.classList.add('down'); down(); };
  const off = e => { e.preventDefault(); el.classList.remove('down'); up && up(); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
bindBtn('bL', () => INPUT.left = true, () => INPUT.left = false);
bindBtn('bR', () => INPUT.right = true, () => INPUT.right = false);
bindBtn('bJ', () => { if (!INPUT.jumpHeld) INPUT.jumpPressed = true; INPUT.jumpHeld = true; }, () => INPUT.jumpHeld = false);
bindBtn('bF', () => INPUT.foldPressed = true);
bindBtn('bU', () => INPUT.unfoldPressed = true);
addEventListener('touchstart', () => { INPUT.touch = true; document.body.classList.add('touch'); }, { passive: true, once: true });
if (matchMedia('(pointer: coarse)').matches) { INPUT.touch = true; document.body.classList.add('touch'); }

// スマホが縦向きの間は案内（#rotate）を出してゲームを止める
const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');

// スマホではじめるとき、全画面にして横向きに固定してみる（できない端末では何もしない）
function tryLandscape() {
  const el = document.documentElement;
  if (!el.requestFullscreen) return;
  el.requestFullscreen().then(() => {
    if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape');
  }).catch(() => {});
}

const HUD = {
  show(name) {
    ['scTitle', 'scSelect', 'scPause', 'scClear', 'scEnding', 'scHelp'].forEach(id => $(id).classList.toggle('on', id === name));
  },
  playing(on) { document.body.classList.toggle('playing', on); },
  stage(txt) { $('tagStage').textContent = txt; },
  shards(n, t) { $('tagShard').textContent = '◆ ' + n + '/' + t; },
  time(t) { $('tagTime').textContent = t.toFixed(1) + ' s'; },
  prompt(text, warn) {
    const p = $('prompt');
    if (!text) { p.style.display = 'none'; return; }
    p.style.display = 'block'; p.textContent = text; p.classList.toggle('warn', !!warn);
  },
  canFold(on) { document.body.classList.toggle('canfold', on); },
  toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(HUD._tt); HUD._tt = setTimeout(() => t.classList.remove('on'), 1500);
  },
};
