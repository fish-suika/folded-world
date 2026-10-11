// ===== 3D 描画（three.js r128）。判定は 20-logic.js の2Dマス目、ここは見た目だけ =====
const GAME3D = (function () {
  let renderer, scene, camera, sun, container;
  let heroRoot, heroBody, heroTail;
  let foldGroups = [], markers = [], flag, flagGlow;
  let camX = 0, camY = 6, shakeT = 0;
  const D = 0.5;            // 紙の厚み（奥行き）

  // ---- 紙のテクスチャ（繊維とざらつきを canvas で生成） ----
  function paperTex(seed) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 900; i++) {
      const x = rnd() * 128, y = rnd() * 128, l = 3 + rnd() * 9, a = rnd() * Math.PI;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(120,100,70,0.07)' : 'rgba(255,255,255,0.35)';
      g.lineWidth = 0.6 + rnd() * 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(90,70,40,${rnd() * 0.06})`; g.fillRect(rnd() * 128, rnd() * 128, 1.5, 1.5); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const TEX = {};
  const mat = (color, tex) => new THREE.MeshLambertMaterial({ color, map: tex || TEX.a });

  const M = {};
  function makeMaterials() {
    TEX.a = paperTex(1); TEX.b = paperTex(7);
    M.edge = mat(0xfaf3df);
    M.ground = mat(0x93d38c);   M.groundBack = mat(0x6fae7a, TEX.b);
    M.wall = mat(0x8ec5ee);     M.wallBack = mat(0x6a9fcf, TEX.b);
    M.tab = mat(0xffd76f);      M.tabBack = mat(0xff8a66, TEX.b);   // 耳は黄色、裏は珊瑚色
    M.cap = mat(0x5fb86a);      M.capTab = mat(0xffb938);
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, D);
  const capGeo = new THREE.BoxGeometry(1.0, 0.2, D + 0.04);

  function cellMesh(front, back) {
    // 面の順: +x, -x, +y, -y, +z, -z
    const m = new THREE.Mesh(boxGeo, [M.edge, M.edge, M.edge, M.edge, front, back]);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function buildLevel(world) {
    const W = world.W, H = world.H;
    const inFold = (cx, cy) => world.folds.findIndex(fd => world.inSource(fd, cx, cy));
    foldGroups = world.folds.map(fd => {
      const g = new THREE.Group();
      g.position.set(fd.f, 0, 0);       // 折り目を軸に回る
      scene.add(g);
      return g;
    });
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      if (!world.baseSolid(cx, cy)) continue;
      const fi = inFold(cx, cy);
      const isTab = fi >= 0;
      const tall = cy >= 2 && !(cx < 16 && cy < 2);
      const m = isTab ? cellMesh(M.tab, M.tabBack) : (tall ? cellMesh(M.wall, M.wallBack) : cellMesh(M.ground, M.groundBack));
      if (isTab) m.scale.z = 0.92;
      const open = !world.baseSolid(cx, cy + 1);
      if (isTab) m.position.set(cx + 0.5 - world.folds[fi].f, cy + 0.5, 0);
      else m.position.set(cx + 0.5, cy + 0.5, 0);
      (isTab ? foldGroups[fi] : scene).add(m);
      if (open) {
        const cap = new THREE.Mesh(capGeo, isTab ? M.capTab : M.cap);
        cap.position.set(m.position.x, cy + 0.9, 0);
        cap.castShadow = false; cap.receiveShadow = true;
        (isTab ? foldGroups[fi] : scene).add(cap);
      }
    }
    // 折り目の点線
    markers = world.folds.map(fd => {
      const g = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: 0x8a7a66 });
      const top = fd.y1 + 1.4, bot = fd.y0 - 0.2;
      for (let y = bot; y < top; y += 0.55) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), m);
        d.position.set(fd.f, y + 0.16, D / 2 + 0.06);
        g.add(d);
      }
      g.userData.mat = m;
      scene.add(g);
      return g;
    });
  }

  // ---- 背景：紙の切り絵を何層も重ねる ----
  function hill(color, z, baseY, amp, freq, phase, x0, x1) {
    const s = new THREE.Shape();
    s.moveTo(x0, -30);
    for (let x = x0; x <= x1; x += 1.5) s.lineTo(x, baseY + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase * 1.7) * amp * 0.4);
    s.lineTo(x1, -30); s.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshLambertMaterial({ color, map: TEX.b }));
    m.position.z = z; m.receiveShadow = false;
    scene.add(m);
  }
  function cloud(x, y, z, sc) {
    const g = new THREE.Group();
    const mt = new THREE.MeshLambertMaterial({ color: 0xffffff, map: TEX.a });
    [[0, 0, 1.6], [1.5, 0.3, 1.2], [-1.5, 0.2, 1.1], [0.6, 0.9, 1.0]].forEach(([dx, dy, r]) => {
      const c = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mt); c.position.set(dx, dy, 0); g.add(c);
    });
    g.position.set(x, y, z); g.scale.setScalar(sc); scene.add(g);
  }
  function tree(x, z, sc, col) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.9), new THREE.MeshLambertMaterial({ color: 0xa87b52, map: TEX.b }));
    trunk.position.y = 0.45; g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Shape(); const w = 1.5 - i * 0.3;
      s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(0, 1.5); s.closePath();
      const t = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshLambertMaterial({ color: col, map: TEX.a }));
      t.position.set(0, 0.7 + i * 0.75, 0.01 * i); g.add(t);
    }
    g.position.set(x, 2, z); g.scale.setScalar(sc); scene.add(g);
  }
  function buildBackdrop() {
    hill(0xcfe9d4, -26, 4.5, 3.2, 0.11, 0.5, -40, 110);
    hill(0xb5dcb8, -18, 3.2, 2.6, 0.16, 2.0, -40, 110);
    hill(0x9ccf9e, -11, 2.4, 1.8, 0.22, 4.2, -40, 110);
    [[6, 11, -22, 1.4], [26, 12.5, -24, 1.7], [48, 10.5, -20, 1.3], [66, 12, -25, 1.8], [-8, 12, -23, 1.5]].forEach(a => cloud(...a));
    [[3, -2.5, 1.2, 0x5aa96a], [11, -3.5, 1.5, 0x7bc27f], [19, -2.8, 1.1, 0x5aa96a], [29, -3, 1.4, 0x7bc27f],
     [37, -2.5, 1.2, 0x5aa96a], [47, -3.3, 1.6, 0x7bc27f], [55, -2.6, 1.2, 0x5aa96a]].forEach(a => tree(...a));
  }

  // ---- 主人公：折り紙のキツネ「カミ」 ----
  function buildHero() {
    heroRoot = new THREE.Group();
    heroBody = new THREE.Group();     // つぶれ・のびはここ（足元が原点）
    heroRoot.add(heroBody);
    const orange = new THREE.MeshLambertMaterial({ color: 0xff8f3a, map: TEX.a });
    const white = new THREE.MeshLambertMaterial({ color: 0xfffaf0, map: TEX.a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a2a20 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.34), orange); body.position.set(0, 0.55, 0);
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.04), white); belly.position.set(0.1, 0.5, 0.19);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.46, 0.4), orange); head.position.set(0.12, 1.12, 0);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 4), white); snout.rotation.z = -Math.PI / 2; snout.position.set(0.56, 1.05, 0);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), dark); nose.position.set(0.72, 1.05, 0);
    const earG = new THREE.ConeGeometry(0.16, 0.42, 4);
    const ear1 = new THREE.Mesh(earG, orange); ear1.position.set(0.0, 1.5, 0.12);
    const ear2 = new THREE.Mesh(earG, orange); ear2.position.set(0.24, 1.5, -0.12);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.05), dark); eye.position.set(0.36, 1.18, 0.21);
    const eye2 = eye.clone(); eye2.position.z = -0.21;
    heroTail = new THREE.Group(); heroTail.position.set(-0.3, 0.45, 0);
    const tailM = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 4), orange); tailM.rotation.z = Math.PI / 2 + 0.5; tailM.position.set(-0.4, 0.1, 0);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), white); tip.rotation.z = Math.PI / 2 + 0.5; tip.position.set(-0.78, 0.3, 0);
    heroTail.add(tailM, tip);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.3), orange); legs.position.set(0, 0.12, 0);
    [body, belly, head, snout, nose, ear1, ear2, eye, eye2, tailM, tip, legs].forEach(m => { m.castShadow = true; });
    heroBody.add(body, belly, head, snout, nose, ear1, ear2, eye, eye2, heroTail, legs);
    scene.add(heroRoot);
  }

  // ---- ゴール旗 ----
  function buildGoal(level) {
    flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), new THREE.MeshLambertMaterial({ color: 0xfaf3df }));
    pole.position.y = 1.3;
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(1.3, 0.4); s.lineTo(0, 0.8); s.closePath();
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshLambertMaterial({ color: 0xff5d7a, side: THREE.DoubleSide }));
    cloth.position.set(0.05, 1.85, 0);
    flagGlow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.35 }));
    flagGlow.position.set(0.5, 1.8, -0.2);
    flag.add(pole, cloth, flagGlow);
    flag.position.set(level.goal.x, level.goal.y, 0);
    flag.userData.cloth = cloth;
    scene.add(flag);
  }

  function init(el, world, level) {
    container = el;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CFG.cam.fov, 16 / 9, 0.5, 200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8d8b0, 0.78));
    sun = new THREE.DirectionalLight(0xfff0d0, 0.85);
    sun.position.set(-8, 18, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 14; sc.bottom = -8; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0005;
    scene.add(sun); scene.add(sun.target);
    makeMaterials();
    buildBackdrop();
    buildLevel(world);
    buildHero();
    buildGoal(level);
    camX = level.start.x; camY = CFG.cam.minY;
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!renderer) return;
    const w = container.clientWidth || 640, h = container.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

  // st: { hero, world, anim, shake:{i,t}|null, candidate, time }
  function update(dt, st) {
    const { hero, world, anim, shake } = st;
    // 折りの角度
    for (let i = 0; i < foldGroups.length; i++) {
      const fd = world.folds[i];
      let p = world.active === i ? 1 : 0;
      if (anim && anim.i === i) { const e = ease(anim.t / CFG.fold.dur); p = anim.fold ? e : 1 - e; }
      let rot = -fd.dir * Math.PI * p;
      if (shake && shake.i === i) rot += Math.sin(shake.t * 70) * 0.07 * (1 - shake.t / CFG.fold.shakeDur) * -fd.dir;
      foldGroups[i].rotation.y = rot;
      // 折り目の点線：候補は金色に脈打つ
      const mk = markers[i].userData.mat;
      const hot = st.candidate === i || world.active === i;
      mk.color.setHex(hot ? (Math.sin(st.time * 8) > 0 ? 0xffa800 : 0xff6a00) : 0x8a7a66);
      markers[i].visible = true;
    }
    // 主人公
    let hx = hero.x, hy = hero.y, hz = 0;
    if (anim && anim.carried) {
      const fd = world.folds[anim.i];
      const e = ease(anim.t / CFG.fold.dur), p = anim.fold ? e : 1 - e;   // 折れた角度（1 = 完全に折れている）
      const d1 = anim.x1 - fd.f;                                          // 元の位置の折り目からの距離
      hx = fd.f + d1 * Math.cos(Math.PI * p);
      hz = Math.abs(d1) * Math.sin(Math.PI * p);
    }
    heroRoot.position.set(hx, hy, hz);
    heroRoot.scale.x = hero.face >= 0 ? 1 : -1;
    // つぶれ・のび・走りのはずみ
    const speed = Math.abs(hero.vx);
    let sx = 1, sy = 1;
    if (!hero.ground) { const k = Math.min(0.25, Math.abs(hero.vy) * 0.018); sy = 1 + k; sx = 1 - k * 0.6; }
    else if (st.squash > 0) { sy = 1 - 0.32 * st.squash; sx = 1 + 0.28 * st.squash; }
    else if (speed > 0.5) { sy = 1 + Math.sin(st.time * 22) * 0.04; }
    heroBody.scale.set(sx, sy, 1);
    heroTail.rotation.z = Math.sin(st.time * (6 + speed)) * 0.25 + (hero.ground ? 0 : 0.35);
    // ゴール
    flag.userData.cloth.rotation.y = Math.sin(st.time * 3) * 0.25;
    flagGlow.scale.setScalar(1 + Math.sin(st.time * 3) * 0.08);
    // カメラ
    const tx = Math.min(world.W - 11, Math.max(11, hx + hero.face * 2.2));
    const ty = Math.max(CFG.cam.minY, hy + 2.6);
    const k = 1 - Math.exp(-CFG.cam.smooth * dt);
    camX += (tx - camX) * k; camY += (ty - camY) * k;
    camera.position.set(camX, camY + 1.2, CFG.cam.dist);
    camera.lookAt(camX, camY, 0);
    sun.position.set(camX - 8, 18, 16); sun.target.position.set(camX, 3, 0); sun.target.updateMatrixWorld();
  }

  function snapCamera(x, y) { camX = x; camY = Math.max(CFG.cam.minY, y + 2.6); }
  function render() { renderer.render(scene, camera); }
  return { init, update, render, resize, snapCamera };
})();
