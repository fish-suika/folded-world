// ===== 3D 描画（three.js r128）。判定は 20-logic.js の2Dマス目、ここは見た目だけ =====
const GAME3D = (function () {
  let renderer, scene, camera, sun, hemi, container, levelRoot, bgRoot;
  let heroRoot, heroBody, heroTail;
  let foldGroups = [], markers = [], backMeshes = [], shardMeshes = [], spikeMeshes = [], flagMeshes = [], flag, flagGlow;
  let camX = 0, camY = 6, bigShard = null;
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
    M.cap = mat(0x5fb86a);      M.capTab = mat(0xffb938);  M.capBack = mat(0xe0563a);
    M.spike = new THREE.MeshLambertMaterial({ color: 0x6b6f86 });
    M.shard = new THREE.MeshLambertMaterial({ color: 0xffd23a, emissive: 0x7a5a00 });
    M.ghost = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.28, depthWrite: false });
    M.ghostLine = new THREE.LineBasicMaterial({ color: 0xd9a400 });
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, D);
  const capGeo = new THREE.BoxGeometry(1.0, 0.2, D + 0.04);
  const spikeGeo = new THREE.ConeGeometry(0.2, 0.55, 4);
  const shardGeo = new THREE.OctahedronGeometry(0.34);

  function cellMesh(front, back) {
    // 面の順: +x, -x, +y, -y, +z, -z
    const m = new THREE.Mesh(boxGeo, [M.edge, M.edge, M.edge, M.edge, front, back]);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function buildLevel(world, level) {
    const W = world.W, H = world.H;
    // 耳のグループ内での位置（折り目を原点にした座標）
    const loc = (fd, cx, cy) => fd.axis === 'x' ? [cx + 0.5 - fd.f, cy + 0.5] : [cx + 0.5, cy + 0.5 - fd.f];
    const inFold = (cx, cy) => world.folds.findIndex(fd => world.inSource(fd, cx, cy));
    foldGroups = world.folds.map(fd => {
      const g = new THREE.Group();
      g.position.set(fd.axis === 'x' ? fd.f : 0, fd.axis === 'y' ? fd.f : 0, 0);       // 折り目を軸に回る
      levelRoot.add(g);
      return g;
    });
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      if (!world.baseSolid(cx, cy)) continue;
      const fi = inFold(cx, cy);
      const isTab = fi >= 0;
      const m = isTab ? cellMesh(M.tab, M.tabBack) : (cy >= 2 ? cellMesh(M.wall, M.wallBack) : cellMesh(M.ground, M.groundBack));
      if (isTab) m.scale.z = 0.92;
      const open = !world.baseSolid(cx, cy + 1);
      if (isTab) { const p = loc(world.folds[fi], cx, cy); m.position.set(p[0], p[1], 0); }
      else m.position.set(cx + 0.5, cy + 0.5, 0);
      (isTab ? foldGroups[fi] : levelRoot).add(m);
      if (open) {
        const cap = new THREE.Mesh(capGeo, isTab ? M.capTab : M.cap);
        cap.position.set(m.position.x, m.position.y + 0.4, 0);
        cap.receiveShadow = true;
        (isTab ? foldGroups[fi] : levelRoot).add(cap);
      }
    }
    // 耳の「ゴースト」（耳の範囲を薄い黄色で示す。裏面だけの耳もここで見える）と、裏面の足場
    backMeshes = [];
    world.folds.forEach((fd, i) => {
      const g = foldGroups[i];
      const lc = loc(fd, (fd.x0 + fd.x1) / 2 - 0.5, (fd.y0 + fd.y1) / 2 - 0.5), cxm = lc[0], cym = lc[1];
      const gw = fd.x1 - fd.x0, gh = fd.y1 - fd.y0;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), M.ghost);
      plane.position.set(cxm, cym, D / 2 + 0.03);
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(gw, gh)), M.ghostLine);
      line.position.set(cxm, cym, D / 2 + 0.04);
      g.add(plane, line);
      const list = [];
      fd.back.forEach(k => {
        const cx = k % W, cy = Math.floor(k / W);
        const m = cellMesh(M.tabBack, M.tabBack);
        m.scale.z = 0.92;
        { const p = loc(fd, cx, cy); m.position.set(p[0], p[1], 0); }
        g.add(m); list.push(m);
        if (!fd.back.has((cy + 1) * W + cx)) {
          const cap = new THREE.Mesh(capGeo, M.capBack);
          cap.position.set(m.position.x, m.position.y + 0.4, 0);
          g.add(cap); list.push(cap);
        }
      });
      backMeshes.push(list);
    });
    // 折り目の点線
    markers = world.folds.map(fd => {
      const g = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: 0x8a7a66 });
      if (fd.axis === 'x') {
        const top = fd.y1 + 1.4, bot = fd.y0 - 0.2;
        for (let y = bot; y < top; y += 0.55) {
          const d = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), m);
          d.position.set(fd.f, y + 0.16, D / 2 + 0.06);
          g.add(d);
        }
      } else {
        for (let x = fd.x0 - 0.5; x < fd.x1 + 0.5; x += 0.55) {
          const d = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.1), m);
          d.position.set(x + 0.16, fd.f, D / 2 + 0.06);
          g.add(d);
        }
      }
      g.userData.mat = m;
      levelRoot.add(g);
      return g;
    });
    // トゲ
    spikeMeshes = world.spikes.map(sp => {
      const fi = sp.back >= 0 ? sp.back : inFold(sp.cx, sp.cy);
      const g = new THREE.Group();
      for (let k = 0; k < 2; k++) {
        const c = new THREE.Mesh(spikeGeo, M.spike);
        c.position.set(-0.25 + k * 0.5, 0.275, 0); c.castShadow = true; g.add(c);
      }
      if (fi >= 0) { const p = loc(world.folds[fi], sp.cx, sp.cy); g.position.set(p[0], p[1] - 0.5, 0); foldGroups[fi].add(g); }
      else { g.position.set(sp.cx + 0.5, sp.cy, 0); levelRoot.add(g); }
      return { g, sp, fi };
    });
    // 小さな欠片
    shardMeshes = world.shards.map(s => {
      const fi = s.back >= 0 ? s.back : inFold(s.cx, s.cy);
      const m = new THREE.Mesh(shardGeo, M.shard);
      m.scale.set(1, 1.3, 0.45); m.castShadow = true;
      if (fi >= 0) { const p = loc(world.folds[fi], s.cx, s.cy); m.position.set(p[0], p[1], 0); foldGroups[fi].add(m); }
      else { m.position.set(s.cx + 0.5, s.cy + 0.5, 0); levelRoot.add(m); }
      return { m, s, fi };
    });
    // チェックポイント旗
    flagMeshes = world.flags.map(f => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.07), new THREE.MeshLambertMaterial({ color: 0xfaf3df }));
      pole.position.y = 0.75;
      const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.7, 0.22); s.lineTo(0, 0.44); s.closePath();
      const cm = new THREE.MeshLambertMaterial({ color: 0xb8b2a5, side: THREE.DoubleSide });
      const cloth = new THREE.Mesh(new THREE.ShapeGeometry(s), cm);
      cloth.position.set(0.04, 1.0, 0);
      g.add(pole, cloth);
      g.position.set(f.x, f.y, -0.5);
      levelRoot.add(g);
      return { g, cm, cloth };
    });
    // ゴール旗
    flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), new THREE.MeshLambertMaterial({ color: 0xfaf3df }));
    pole.position.y = 1.3;
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(1.3, 0.4); s.lineTo(0, 0.8); s.closePath();
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshLambertMaterial({ color: 0xff5d7a, side: THREE.DoubleSide }));
    cloth.position.set(0.05, 1.85, 0);
    flagGlow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.35 }));
    flagGlow.position.set(0.5, 1.8, -0.2);
    flag.add(pole, cloth, flagGlow);
    if (level.big) {
      bigShard = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), M.shard);
      bigShard.scale.set(1, 1.35, 0.5); bigShard.position.set(0.2, 4.0, 0); bigShard.castShadow = true;
      flag.add(bigShard);
    } else bigShard = null;
    flag.position.set(level.goal.x, level.goal.y, 0);
    flag.userData.cloth = cloth;
    levelRoot.add(flag);
  }

  // ---- 背景：紙の切り絵を何層も重ねる ----
  function hill(color, z, baseY, amp, freq, phase, x0, x1) {
    const s = new THREE.Shape();
    s.moveTo(x0, -30);
    for (let x = x0; x <= x1; x += 1.5) s.lineTo(x, baseY + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase * 1.7) * amp * 0.4);
    s.lineTo(x1, -30); s.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshLambertMaterial({ color, map: TEX.b }));
    m.position.z = z;
    bgRoot.add(m);
  }
  function cloud(x, y, z, sc) {
    const g = new THREE.Group();
    const mt = new THREE.MeshLambertMaterial({ color: 0xffffff, map: TEX.a });
    [[0, 0, 1.6], [1.5, 0.3, 1.2], [-1.5, 0.2, 1.1], [0.6, 0.9, 1.0]].forEach(([dx, dy, r]) => {
      const c = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mt); c.position.set(dx, dy, 0); g.add(c);
    });
    g.position.set(x, y, z); g.scale.setScalar(sc); bgRoot.add(g);
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
    g.position.set(x, 2, z); g.scale.setScalar(sc); bgRoot.add(g);
  }
  const THEMES = {
    meadow: { sky: 'linear-gradient(#bfe6ff 0%,#e9f6ff 55%,#fff3d6 100%)', ground: 0x93d38c, groundBack: 0x6fae7a, cap: 0x5fb86a, wall: 0x8ec5ee, wallBack: 0x6a9fcf,
              hills: [0xcfe9d4, 0xb5dcb8, 0x9ccf9e], trees: [0x5aa96a, 0x7bc27f], hemi: [0xffffff, 0xb8d8b0, 0.78], sun: 0xfff0d0 },
    sunset: { sky: 'linear-gradient(#ff9d73 0%,#ffc79a 50%,#ffe9c2 100%)', ground: 0xf2b184, groundBack: 0xcf8a62, cap: 0xd9783a, wall: 0xe98fa0, wallBack: 0xc26e82,
              hills: [0xf8cdb0, 0xf0ab94, 0xdc8b7c], trees: [0xc4654f, 0xe28a6a], hemi: [0xfff1e0, 0xd9a98c, 0.82], sun: 0xffd9a8 },
    night:  { sky: 'linear-gradient(#141a48 0%,#2f3a7a 55%,#5a5aa8 100%)', ground: 0x5b6dbc, groundBack: 0x434f94, cap: 0x8b9af0, wall: 0x7a64b8, wallBack: 0x5a4a96,
              hills: [0x4a549a, 0x38417f, 0x2c3468], trees: [0x3f4ea6, 0x4a9fb4], hemi: [0xc2c9ff, 0x4a5090, 0.8], sun: 0xc6ccff, stars: true },
    gold:   { sky: 'linear-gradient(#ffe27a 0%,#fff0b8 55%,#ffffff 100%)', ground: 0xf6d568, groundBack: 0xd9b33f, cap: 0xe8a820, wall: 0xffb86b, wallBack: 0xd9904a,
              hills: [0xfff0c0, 0xffe39a, 0xffd37a], trees: [0xe0a33a, 0xf2c25a], hemi: [0xffffff, 0xffe6a0, 0.85], sun: 0xfff4d0 },
  };
  function applyTheme(name) {
    const t = THEMES[name] || THEMES.meadow;
    M.ground.color.setHex(t.ground); M.groundBack.color.setHex(t.groundBack); M.cap.color.setHex(t.cap);
    M.wall.color.setHex(t.wall); M.wallBack.color.setHex(t.wallBack);
    hemi.color.setHex(t.hemi[0]); hemi.groundColor.setHex(t.hemi[1]); hemi.intensity = t.hemi[2];
    sun.color.setHex(t.sun);
    container.parentElement.style.background = t.sky;
    while (bgRoot.children.length) bgRoot.remove(bgRoot.children[0]);
    hill(t.hills[0], -26, 4.5, 3.2, 0.11, 0.5, -40, 150);
    hill(t.hills[1], -18, 3.2, 2.6, 0.16, 2.0, -40, 150);
    hill(t.hills[2], -11, 2.4, 1.8, 0.22, 4.2, -40, 150);
    if (t.stars) {
      const sm = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
      for (let i = 0; i < 70; i++) {
        const s = new THREE.Mesh(new THREE.CircleGeometry(0.12 + (i % 4) * 0.05, 5), sm);
        s.position.set(-10 + (i * 37) % 130, 6 + (i * 53) % 12, -30);
        bgRoot.add(s);
      }
    } else {
      [[6, 11, -22, 1.4], [26, 12.5, -24, 1.7], [48, 10.5, -20, 1.3], [66, 12, -25, 1.8], [-8, 12, -23, 1.5], [86, 11, -22, 1.5], [108, 12, -24, 1.6]].forEach(a => cloud(...a));
    }
    for (let i = 0; i < 40; i++) tree(2 + i * 3.1 + (i % 3) * 0.7, -2.4 - (i % 4) * 0.4, 1.0 + (i % 5) * 0.12, t.trees[i % 2]);
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

  function init(el) {
    container = el;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CFG.cam.fov, 16 / 9, 0.5, 200);
    hemi = new THREE.HemisphereLight(0xffffff, 0xb8d8b0, 0.78); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff0d0, 0.85);
    sun.position.set(-8, 18, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 14; sc.bottom = -8; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0005;
    scene.add(sun); scene.add(sun.target);
    makeMaterials();
    bgRoot = new THREE.Group(); scene.add(bgRoot);
    buildHero();
    levelRoot = new THREE.Group();
    scene.add(levelRoot);
    resize();
    window.addEventListener('resize', resize);
  }

  // ステージを読み込む（前のステージの見た目を捨てる）
  function load(world, level) {
    while (levelRoot.children.length) levelRoot.remove(levelRoot.children[0]);
    applyTheme(level.theme);
    buildLevel(world, level);
    camX = level.start.x; camY = CFG.cam.minY;
  }

  function resize() {
    if (!renderer) return;
    const w = container.clientWidth || 640, h = container.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

  // st: { hero, world, anim, shake:{i,t}|null, candidate, time, squash, got:[bool], flagsHit:[bool] }
  function update(dt, st) {
    const { hero, world, anim, shake } = st;
    // 折りの角度
    const prog = [];
    for (let i = 0; i < foldGroups.length; i++) {
      const fd = world.folds[i];
      let p = world.isOn(i) ? 1 : 0;
      if (anim && anim.i === i) { const e = ease(anim.t / CFG.fold.dur); p = anim.fold ? e : 1 - e; }
      prog[i] = p;
      const sgn = fd.axis === 'x' ? -fd.dir : fd.dir;
      let rot = sgn * Math.PI * p;
      if (shake && shake.i === i) rot += Math.sin(shake.t * 70) * 0.07 * (1 - shake.t / CFG.fold.shakeDur) * sgn;
      if (fd.axis === 'x') foldGroups[i].rotation.y = rot; else foldGroups[i].rotation.x = rot;
      // 折り目の点線：候補は金色に脈打つ
      const mk = markers[i].userData.mat;
      const hot = st.candidate === i || world.isOn(i);
      mk.color.setHex(hot ? (Math.sin(st.time * 8) > 0 ? 0xffa800 : 0xff6a00) : 0x8a7a66);
      // 裏面の足場は、半分以上めくれてから現れる（紙の裏側が見えるのと同じ）
      const showBack = p > 0.5;
      for (const m of backMeshes[i]) m.visible = showBack;
    }
    // アイテム
    for (const e of shardMeshes) {
      const idx = world.shards.indexOf(e.s);
      let vis = !st.got[idx];
      if (e.s.back >= 0) vis = vis && prog[e.s.back] > 0.5;
      e.m.visible = vis;
      e.m.rotation.y = st.time * 2.2;
      e.m.scale.y = 1.3 + Math.sin(st.time * 4 + idx) * 0.08;
    }
    for (const e of spikeMeshes) e.g.visible = world.spikeCell(e.sp) !== null || (anim && e.fi >= 0);
    flagMeshes.forEach((e, i) => {
      const hit = st.flagsHit[i];
      e.cm.color.setHex(hit ? 0xffb938 : 0xb8b2a5);
      e.cloth.rotation.y = Math.sin(st.time * 3 + i) * 0.25;
    });
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
    heroRoot.visible = !st.dead;
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
    if (bigShard) { bigShard.rotation.y = st.time * 1.6; bigShard.position.y = 4.0 + Math.sin(st.time * 2) * 0.2; }
    flagGlow.scale.setScalar(1 + Math.sin(st.time * 3) * 0.08);
    // カメラ
    const half = world.W / 2;
    const tx = Math.min(world.W - 11, Math.max(11, hx + hero.face * 2.2));
    const ty = Math.max(CFG.cam.minY, hy + 2.6);
    const k = 1 - Math.exp(-CFG.cam.smooth * dt);
    camX += (tx - camX) * k; camY += (ty - camY) * k;
    camera.position.set(camX, camY + 1.2, CFG.cam.dist);
    camera.lookAt(camX, camY, 0);
    sun.position.set(camX - 8, 18, 16); sun.target.position.set(camX, 3, 0); sun.target.updateMatrixWorld();
  }

  function snapCamera(x, y) { camX = Math.min(Math.max(x, 11), 1000); camY = Math.max(CFG.cam.minY, y + 2.6); }
  function render() { renderer.render(scene, camera); }
  return { init, load, update, render, resize, snapCamera };
})();
