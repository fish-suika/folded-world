// ===== 音（外部素材なし。WebAudio で生成） =====
const SND = (function () {
  let ctx = null, master = null, bgmGain = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('foldedWorld.mute') === '1'; } catch (e) {}
  let bgmTimer = null, bgmStep = 0, bgmTheme = null, bgmNext = 0;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    bgmGain = ctx.createGain(); bgmGain.gain.value = 0.5; bgmGain.connect(master);
    const len = ctx.sampleRate * 0.6;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // 音を1つ鳴らす（周波数を f0 → f1 へ滑らせる）
  function tone(type, f0, f1, dur, vol, when, dest) {
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // 紙のこすれる音（フィルタをかけたノイズ）
  function noise(f0, f1, dur, vol, when, q, type) {
    const t = ctx.currentTime + (when || 0);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.Q.value = q || 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12);   // MIDI 番号 → Hz

  const FX = {
    fold()   { noise(500, 3200, 0.3, 0.5, 0, 0.9); noise(2600, 700, 0.12, 0.45, 0.42, 1.5); tone('sine', 150, 70, 0.14, 0.35, 0.5); },
    unfold() { noise(3000, 500, 0.3, 0.5, 0, 0.9); noise(700, 2600, 0.12, 0.4, 0.42, 1.5); tone('sine', 130, 60, 0.14, 0.3, 0.5); },
    shake()  { tone('square', 150, 120, 0.07, 0.18, 0); tone('square', 140, 110, 0.07, 0.18, 0.1); },
    jump()   { tone('sine', 330, 700, 0.13, 0.25); },
    land()   { noise(900, 300, 0.07, 0.28, 0, 0.7, 'lowpass'); },
    shard()  { tone('triangle', N(84), N(84), 0.12, 0.28); tone('triangle', N(91), N(91), 0.2, 0.28, 0.07); },
    flag()   { [72, 76, 79].forEach((n, i) => tone('triangle', N(n), N(n), 0.16, 0.26, i * 0.08)); },
    death()  { tone('sawtooth', 420, 70, 0.4, 0.22); noise(800, 150, 0.3, 0.25, 0.05, 0.7, 'lowpass'); },
    clear()  { [72, 76, 79, 84, 79, 84].forEach((n, i) => tone('triangle', N(n), N(n), 0.22, 0.3, i * 0.11)); },
    big()    { [67, 72, 76, 79, 84, 88, 91].forEach((n, i) => { tone('triangle', N(n), N(n), 0.5, 0.26, i * 0.1); tone('sine', N(n + 12), N(n + 12), 0.5, 0.1, i * 0.1); }); },
    click()  { tone('sine', 660, 880, 0.06, 0.18); },
  };

  // ---- BGM：テーマごとの音階とテンポで、ゆるく鳴らし続ける ----
  const THEME = {
    meadow: { bpm: 96,  root: 60, scale: [0, 2, 4, 7, 9], bass: [0, 7, 9, 5], wave: 'triangle' },
    sunset: { bpm: 84,  root: 62, scale: [0, 3, 5, 7, 10], bass: [0, 5, 3, 7], wave: 'sine' },
    night:  { bpm: 72,  root: 57, scale: [0, 3, 5, 7, 10], bass: [0, 3, 5, 2], wave: 'sine' },
    secret: { bpm: 112, root: 67, scale: [0, 2, 4, 7, 9], bass: [0, 4, 7, 4], wave: 'triangle' },
  };
  function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function scheduleBgm() {
    if (!ctx || !bgmTheme) return;
    const th = THEME[bgmTheme] || THEME.meadow;
    const step = 60 / th.bpm / 2;   // 8 分音符
    while (bgmNext < ctx.currentTime + 0.4) {
      const when = Math.max(0, bgmNext - ctx.currentTime);
      const i = bgmStep, bar = Math.floor(i / 8) % 4;
      if (i % 4 === 0) {   // 低音
        const n = th.root - 12 + th.bass[bar];
        tone(th.wave, N(n), N(n), step * 3.6, 0.16, when, bgmGain);
      }
      if (i % 8 === 0) {   // 和音（パッド）
        [0, 4, 7].forEach(d => tone('sine', N(th.root + th.bass[bar] + d), N(th.root + th.bass[bar] + d), step * 7.5, 0.045, when, bgmGain));
      }
      if (rnd(i + bar * 31) < 0.55) {   // 旋律（まばら）
        const k = Math.floor(rnd(i * 3 + 7) * th.scale.length);
        const oct = rnd(i * 5 + 1) < 0.3 ? 12 : 0;
        const n = th.root + 12 + th.scale[k] + oct;
        tone('triangle', N(n), N(n), step * 1.6, 0.075, when, bgmGain);
      }
      bgmStep++; bgmNext += step;
    }
  }

  return {
    // はじめのタップで呼ぶ（ブラウザの自動再生制限のため）
    unlock() { ensure(); },
    play(name) { if (!muted && ensure() && FX[name]) FX[name](); },
    bgm(theme) {
      if (!ensure()) { bgmTheme = theme; return; }
      if (bgmTheme === theme && bgmTimer) return;
      bgmTheme = theme; bgmStep = 0; bgmNext = ctx.currentTime + 0.1;
      if (!bgmTimer) bgmTimer = setInterval(() => { if (!muted) scheduleBgm(); else bgmNext = ctx.currentTime + 0.1; }, 120);
    },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('foldedWorld.mute', muted ? '1' : '0'); } catch (e) {}
      if (ensure()) master.gain.value = muted ? 0 : 0.9;
      if (!muted) { bgmNext = ctx.currentTime + 0.1; }
      return muted;
    },
    get muted() { return muted; },
  };
})();
