// İzometrik uzay istasyonu: her proje bir modül (Kenney Modular Space Kit), her ajan bir
// Kenney Blocky karakteri. Modüller ızgaraya dizilir, komşu kapılar koridorla bağlanır.
// Kameraya bakan duvarlar bel hizasında kesilir (cutaway), içerisi hep görünür.
//
// Performans ilkeleri:
//  - Sahne ARTIMLI güncellenir: yalnızca eklenen/silinen modül kurulur; yer değişince modül süzülür.
//  - Nokta ışığı yok (ışık sayısı değişince tüm gölgelendiriciler yeniden derlenir).
//  - Geometri, malzeme ve dokular paylaşılır; her karede yeni nesne üretilmez.
//  - Kare süresi uzarsa çözünürlük kendiliğinden düşer, rahatlayınca geri yükselir.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skClone } from "three/addons/utils/SkeletonUtils.js";

const STATUS_COLOR = { idle: 0x9aa7bd, thinking: 0xffb020, tool: 0x2fb8ff, done: 0x2fd27f, error: 0xff4d6a };
export const CHARACTERS = "abcdefghijklmnopqr".split("").map((c) => `character-${c}`);
const ROOM = 12, PITCH = 16, CUT_H = 1.35;

const angLerp = (a, b, k) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };

export function createStation(canvas, { onSelect, onHover, onReorder = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const DPR_MAX = Math.min(devicePixelRatio || 1, 2);
  let dpr = DPR_MAX; renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  let slowFrames = 0, fastFrames = 0, resizingUntil = 0;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const CAM_DIR = new THREE.Vector3(1, 1.25, 1).normalize();
  let zoom = 18; const target = new THREE.Vector3();
  let sizeW = 0, sizeH = 0, sizeDpr = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (w !== sizeW || h !== sizeH || dpr !== sizeDpr) { renderer.setSize(w, h, false); sizeW = w; sizeH = h; sizeDpr = dpr; }
    const a = w / h;
    cam.left = -zoom * a; cam.right = zoom * a; cam.top = zoom; cam.bottom = -zoom;
    cam.position.copy(target).addScaledVector(CAM_DIR, 120);
    cam.lookAt(target); cam.updateProjectionMatrix();
  }
  // Tuval boyutu değişince temizlenir; aynı anda yeniden çizmezsek bir kare boş görünür (yanıp sönme)
  new ResizeObserver(() => { resize(); if (kit.ready) renderer.render(scene, cam); slowFrames = 0; resizingUntil = performance.now() + 400; }).observe(canvas);

  // ---- ışık (yalnızca iki ışık, sabit)
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30364a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(30, 60, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; ground.matrixAutoUpdate = false; ground.updateMatrix();
  scene.add(ground);

  // ---- varlık yükleme (önbellekli)
  const loader = new GLTFLoader(); const cache = new Map();
  const asset = (path) => { if (!cache.has(path)) cache.set(path, new Promise((ok) => loader.load(path, ok, undefined, () => ok(null)))); return cache.get(path); };
  const kit = {};
  Promise.all(["room-small", "corridor", "gate-door", "cables"].map(async (n) => { kit[n] = await asset(`/assets/space/${n}.glb`); }))
    .then(() => { kit.ready = true; setAgents(agentsCache); });

  // ---- paylaşılan geometri / malzeme / doku
  const GEO = new Map();
  const geo = (key, make) => { if (!GEO.has(key)) GEO.set(key, make()); return GEO.get(key); };
  const BOX = (w, h, d) => geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
  const MATS = new Map();
  const mat = (color, o = {}) => {
    const key = `${typeof color === "number" ? color : new THREE.Color(color).getHex()}|${JSON.stringify(o)}`;
    if (!MATS.has(key)) MATS.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o }));
    return MATS.get(key);
  };
  const M = {
    deskTop: mat(0xe9e6f5), deskLeg: mat(0x5b628a), dark: mat(0x2b3045, { metalness: 0.4, roughness: 0.45 }),
    accent: mat(0xf29a2e), chair: mat(0x3d4566), white: mat(0xffffff),
  };
  const SCREENS = new Map();
  function screenMaterial(seed) {
    if (!SCREENS.has(seed)) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 160;
      const g = c.getContext("2d");
      g.fillStyle = "#0e1424"; g.fillRect(0, 0, 256, 160);
      const cols = ["#6cc6ff", "#ffc66b", "#8be08b", "#c9a2ff", "#e6ebf5"];
      for (let i = 0; i < 12; i++) {
        g.fillStyle = cols[(i * 7 + seed) % cols.length];
        g.fillRect(14 + ((i + seed) % 3) * 12, 12 + i * 11.8, 26 + ((i * 53 + seed * 31) % 140), 5);
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      SCREENS.set(seed, t);
    }
    // parlaklık modüle göre değiştiği için malzeme modül başına, doku paylaşılır
    return new THREE.MeshBasicMaterial({ map: SCREENS.get(seed), toneMapped: false });
  }
  // durağan parçalar: yerel matrisi bir kez hesapla
  const freeze = (root) => root.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });

  // ---- kesit (cutaway): modül başına iki düzlem; modül kayınca yalnızca düzlem sabitleri güncellenir
  const makePlanes = () => [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_H), new THREE.Plane(new THREE.Vector3(-1, 0, -1).normalize(), 0)];
  const setPlanes = (planes, x, y, z, k = 0.5) => { planes[0].constant = CUT_H + y; planes[1].constant = (x + z + k) / Math.SQRT2; };
  function applyCut(obj, cut) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      let m = cut.cache.get(o.material);
      if (!m) {
        m = o.material.clone();
        Object.assign(m, { clippingPlanes: cut.planes, clipIntersection: true, clipShadows: true, side: THREE.DoubleSide });
        cut.cache.set(o.material, m);
      }
      o.material = m;
    });
  }
  const placeKit = (name, x, z, rotY, parent, cut) => {
    const src = kit[name]; if (!src) return null;
    const o = src.scene.clone(true); o.position.set(x, 0, z); o.rotation.y = rotY;
    parent.add(o);
    if (cut) applyCut(o, cut); else o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    freeze(o);
    return o;
  };

  // ---- yerleşim: ızgara
  let cols = 1;
  const slot = (i) => ({ c: i % cols, r: Math.floor(i / cols) });
  const slotPos = (i, out = new THREE.Vector3()) => { const { c, r } = slot(i); return out.set(c * PITCH, 0, r * PITCH); };

  // masa + monitör + sandalye: odanın arka köşesinde, ekran kameraya dönük
  const DESK = new THREE.Vector3(-3.1, 0, -3.1), SEAT = new THREE.Vector3(-1.75, 0, -1.75), DESK_YAW = Math.PI / 4;
  function workstation(look) {
    const g = new THREE.Group(); g.position.copy(DESK); g.rotation.y = DESK_YAW;
    const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(BOX(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); return b; };
    box(3.4, 0.14, 1.5, M.deskTop, 0, 1.22, 0);
    box(0.14, 1.15, 1.3, M.deskLeg, -1.55, 0.6, 0); box(0.14, 1.15, 1.3, M.deskLeg, 1.55, 0.6, 0);
    box(3.0, 0.08, 0.06, M.accent, 0, 1.12, 0.74);
    box(0.16, 0.5, 0.16, M.dark, 0, 1.5, -0.35);
    box(1.9, 1.15, 0.12, M.dark, 0, 2.25, -0.4);
    const scr = new THREE.Mesh(geo("screen", () => new THREE.PlaneGeometry(1.72, 0.98)), screenMaterial(look));
    scr.position.set(0, 2.25, -0.33); g.add(scr);
    box(1.2, 0.05, 0.42, M.dark, 0, 1.31, 0.3);
    box(0.28, 0.32, 0.28, M.white, 1.2, 1.45, 0.2);
    return { group: g, screen: scr };
  }
  function chair() {
    const g = new THREE.Group(); g.position.copy(SEAT); g.rotation.y = DESK_YAW;
    const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(BOX(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); };
    box(1.1, 0.16, 1.1, M.chair, 0, 0.82, 0.15); box(1.1, 1.1, 0.16, M.chair, 0, 1.45, 0.72);
    box(0.16, 0.75, 0.16, M.dark, 0, 0.4, 0.15); box(1.0, 0.08, 0.16, M.dark, 0, 0.05, 0.15); box(0.16, 0.08, 1.0, M.dark, 0, 0.05, 0.15);
    return g;
  }

  // ---- odayı dolduran eşyalar (kitin paleti)
  const RUGS = [0xf6a23a, 0x5fd0ff, 0xb892ff, 0x7bd88f, 0xff7aa8, 0xffd166];
  const LED_ON = [new THREE.Color(0x5fd0ff), new THREE.Color(0x2fd27f)], LED_OFF = new THREE.Color(0x13172a);
  function props(g, look) {
    const add = (gm, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    // halı
    const rugCol = new THREE.Color(RUGS[look % RUGS.length]).lerp(new THREE.Color(0x2b3045), 0.35);
    add(geo("rug", () => new THREE.CylinderGeometry(2.5, 2.5, 0.05, 48)), mat(rugCol.getHex(), { roughness: 1 }), 1.1, 0.04, 1.1).castShadow = false;
    add(geo("rugRing", () => new THREE.TorusGeometry(2.2, 0.06, 6, 48)), mat(0xffffff, { roughness: 1, transparent: true, opacity: 0.35 }), 1.1, 0.08, 1.1).rotation.x = Math.PI / 2;
    // sunucu dolabı + yanıp sönen ışıklar (ışıklar modül başına, gerisi paylaşılan)
    const rack = new THREE.Group(); rack.position.set(3.2, 0, -4.4); g.add(rack);
    const r = (gm, m, x, y, z) => { const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); o.castShadow = true; rack.add(o); return o; };
    r(BOX(1.8, 3.1, 1.1), M.dark, 0, 1.55, 0);
    r(BOX(1.9, 0.12, 1.2), M.accent, 0, 3.1, 0);
    const leds = [];
    for (let row = 0; row < 5; row++) {
      r(BOX(1.5, 0.04, 0.02), mat(0x13172a), 0, 0.55 + row * 0.5, 0.56);
      for (let k = 0; k < 4; k++) {
        const lm = new THREE.MeshBasicMaterial({ color: LED_ON[k % 3 ? 0 : 1], toneMapped: false });
        const led = r(BOX(0.12, 0.08, 0.04), lm, -0.55 + k * 0.18, 0.7 + row * 0.5, 0.57); led.castShadow = false; leds.push(lm);
      }
    }
    // kanepe (boştayken oturulur)
    const sofa = new THREE.Group(); sofa.position.set(-4.35, 0, 2.6); sofa.rotation.y = Math.PI / 2; g.add(sofa);
    const s = (gm, m, x, y, z) => { const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; sofa.add(o); };
    const cushion = mat(0xc9c4e6), frame = mat(0x5b628a);
    s(BOX(3.0, 0.5, 1.2), frame, 0, 0.3, 0); s(BOX(2.7, 0.3, 1.0), cushion, 0, 0.7, 0.05);
    s(BOX(3.0, 1.1, 0.3), cushion, 0, 1.0, -0.5); s(BOX(0.3, 0.8, 1.2), frame, -1.5, 0.75, 0); s(BOX(0.3, 0.8, 1.2), frame, 1.5, 0.75, 0);
    s(BOX(0.6, 0.5, 0.2), M.accent, 0.8, 1.05, -0.3);
    // kasalar
    const crate = mat(0xd9d4ee);
    for (const [x, y, z, sz, ry] of [[4.0, 0, 3.5, 1.1, 0.3], [3.0, 0, 4.3, 0.9, -0.2], [3.85, 1.1, 3.55, 0.75, 0.6]]) {
      add(BOX(sz, sz, sz), crate, x, y + sz / 2, z, ry); add(BOX(sz + 0.02, 0.12, sz + 0.02), M.accent, x, y + sz * 0.62, z, ry);
    }
    // bitkiler
    for (const [x, z, sc] of [[4.5, -2.6, 1], [-2.6, 4.5, 0.85]]) {
      add(geo(`pot${sc}`, () => new THREE.CylinderGeometry(0.45 * sc, 0.35 * sc, 0.7 * sc, 12)), mat(0xf6a23a), x, 0.35 * sc, z);
      add(geo(`leafA${sc}`, () => new THREE.IcosahedronGeometry(0.75 * sc, 0)), mat(0x4caf6a, { flatShading: true }), x, 1.25 * sc, z);
      add(geo(`leafB${sc}`, () => new THREE.IcosahedronGeometry(0.5 * sc, 0)), mat(0x6cc983, { flatShading: true }), x + 0.25 * sc, 1.85 * sc, z - 0.1);
    }
    return { leds };
  }

  // ---- levha ve balon (tuval dokuları; yalnızca içerik değişince yeniden çizilir)
  function labelSprite(text) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 96;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(7.2, 1.35, 1); s.renderOrder = 10;
    let label = text, lastState = null;
    s.userData.draw = (state, force = false) => { // true: seçili, "target": bırakma hedefi
      if (state === lastState && !force) return;
      lastState = state;
      const g = c.getContext("2d"); g.clearRect(0, 0, 512, 96);
      g.fillStyle = state === "target" ? "#f6a23a" : state ? "#2f5bea" : "rgba(15,20,36,.88)";
      g.beginPath(); g.roundRect(4, 4, 504, 88, 44); g.fill();
      if (state) { g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 4; g.stroke(); }
      g.fillStyle = "#ffffff"; g.font = "700 46px 'Bricolage Grotesque', Segoe UI, system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(label.length > 18 ? label.slice(0, 17) + "…" : label, 256, 50);
      t.needsUpdate = true;
    };
    s.userData.setText = (v) => { if (v !== label) { label = v; s.userData.draw(lastState, true); } };
    s.userData.redraw = () => s.userData.draw(lastState, true);
    s.userData.draw(false); return s;
  }
  const activities = new Map();
  function makeBubble() {
    const c = document.createElement("canvas"); c.width = 640; c.height = 96;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(8.4, 1.26, 1); s.renderOrder = 11; s.visible = false;
    let shown = "";
    const set = (text, force = false) => {
      if (!text) { s.visible = false; shown = ""; return; }
      if (text === shown && !force) { s.visible = true; return; }
      shown = text;
      const g = c.getContext("2d"); g.clearRect(0, 0, 640, 96);
      g.fillStyle = "rgba(255,255,255,.97)"; g.strokeStyle = "#2f5bea"; g.lineWidth = 4;
      g.beginPath(); g.roundRect(4, 4, 632, 78, 39); g.fill(); g.stroke();
      g.fillStyle = "#172033"; g.font = "600 44px 'Instrument Sans', Segoe UI, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(text.length > 26 ? text.slice(0, 25) + "…" : text, 320, 44);
      t.needsUpdate = true; s.visible = true;
    };
    return { sprite: s, set, redraw: () => shown && set(shown, true) };
  }

  // ---- karakter (animasyonlu)
  function makeCharacter(look, holder) {
    const wrap = new THREE.Group(); holder.add(wrap);
    const state = { wrap, mixer: null, actions: {}, current: null };
    asset(`/assets/chars/${CHARACTERS[look % CHARACTERS.length]}.glb`).then((gltf) => {
      if (!gltf) return;
      const m = skClone(gltf.scene);
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      wrap.add(m);
      state.mixer = new THREE.AnimationMixer(m);
      for (const clip of gltf.animations) state.actions[clip.name] = state.mixer.clipAction(clip);
      play(state, state.want || "idle");
    });
    return state;
  }
  function play(st, name) {
    st.want = name;
    if (!st.mixer || st.current === name) return;
    const next = st.actions[name] || st.actions.idle; if (!next) return;
    const prev = st.current && st.actions[st.current];
    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.25, false);
    st.current = name;
  }

  // ---- modül (bir kez kurulur; sonra yalnızca yeri/adı/kapıları güncellenir)
  const DOORS = [["E", 6, 0, Math.PI / 2], ["W", -6, 0, Math.PI / 2], ["S", 0, 6, 0], ["N", 0, -6, 0]];
  function buildModule(agent, index) {
    const g = new THREE.Group();
    const home = slotPos(index);
    g.position.copy(home); scene.add(g);
    const cut = { planes: makePlanes(), cache: new Map() };
    setPlanes(cut.planes, home.x, 0, home.z);
    g.userData = { agentId: agent.id, home, cut, t0: Math.random() * 20, cur: new THREE.Vector3(1.5, 0, 1.5), yaw: 0, lastX: home.x, lastY: 0, lastZ: home.z, doorKey: null };

    const statics = new THREE.Group(); g.add(statics);
    placeKit("room-small", 0, 0, 0, statics, cut);
    const cab = placeKit("cables", 2.6, 2.4, 0.6, statics); if (cab) { cab.scale.setScalar(1.2); cab.updateMatrix(); }
    const look = Number.isInteger(agent.char) ? agent.char : index; // karakter ajana bağlı, sıraya değil
    const ws = workstation(look); statics.add(ws.group); statics.add(chair());
    const extras = props(statics, look);
    freeze(statics);

    const doors = new THREE.Group(); g.add(doors);
    const pbMat = new THREE.MeshStandardMaterial({ color: STATUS_COLOR.idle, emissive: STATUS_COLOR.idle, emissiveIntensity: 1, flatShading: true });
    const plumb = new THREE.Mesh(geo("plumb", () => new THREE.OctahedronGeometry(0.36)), pbMat); plumb.scale.y = 1.5; g.add(plumb);
    const bubble = makeBubble(); g.add(bubble.sprite); bubble.set(activities.get(agent.id) || "");
    const label = labelSprite(agent.name); label.position.set(-1.5, 9.2, -1.5); g.add(label);
    const ch = makeCharacter(look, g);
    Object.assign(g.userData, { plumb, pbMat, bubble, ch, label, doors, name: agent.name, screen: ws.screen, leds: extras.leds });
    return g;
  }
  function setDoors(g, flags) {
    const key = DOORS.map(([s]) => (flags[s] ? 1 : 0)).join("");
    if (g.userData.doorKey === key) return;
    g.userData.doorKey = key;
    const holder = g.userData.doors;
    while (holder.children.length) holder.remove(holder.children[0]);
    for (const [side, x, z, r] of DOORS) if (!flags[side]) placeKit("gate-door", x, z, r, holder, g.userData.cut);
  }
  function disposeModule(g) {
    scene.remove(g);
    g.userData.ch.mixer?.stopAllAction();
    for (const m of g.userData.cut.cache.values()) m.dispose();
    g.userData.label.material.map.dispose(); g.userData.label.material.dispose();
    g.userData.bubble.sprite.material.map.dispose(); g.userData.bubble.sprite.material.dispose();
    g.userData.screen.material.dispose(); g.userData.pbMat.dispose();
    for (const l of g.userData.leds) l.dispose();
  }

  // ---- durum
  const modules = new Map(); const corridors = new THREE.Group(); scene.add(corridors);
  let agentsCache = []; const statuses = new Map(); let selectedId = null; let layoutKey = "";
  function setAgents(list) {
    agentsCache = list;
    if (!kit.ready) return;
    cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const ids = new Set(list.map((a) => a.id));
    for (const [id, g] of modules) if (!ids.has(id)) { disposeModule(g); modules.delete(id); }
    const at = (c, r) => { const i = r * cols + c; return c >= 0 && c < cols && r >= 0 && i < list.length; };
    list.forEach((a, i) => {
      let g = modules.get(a.id);
      if (!g) { g = buildModule(a, i); modules.set(a.id, g); applyStatus(a.id, statuses.get(a.id) || a.status || "idle"); }
      else {
        slotPos(i, g.userData.home);                   // yeni yeri: kare döngüsü oraya süzer
        if (g.userData.name !== a.name) { g.userData.name = a.name; g.userData.label.userData.setText(a.name); }
      }
      const { c, r } = slot(i);
      setDoors(g, { E: at(c + 1, r), W: at(c - 1, r), S: at(c, r + 1), N: at(c, r - 1) });
    });
    // koridorlar ve gölge kamerası yalnızca yerleşim (sayı/sütun) değişince
    const key = `${list.length}|${cols}`;
    if (key !== layoutKey) {
      layoutKey = key;
      while (corridors.children.length) corridors.remove(corridors.children[0]);
      for (let i = 0; i < list.length; i++) {
        const { c, r } = slot(i);
        for (const [dc, dr, rot] of [[1, 0, 0], [0, 1, Math.PI / 2]]) {
          if (!at(c + dc, r + dr)) continue;
          const cx = c * PITCH + dc * PITCH / 2, cz = r * PITCH + dr * PITCH / 2;
          const cut = { planes: makePlanes(), cache: new Map() }; setPlanes(cut.planes, cx, 0, cz);
          placeKit("corridor", cx, cz, rot, corridors, cut);
        }
      }
      const rows = Math.ceil(list.length / cols);
      const w = (cols - 1) * PITCH, d = (rows - 1) * PITCH;
      sun.target.position.set(w / 2, 0, d / 2); sun.position.set(w / 2 + 30, 60, d / 2 + 18); sun.target.updateMatrixWorld();
      const ext = Math.max(w, d) / 2 + 14;
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 160 }); sun.shadow.camera.updateProjectionMatrix();
      fitAll(false);
    }
    updateSelection();
  }
  function bounds() {
    const rows = Math.max(1, Math.ceil(agentsCache.length / cols));
    const w = (cols - 1) * PITCH, d = (rows - 1) * PITCH;
    return { cx: w / 2, cz: d / 2, size: Math.max(w, d) + ROOM };
  }
  // yumuşak kamera geçişi
  const camGoal = { target: null, zoom: null };
  function fitAll(animate = true) {
    const b = bounds();
    const t = new THREE.Vector3(b.cx, 1.5, b.cz), z = Math.max(13, b.size * 0.74);
    if (animate) { camGoal.target = t; camGoal.zoom = z; } else { target.copy(t); zoom = z; camGoal.target = null; resize(); }
  }
  function focusAgent(id) {
    const g = modules.get(id); if (!g) return;
    camGoal.target = new THREE.Vector3(g.userData.home.x, 1.5, g.userData.home.z); camGoal.zoom = Math.min(zoom, 13);
  }
  function applyStatus(id, st) {
    statuses.set(id, st);
    const g = modules.get(id); if (!g) return;
    const c = STATUS_COLOR[st] ?? STATUS_COLOR.idle;
    g.userData.pbMat.color.setHex(c); g.userData.pbMat.emissive.setHex(c);
    g.userData.status = st; g.userData.statusAt = performance.now();
  }

  function updateSelection() { for (const [id, g] of modules) g.userData.label.userData.draw(id === selectedId); }
  // bir zemin noktası hangi modülün yuvasına düşüyor (sürüklenen hariç)
  function slotAt(p, except) {
    for (const [id, g] of modules) if (id !== except && Math.abs(p.x - g.userData.home.x) < ROOM / 2 + 1 && Math.abs(p.z - g.userData.home.z) < ROOM / 2 + 1) return id;
    return null;
  }

  // ---- seçme / hover (zemin düzlemiyle kesişim; ağ taraması yok, ucuz)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const PICK_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5), GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpP = new THREE.Vector3();
  function castTo(plane, clientX, clientY, out) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    return ray.ray.intersectPlane(plane, out);
  }
  function pick(ev) {
    if (!castTo(PICK_PLANE, ev.clientX, ev.clientY, tmpP)) return null;
    for (const g of modules.values()) if (Math.abs(tmpP.x - g.position.x) < ROOM / 2 + 0.5 && Math.abs(tmpP.z - g.position.z) < ROOM / 2 + 0.5) return g.userData.agentId;
    return null;
  }
  const groundAt = (x, y) => { const p = new THREE.Vector3(); return castTo(GROUND, x, y, p) ? p : null; };

  // ---- gezinme: sürükleyerek kaydır, tekerle imlece doğru yakınlaştır
  const clampZoom = (z) => Math.min(80, Math.max(6, z));
  function zoomAt(factor, clientX, clientY) {
    camGoal.target = null; camGoal.zoom = null;
    const before = clientX != null ? groundAt(clientX, clientY) : null;
    zoom = clampZoom(zoom * factor); resize();
    if (before) { const after = groundAt(clientX, clientY); if (after) { target.add(before.sub(after)); resize(); } }
  }
  // ---- oda taşıma görseli: zemin çerçeveleri + imleci izleyen ad etiketi
  function frameMesh(color) {
    const shape = new THREE.Shape(), r = 2.2, o = ROOM / 2 + 1.1, i = ROOM / 2 + 0.35;
    const rr = (s, h, rad) => { s.moveTo(-h + rad, -h); s.lineTo(h - rad, -h); s.quadraticCurveTo(h, -h, h, -h + rad); s.lineTo(h, h - rad); s.quadraticCurveTo(h, h, h - rad, h); s.lineTo(-h + rad, h); s.quadraticCurveTo(-h, h, -h, h - rad); s.lineTo(-h, -h + rad); s.quadraticCurveTo(-h, -h, -h + rad, -h); };
    rr(shape, o, r); const hole = new THREE.Path(); rr(hole, i, r - 0.6); shape.holes.push(hole);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.visible = false; m.renderOrder = 5; scene.add(m); return m;
  }
  const srcFrame = frameMesh(0x5b8cff), dstFrame = frameMesh(0xf6a23a);
  const ghost = document.createElement("div");
  ghost.style.cssText = "position:absolute;z-index:20;pointer-events:none;display:none;transform:translate(14px,-50%);padding:8px 14px;border-radius:999px;background:#2f5bea;color:#fff;font:700 14px/1 'Bricolage Grotesque',system-ui,sans-serif;box-shadow:0 10px 24px rgba(0,0,0,.45);white-space:nowrap";
  canvas.parentElement.append(ghost);
  function showGhost(ev, text, swap) {
    const r = canvas.getBoundingClientRect();
    ghost.style.display = "block"; ghost.style.left = ev.clientX - r.left + "px"; ghost.style.top = ev.clientY - r.top + "px";
    ghost.textContent = text; ghost.style.background = swap ? "#f6a23a" : "#2f5bea"; ghost.style.color = swap ? "#2a1600" : "#fff";
  }

  let drag = null;
  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    // sol tuşla bir odaya basıldıysa oda taşınır; boşlukta ya da orta tuşla harita kayar
    const room = ev.button === 0 && modules.size > 1 ? pick(ev) : null;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, p0: groundAt(ev.clientX, ev.clientY), moved: false, room, target: null };
  });
  let hoverQueued = null; // hover hesabını kare başına bire indir
  canvas.addEventListener("pointermove", (ev) => {
    if (drag && drag.id === ev.pointerId) {
      if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6) {
        drag.moved = true; canvas.setPointerCapture(ev.pointerId); canvas.style.cursor = "grabbing"; onHover(null); camGoal.target = null;
        if (drag.room) { const g = modules.get(drag.room); srcFrame.position.set(g.userData.home.x, 0.03, g.userData.home.z); srcFrame.visible = true; }
      }
      if (drag.moved && drag.room) {
        const g = modules.get(drag.room);
        if (g && castTo(GROUND, ev.clientX, ev.clientY, tmpP)) {
          const t = slotAt(tmpP, drag.room);
          if (t !== drag.target) {
            if (drag.target) modules.get(drag.target)?.userData.label.userData.draw(drag.target === selectedId);
            drag.target = t;
            if (t) { const tg = modules.get(t); tg.userData.label.userData.draw("target"); dstFrame.position.set(tg.userData.home.x, 0.03, tg.userData.home.z); }
            dstFrame.visible = !!t;
          }
          const tName = drag.target ? modules.get(drag.target).userData.name : null;
          showGhost(ev, tName ? `${g.userData.name}  ⇄  ${tName}` : g.userData.name, !!tName);
        }
        return;
      }
      if (drag.moved && drag.p0) { if (castTo(GROUND, ev.clientX, ev.clientY, tmpP)) { target.add(drag.p0.clone().sub(tmpP)); resize(); } return; }
    }
    hoverQueued = ev;
  });
  const endDrag = (ev) => {
    if (!drag || drag.id !== ev.pointerId) return;
    canvas.dataset.dragged = drag.moved ? "1" : "";
    if (drag.moved && drag.room) {
      srcFrame.visible = dstFrame.visible = false; ghost.style.display = "none";
      if (drag.target) {
        const a = drag.room, b = drag.target;
        modules.get(b)?.userData.label.userData.draw(b === selectedId);
        // anında yer değiştir (sunucu yanıtını beklemeden); sunucu sırayı kaydedince aynı yerleşim gelir
        const ga = modules.get(a), gb = modules.get(b);
        if (ga && gb) { const tmp = ga.userData.home.clone(); ga.userData.home.copy(gb.userData.home); gb.userData.home.copy(tmp); }
        onReorder(a, b);
      }
    }
    drag = null; canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("click", (ev) => { if (canvas.dataset.dragged) { canvas.dataset.dragged = ""; return; } const id = pick(ev); if (id) onSelect(id); });
  canvas.addEventListener("dblclick", (ev) => { const id = pick(ev); if (id) focusAgent(id); else fitAll(); });
  canvas.addEventListener("wheel", (ev) => { ev.preventDefault(); zoomAt(Math.pow(1.0015, ev.deltaY), ev.clientX, ev.clientY); }, { passive: false });
  canvas.addEventListener("pointerleave", () => { hoverQueued = null; onHover(null); });

  // ---- animasyon döngüsü (karede nesne üretimi yok)
  const WAYPOINTS = [[1.6, 2.4], [2.8, -0.8], [-3.7, 2.6, "sofa"], [2.4, 1.0], [-1.8, 1.8], [0.4, 1.2], [-3.7, 2.6, "sofa"]]
    .map(([x, z, tag]) => ({ v: new THREE.Vector3(x, 0, z), sofa: tag === "sofa" }));
  const IDLE_SPOT = new THREE.Vector3(2.2, 0, 2.2);
  const dV = new THREE.Vector3();
  const clock = new THREE.Clock();
  function adaptResolution(dt) {
    if (performance.now() < resizingUntil) return; // panel sürüklenirken ölçme
    // 30 kare üst üste yavaşsa (>~25 ms) çözünürlüğü düşür; uzun süre rahatsa geri yükselt
    if (dt > 0.025) { slowFrames++; fastFrames = 0; } else if (dt < 0.014) { fastFrames++; slowFrames = 0; }
    if (slowFrames > 30 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); slowFrames = 0; }
    if (fastFrames > 240 && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, dpr + 0.25); renderer.setPixelRatio(dpr); resize(); fastFrames = 0; }
  }
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    adaptResolution(dt);
    if (hoverQueued) { const ev = hoverQueued; hoverQueued = null; const id = pick(ev); canvas.style.cursor = id ? "grab" : "grab"; onHover(id, ev.clientX, ev.clientY); }
    if (camGoal.target || camGoal.zoom) {
      const k = Math.min(1, dt * 7);
      if (camGoal.target) { target.lerp(camGoal.target, k); if (target.distanceTo(camGoal.target) < 0.02) camGoal.target = null; }
      if (camGoal.zoom) { zoom += (camGoal.zoom - zoom) * k; if (Math.abs(camGoal.zoom - zoom) < 0.02) camGoal.zoom = null; }
      resize();
    }
    const now = performance.now();
    for (const g of modules.values()) {
      const u = g.userData;
      // yer değişimi: evine süzül; kesit düzlemlerini yalnızca konum değişince güncelle
      if (!u.lifted && g.position.distanceToSquared(u.home) > 1e-4) g.position.lerp(u.home, Math.min(1, dt * 10));
      if (g.position.x !== u.lastX || g.position.y !== u.lastY || g.position.z !== u.lastZ) {
        u.lastX = g.position.x; u.lastY = g.position.y; u.lastZ = g.position.z;
        setPlanes(u.cut.planes, u.lastX, u.lastY, u.lastZ);
      }
      const st = u.status || "idle", ch = u.ch, tt = t + u.t0;
      const working = st === "thinking" || st === "tool";
      const since = (now - (u.statusAt || 0)) / 1000;
      let goal, onSofa = false;
      if (working) goal = SEAT;
      else if ((st === "done" || st === "error") && since < 4) goal = IDLE_SPOT;
      else { const w = WAYPOINTS[Math.floor(tt / 6) % WAYPOINTS.length]; goal = w.v; onSofa = w.sofa; }
      dV.subVectors(goal, u.cur); dV.y = 0;
      const dist = dV.length();
      if (dist > 0.05) {
        u.cur.addScaledVector(dV.normalize(), Math.min(dist, 3.4 * dt));
        u.yaw = angLerp(u.yaw, Math.atan2(dV.x, dV.z), Math.min(1, dt * 10));
        play(ch, "walk");
      } else if (working) { u.yaw = angLerp(u.yaw, DESK_YAW + Math.PI, Math.min(1, dt * 10)); play(ch, "sit"); }
      else if (st === "done" && since < 4) { u.yaw = angLerp(u.yaw, Math.PI / 4, dt * 8); play(ch, "emote-yes"); }
      else if (st === "error" && since < 4) { u.yaw = angLerp(u.yaw, Math.PI / 4, dt * 8); play(ch, "emote-no"); }
      else if (onSofa) { u.yaw = angLerp(u.yaw, Math.PI / 2, dt * 8); play(ch, "sit"); }
      else { u.yaw = angLerp(u.yaw, Math.PI / 4, dt * 4); play(ch, "idle"); }
      const sitting = (working || onSofa) && dist <= 0.05;
      ch.wrap.position.set(u.cur.x, sitting ? 0.32 : 0, u.cur.z);
      ch.wrap.rotation.y = u.yaw;
      ch.mixer?.update(dt);

      u.plumb.position.set(u.cur.x, 3.9 + Math.sin(tt * 2) * 0.12, u.cur.z); u.plumb.rotation.y = tt * 1.5;
      u.pbMat.emissiveIntensity = working ? 1.1 + Math.sin(tt * 6) * 0.5 : 0.8;
      u.bubble.sprite.position.set(u.cur.x, 5.4, u.cur.z);
      u.screen.material.color.setScalar(st === "tool" ? 1 : working ? 0.85 : 0.35);
      if (Math.random() < (st === "tool" ? 0.5 : working ? 0.2 : 0.04)) {
        const l = u.leds[(Math.random() * u.leds.length) | 0];
        l.color.copy(Math.random() < 0.5 ? LED_OFF : LED_ON[Math.random() < 0.6 ? 0 : 1]);
      }
    }
    renderer.render(scene, cam);
  }
  resize(); requestAnimationFrame(frame);
  // fontlar yüklenince yalnızca tuval yazıları yeniden çizilir (sahne yeniden kurulmaz)
  document.fonts?.ready.then(() => { for (const g of modules.values()) { g.userData.label.userData.redraw(); g.userData.bubble.redraw(); } });

  return {
    setAgents, setStatus: applyStatus,
    setActivity(id, text) { activities.set(id, text); modules.get(id)?.userData.bubble.set(text); },
    select(id) { selectedId = id; updateSelection(); },
    focus: focusAgent, fit: () => fitAll(true),
    zoomIn: () => { camGoal.zoom = clampZoom((camGoal.zoom || zoom) / 1.3); }, zoomOut: () => { camGoal.zoom = clampZoom((camGoal.zoom || zoom) * 1.3); },
    stats: () => ({ dpr, ...renderer.info.render, programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
}
