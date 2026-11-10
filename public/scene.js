// Isometric space station: every project is a module (Kenney Modular Space Kit), every role in the project
// (developer, tester, analyst, reviewer) is a Kenney Blocky character working in its own corner.
// Furniture comes from the Kenney Furniture Kit; every project gets its own colour palette and set of items.
// Modules are laid out on a grid, neighbouring doors are joined by corridors.
// Walls facing the camera are cut at waist height (cutaway), so the inside is always visible.
//
// Performance principles:
//  - The scene is updated INCREMENTALLY: only added/removed modules are built; a module glides when its slot changes.
//  - No point lights (when the number of lights changes every shader is recompiled).
//  - Geometry, materials and textures are shared; no new objects are created per frame.
//  - If frame time grows the resolution drops by itself and comes back when things calm down.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skClone } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const STATUS_COLOR = { idle: 0x9aa7bd, thinking: 0xffb020, tool: 0x2fb8ff, done: 0x2fd27f, error: 0xff4d6a };
export const CHARACTERS = "abcdefghijklmnopqr".split("").map((c) => `character-${c}`);
const ROOM = 20, PITCH = 24, CUT_H = 1.35;

const angLerp = (a, b, k) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };

export function createStation(canvas, { onSelect, onHover, onReorder = () => {}, onProp = () => {}, propTip = () => "", boardLabels = ["To do", "Doing", "Done"], peekLabel = null }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const DPR_MAX = Math.min(devicePixelRatio || 1, 2);
  let dpr = DPR_MAX; renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF instead of soft shadows: looks almost the same, costs far less
  renderer.info.autoReset = true;
  renderer.shadowMap.autoUpdate = false; // the shadow map is updated at intervals, not every frame (see frame)
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
  // The canvas is cleared when its size changes; unless we redraw at the same time one frame shows empty (flicker)
  new ResizeObserver(() => { resize(); if (kit.ready) { renderer.shadowMap.needsUpdate = true; renderer.render(scene, cam); } slowFrames = 0; resizingUntil = performance.now() + 400; }).observe(canvas);

  // ---- light (only two lights, fixed)
  const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x30364a, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(30, 60, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; ground.matrixAutoUpdate = false; ground.updateMatrix();
  scene.add(ground);

  // ---- asset loading (cached)
  const loader = new GLTFLoader(); const cache = new Map();
  const asset = (path) => { if (!cache.has(path)) cache.set(path, new Promise((ok) => loader.load(path, ok, undefined, () => ok(null)))); return cache.get(path); };
  const kit = {};
  const FURN = ["desk", "chair-desk", "computer-screen", "computer-keyboard", "computer-mouse", "laptop", "books", "bookcase-open",
    "bookcase-closed-wide", "bookcase-open-low", "plant-small-1", "plant-small-2", "plant-small-3", "potted-plant", "lamp-square-table",
    "lamp-round-floor", "lamp-square-floor", "rug-rectangle", "rug-round", "rug-rounded", "rug-square", "kitchen-coffee-machine",
    "kitchen-fridge-small", "kitchen-bar", "speaker", "speaker-small", "cardboard-box-closed", "cardboard-box-open", "trashcan",
    "lounge-sofa", "lounge-design-sofa", "lounge-chair", "lounge-design-chair", "coat-rack-standing", "side-table", "side-table-drawers",
    "table-coffee", "table-coffee-glass", "television-modern", "cabinet-television", "radio", "bear", "stool-bar", "table-round",
    "chair-modern-cushion"];
  Promise.all([
    ...["room-large", "corridor", "gate-door", "gate-door-window", "cables"].map(async (n) => { kit[n] = await asset(`/assets/space/${n}.glb`); }),
    ...FURN.map(async (n) => { kit["f:" + n] = await asset(`/assets/furniture/${n}.glb`); }),
  ]).then(() => { kit.ready = true; setAgents(agentsCache); });

  // ---- shared geometry / materials / textures
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
    // brightness differs per module, so the material is per module and the texture is shared
    return new THREE.MeshBasicMaterial({ map: SCREENS.get(seed), toneMapped: false });
  }
  // static parts: compute the local matrix once
  const freeze = (root) => root.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });

  // ---- cutaway: two planes per module; when a module moves only the plane constants are updated
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

  // ---- layout: grid (one cell = one project)
  let cols = 1;
  const slot = (i) => ({ c: i % cols, r: Math.floor(i / cols) });
  const slotPos = (i, out = new THREE.Vector3()) => { const { c, r } = slot(i); return out.set(c * PITCH, 0, r * PITCH); };

  // ---- project themes: the colours of the Kenney furniture are repainted per project
  // (keys are the kit's linear colours; materials are created once per theme and shared)
  const SRC = { // the kit's linear colours
    wood: [0.896, 0.602, 0.393], woodDark: [0.679, 0.463, 0.3], red: [0.943, 0.371, 0.343], redDark: [0.611, 0.302, 0.294],
    blue: [0.36, 0.521, 0.868], green: [0.184, 0.822, 0.584], grey: [0.741, 0.823, 0.84], dark: [0.31, 0.39, 0.39],
  };
  const THEMES = [
    { wood: 0xd6d1ef, woodDark: 0x9e98c8, red: 0xf6a23a, redDark: 0xc8731a, blue: 0x5b628a, green: 0x6cc983 },  // lavender + orange
    { wood: 0xb5dcec, woodDark: 0x6f9fbe, red: 0x2f6bea, redDark: 0x1d3aa6, blue: 0xffd166, green: 0x48c9b0 },  // ocean
    { wood: 0xdfcba3, woodDark: 0xa88d64, red: 0x2fa36b, redDark: 0x1f7048, blue: 0xf0e6c8, green: 0x5cbf6a },  // forest
    { wood: 0xf3cba7, woodDark: 0xc99069, red: 0xe5484d, redDark: 0xa8283b, blue: 0x8b6be0, green: 0x6cc983 },  // sunset
    { wood: 0x737ba3, woodDark: 0x4a5180, red: 0x5fd0ff, redDark: 0x2f8fbf, blue: 0xff7aa8, green: 0x5fd0a0 },  // night
    { wood: 0xecc193, woodDark: 0xb07f55, red: 0xff7aa8, redDark: 0xb04a74, blue: 0x3fb6c9, green: 0x2fd194 },  // sand + pink
    { wood: 0xe4e4ea, woodDark: 0x9a9aa8, red: 0x222634, redDark: 0x0f121c, blue: 0xf6a23a, green: 0x7bd88f },  // graphite (black and white)
    { wood: 0xc9e7c4, woodDark: 0x86b07e, red: 0xb892ff, redDark: 0x7a55d1, blue: 0xff9f5a, green: 0x3fae5a },  // mint + purple
  ];
  const themeMats = new Map(); // `${theme}|${uuid}` -> material
  function themed(material, ti) {
    const key = `${ti}|${material.uuid}`;
    if (themeMats.has(key)) return themeMats.get(key);
    const c = material.color; const th = THEMES[ti];
    let m = material;
    for (const [k, v] of Object.entries(SRC)) {
      if (th[k] === undefined) continue;
      if (Math.abs(c.r - v[0]) < 0.03 && Math.abs(c.g - v[1]) < 0.03 && Math.abs(c.b - v[2]) < 0.03) { m = material.clone(); m.color.setHex(th[k]); break; }
    }
    themeMats.set(key, m); return m;
  }
  const FS = 3.2; // furniture scale (kit unit → station unit)
  // ry: the direction the FRONT of the item faces (same rule as the characters: (sin ry, cos ry)).
  // Furniture Kit models face -z, hence the added π (so TV, chair and laptop do not stand backwards).
  let buildLamps = null, buildScreens = null; // filled while a room is being built (night lights)
  function furn(name, parent, x, z, ry = 0, { y = 0, s = FS, ti = 0 } = {}) {
    const src = kit["f:" + name]; if (!src) return null;
    if (buildLamps && name.startsWith("lamp-")) buildLamps.push([x, y + (name.includes("floor") ? 2.25 : 0.62), z]);
    const o = src.scene.clone(true); o.position.set(x, y, z); o.rotation.y = ry + Math.PI; o.scale.setScalar(s);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; m.material = themed(m.material, ti); } });
    parent.add(o); return o;
  }
  // seeded random: the same project always gets the same room
  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pickOf = (r, arr) => arr[Math.floor(r() * arr.length)];

  // ---- roles and work corners (room-local coordinates; the camera looks from the +x+z corner, back walls at x=-10 and z=-10)
  // desk: desk centre; seat: where one sits; face: the direction the sitter faces (yaw); ry: desk rotation
  const ROLE_ORDER = { analyst: 0, dev: 1, tester: 2, reviewer: 3 };
  const STATIONS = {
    dev:      { desk: [-5.4, -8.7], ry: 0, seat: [-5.4, -6.9], face: Math.PI },
    tester:   { desk: [4.6, -8.7], ry: 0, seat: [4.6, -6.9], face: Math.PI },
    analyst:  { desk: [-8.7, 5.4], ry: Math.PI / 2, seat: [-6.9, 5.4], face: -Math.PI / 2 },
    reviewer: { desk: [-8.7, -4.6], ry: Math.PI / 2, seat: [-6.9, -4.6], face: -Math.PI / 2 },
  };
  const DESK_H = 0.384 * FS;
  // from the desk's local frame to the room
  const deskLocal = (st, lx, lz) => { const c = Math.cos(st.ry), s = Math.sin(st.ry); return [st.desk[0] + lx * c + lz * s, st.desk[1] - lx * s + lz * c]; };

  // the kit monitor's display panel: x ±0.19, y 0.056…0.287, front face at z = -0.0163 (the kit faces -z; measured from computer-screen.glb)
  const SCREEN_GEO = () => geo("scr", () => new THREE.PlaneGeometry(0.372, 0.226));
  function monitor(parent, st, lx, lz, turn, look, ti, s = FS) {
    const [x, z] = deskLocal(st, lx, lz);
    const o = furn("computer-screen", parent, x, z, st.ry + turn, { y: DESK_H, s, ti }); if (!o) return null;
    const scr = new THREE.Mesh(SCREEN_GEO(), screenMaterial(look)); scr.position.set(0, 0.1714, -0.0172); scr.rotation.y = Math.PI; scr.userData.keep = true; o.add(scr);
    if (buildScreens) buildScreens.push({ role: st.role, x, z, mat: scr.material });
    return scr.material;
  }
  // every role's corner is distinct; empty: when the role is absent the screens stay dim
  function station(role, parent, look, ti, r) {
    const st = { ...STATIONS[role], role }; const screens = [];
    const at = (lx, lz) => deskLocal(st, lx, lz);
    furn("desk", parent, st.desk[0], st.desk[1], st.ry, { ti });
    furn("chair-desk", parent, st.seat[0], st.seat[1], st.face, { ti, s: 3.0 }); // chair facing the desk
    const onDesk = (name, lx, lz, turn = 0, s = FS) => { const [x, z] = at(lx, lz); return furn(name, parent, x, z, st.ry + turn, { y: DESK_H, s, ti }); };
    if (role === "dev") {
      screens.push(monitor(parent, st, -0.52, -0.25, 0.22, look, ti, 2.7), monitor(parent, st, 0.52, -0.25, -0.22, look + 3, ti, 2.7));
      onDesk("computer-keyboard", 0, 0.28); onDesk("computer-mouse", 0.62, 0.3);
      onDesk(pickOf(r, ["plant-small-1", "plant-small-2", "plant-small-3"]), -1.0, 0.25);
      const [sx, sz] = at(1.75, -0.2); furn("speaker", parent, sx, sz, st.ry, { ti });
      const [tx, tz] = at(-1.8, 0.1); furn("trashcan", parent, tx, tz, st.ry, { ti, s: 2.6 });
      const [bx, bz] = at(-3.2, -0.25); furn(pickOf(r, ["bookcase-open-low", "side-table-drawers"]), parent, bx, bz, st.ry, { ti });
      const [b2x, b2z] = at(-3.2, -0.25); furn(pickOf(r, ["radio", "bear", "books", "plant-small-2"]), parent, b2x, b2z, st.ry, { ti, y: 0.39 * FS });
    } else if (role === "tester") {
      screens.push(monitor(parent, st, -0.35, -0.25, 0.12, look + 1, ti));
      onDesk("laptop", 0.62, 0.05, -0.35); onDesk("computer-keyboard", -0.35, 0.3); onDesk("computer-mouse", 0.15, 0.32);
      const [bx, bz] = at(-1.9, 0.3); furn("cardboard-box-open", parent, bx, bz, st.ry + 0.3, { ti });
      const [b2x, b2z] = at(-2.0, 0.2); furn("cardboard-box-closed", parent, b2x, b2z, st.ry - 0.2, { ti, y: 0.28 * FS });
      const [lx, lz] = at(1.7, -0.3); furn("lamp-square-floor", parent, lx, lz, st.ry, { ti });
    } else if (role === "analyst") {
      onDesk("laptop", 0.05, 0.05, 0); onDesk("books", -0.62, -0.1, 0.4); onDesk("books", -0.6, -0.12, -0.1, FS * 0.95);
      onDesk("lamp-square-table", 0.72, -0.2);
      screens.push(null);
      const [ax, az] = at(-2.2, -0.25); furn(pickOf(r, ["bookcase-open", "bookcase-closed-wide"]), parent, ax, az, st.ry, { ti });
      const [cx, cz] = at(2.2, -0.25); furn("bookcase-open", parent, cx, cz, st.ry, { ti });
      const [px, pz] = at(-3.6, 0.2); furn("potted-plant", parent, px, pz, st.ry, { ti });
    } else if (role === "reviewer") {
      screens.push(monitor(parent, st, 0.1, -0.25, 0, look + 2, ti));
      onDesk("computer-keyboard", 0.1, 0.28); onDesk("books", -0.75, 0.1, 0.6); onDesk("lamp-square-table", 0.85, -0.15);
      const [px, pz] = at(1.9, 0); furn(pickOf(r, ["lamp-round-floor", "coat-rack-standing"]), parent, px, pz, st.ry, { ti });
    }
    return { screens: screens.filter(Boolean) };
  }

  // ---- server rack + blinking lights (in the tester's corner; LEDs per module)
  const LED_ON = [new THREE.Color(0x5fd0ff), new THREE.Color(0x2fd27f)], LED_OFF = new THREE.Color(0x13172a);
  function rack(parent, x, z, ry, accent) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
    const r = (gm, m, px, py, pz) => { const o = new THREE.Mesh(gm, m); o.position.set(px, py, pz); o.castShadow = true; g.add(o); return o; };
    r(BOX(1.8, 3.1, 1.1), M.dark, 0, 1.55, 0); r(BOX(1.9, 0.12, 1.2), accent, 0, 3.1, 0);
    // 20 LEDs in one draw call: instanced mesh, colours per instance
    const leds = new THREE.InstancedMesh(BOX(0.12, 0.08, 0.04), new THREE.MeshBasicMaterial({ toneMapped: false }), 20);
    leds.userData.keep = true; leds.castShadow = false; g.add(leds);
    const mx = new THREE.Matrix4();
    for (let row = 0, i = 0; row < 5; row++) {
      r(BOX(1.5, 0.04, 0.02), mat(0x13172a), 0, 0.55 + row * 0.5, 0.56);
      for (let k = 0; k < 4; k++, i++) { leds.setMatrixAt(i, mx.makeTranslation(-0.55 + k * 0.18, 0.7 + row * 0.5, 0.57)); leds.setColorAt(i, LED_ON[k % 3 ? 0 : 1]); }
    }
    leds.instanceMatrix.needsUpdate = true; leds.instanceColor.needsUpdate = true;
    return leds;
  }

  // ---- common areas: meeting table, coffee corner, lounge corner (vary by theme + seed)
  // The hangout spots of idle characters are defined here.
  function commons(g, ti, r) {
    const spots = [];
    // rug in the middle + meeting table
    const CX = -0.8, CZ = 1.4; // room centre (away from the support column in the north-east)
    furn(pickOf(r, ["rug-rounded", "rug-rectangle", "rug-round"]), g, CX, CZ, r() < 0.5 ? 0 : Math.PI / 2, { ti, s: 4.4 });
    if (r() < 0.65) {
      furn("table-round", g, CX, CZ, 0, { ti });
      for (const [dx, dz, ry] of [[0, -1.75, 0], [1.75, 0, -Math.PI / 2], [0, 1.75, Math.PI], [-1.75, 0, Math.PI / 2]]) {
        furn("chair-modern-cushion", g, CX + dx, CZ + dz, ry, { ti, s: 3.6 });
        spots.push({ v: [CX + dx * 0.95, CZ + dz * 0.95], sit: true, face: ry, y: 0.35 });
      }
    } else { // standing meeting bar
      furn("kitchen-bar", g, CX - 0.8, CZ, 0, { ti, s: 3.6 }); furn("kitchen-bar", g, CX + 0.8, CZ, 0, { ti, s: 3.6 });
      for (const dx of [-1.2, 0, 1.2]) { furn("stool-bar", g, CX + dx, CZ + 1.15, Math.PI, { ti, s: 3 }); spots.push({ v: [CX + dx, CZ + 1.3], face: Math.PI }); }
      furn(pickOf(r, ["laptop", "books"]), g, CX - 0.6, CZ, 0.4, { ti, y: 0.42 * 3.6 });
    }
    // coffee corner (east wall, north of the door)
    furn("side-table", g, 8.9, -4.6, -Math.PI / 2, { ti });
    furn("kitchen-coffee-machine", g, 8.9, -4.2, -Math.PI / 2, { ti, y: 0.38 * FS });
    furn(r() < 0.5 ? "kitchen-fridge-small" : "potted-plant", g, 8.9, -7.0, -Math.PI / 2, { ti });
    spots.push({ v: [7.4, -4.4], face: Math.PI / 2 });
    // lounge corner (front right): sofa + coffee table + TV
    const sofa = pickOf(r, ["lounge-sofa", "lounge-design-sofa"]);
    furn(pickOf(r, ["rug-round", "rug-square"]), g, 6.2, 6.0, 0, { ti, s: 5 });
    furn(sofa, g, 8.6, 6.0, -Math.PI / 2, { ti });
    furn("table-coffee", g, 6.2, 6.0, Math.PI / 2, { ti });
    furn("cabinet-television", g, 3.6, 6.0, Math.PI / 2, { ti });
    furn("television-modern", g, 3.6, 6.0, Math.PI / 2, { ti, y: 0.31 * FS, s: 2.8 });
    spots.push({ v: [8.1, 5.0], sit: true, face: -Math.PI / 2, y: 0.25 }, { v: [8.1, 7.0], sit: true, face: -Math.PI / 2, y: 0.25 });
    // decoration: plants, boxes, lamp (by seed)
    furn(pickOf(r, ["potted-plant", "lamp-round-floor", "speaker"]), g, 9.0, -2.7, 0, { ti });
    if (r() < 0.7) { furn("cardboard-box-closed", g, -4.4, 8.8, 0.3, { ti }); furn("cardboard-box-open", g, -3.3, 8.9, -0.2, { ti }); }
    else furn(pickOf(r, ["coat-rack-standing", "lamp-square-floor"]), g, -3.6, 8.9, 0, { ti });
    if (r() < 0.6) furn("bear", g, 6.2, 6.0, Math.PI / 2 + 0.4, { ti, y: 0.23 * FS, s: 2.2 });
    spots.push({ v: [3.6, -3.8] }, { v: [-3.4, 4.4] }, { v: [5.0, 2.2] });
    return spots.map((p) => ({ v: new THREE.Vector3(p.v[0], 0, p.v[1]), sit: !!p.sit, face: p.face ?? Math.PI / 4, y: p.y ?? 0.32 }));
  }

  // ---- the office shows the real state of the project (live props; never merged into the statics)
  // papers on the lead's desk = uncommitted changes, boxes by the door = commits not pushed, the plant = health,
  // the whiteboard = the task board, the printer = today's report. Every one of them is also a button (hotspots).
  const PAPER = new THREE.MeshStandardMaterial({ color: 0xf7f7fb, roughness: 0.9 });
  const CARD = mat(0xc8955c, { roughness: 0.85 }), TAPE = mat(0xe8d3a8, { roughness: 0.7 });
  const POT = mat(0xd9714a, { roughness: 0.8 }), SOIL = mat(0x4a3628, { roughness: 1 });
  const LEAF = new THREE.Color(0x3fbf5a), LEAF_SICK = new THREE.Color(0xa49a4a), LEAF_DRY = new THREE.Color(0x8a6a3a);
  const FLOWER = [new THREE.Color(0xff7aa8), new THREE.Color(0xffd166), new THREE.Color(0xffffff)];
  const PAPER_DESK = 26, PAPER_FLOOR = 44, BOX_MAX = 10;
  const DESK_PAPER = [-5.4 + 1.02, -8.7 - 0.02], FLOOR_PAPER = [-3.55, -7.45], BOXES_AT = [4.3, 8.75], PLANT_AT = [8.75, 2.7];
  // nothing may sit on the middle of a wall (|x| or |z| < 2.4): that is where the doors and the passages to the next room are
  // the inner wall face is at ±9.40 with trim bands out to ±9.10 (measured from room-large.glb); walls are 4.25 high:
  // boards are 0.32 deep boxes from the face to just past the bands
  const BOARD_AT = [-5.4, -9.24], BOARD_Y = 3.0, PRINTER_AT = [-9.05, -7.8];
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function officeProps(g, ti, seed) {
    const o = new THREE.Group(); g.add(o);
    const r = rng(seed ^ 0x51ed);
    // papers: a stack on the lead's desk and, when the desk is full, a pile on the floor next to it
    const sheet = BOX(0.62, 0.022, 0.46);
    const desk = new THREE.InstancedMesh(sheet, PAPER, PAPER_DESK); desk.count = 0; desk.receiveShadow = true; desk.castShadow = true; o.add(desk);
    const floor = new THREE.InstancedMesh(sheet, PAPER, PAPER_FLOOR); floor.count = 0; floor.receiveShadow = true; floor.castShadow = true; o.add(floor);
    const jit = Array.from({ length: PAPER_DESK + PAPER_FLOOR }, () => [r() - 0.5, r() - 0.5, r() - 0.5]);
    // boxes: commits waiting to be pushed, stacked by the front door
    const boxes = new THREE.InstancedMesh(BOX(0.86, 0.66, 0.86), CARD, BOX_MAX); boxes.count = 0; boxes.castShadow = boxes.receiveShadow = true; o.add(boxes);
    const tape = new THREE.InstancedMesh(BOX(0.2, 0.672, 0.872), TAPE, BOX_MAX); tape.count = 0; o.add(tape);
    // the health plant: pot + leaves (instanced) + flowers when the scope is verified
    const plant = new THREE.Group(); plant.position.set(PLANT_AT[0], 0, PLANT_AT[1]); o.add(plant);
    const pot = new THREE.Mesh(geo("pot", () => new THREE.CylinderGeometry(0.42, 0.32, 0.7, 14)), POT); pot.position.y = 0.35; pot.castShadow = true; plant.add(pot);
    const soil = new THREE.Mesh(geo("soil", () => new THREE.CylinderGeometry(0.38, 0.38, 0.04, 14)), SOIL); soil.position.y = 0.69; plant.add(soil);
    const crown = new THREE.Group(); crown.position.y = 0.7; plant.add(crown);
    const leaves = new THREE.InstancedMesh(geo("leaf", () => new THREE.IcosahedronGeometry(0.34, 0)), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7 }), 9);
    leaves.castShadow = true; crown.add(leaves);
    const flowers = new THREE.InstancedMesh(geo("flower", () => new THREE.IcosahedronGeometry(0.15, 0)), new THREE.MeshBasicMaterial({ toneMapped: false }), 6); flowers.count = 0; crown.add(flowers);
    const LEAF_POS = [[0, 0.55, 0], [0.26, 0.38, 0.08], [-0.24, 0.42, -0.06], [0.05, 0.36, 0.27], [-0.06, 0.4, -0.27], [0.18, 0.78, -0.12], [-0.17, 0.82, 0.12], [0.02, 1.02, 0.02], [0.28, 0.62, 0.22]];
    // whiteboard on the back wall: sticky notes per task status (drawn on a canvas, only when the numbers change)
    const bc = document.createElement("canvas"); bc.width = 512; bc.height = 300;
    const btex = new THREE.CanvasTexture(bc); btex.colorSpace = THREE.SRGBColorSpace; btex.anisotropy = 4;
    const board = new THREE.Group(); board.position.set(BOARD_AT[0], 0, BOARD_AT[1]); o.add(board);
    const frame = new THREE.Mesh(BOX(3.5, 2.1, 0.32), M.dark); frame.position.y = BOARD_Y; board.add(frame);
    const face = new THREE.Mesh(geo("boardface", () => new THREE.PlaneGeometry(3.32, 1.94)), new THREE.MeshBasicMaterial({ map: btex, toneMapped: false })); face.position.set(0, BOARD_Y, 0.17); board.add(face);
    const tray = new THREE.Mesh(BOX(2.4, 0.06, 0.18), M.dark); tray.position.set(0, BOARD_Y - 1.08, 0.24); board.add(tray);
    // printer on a stand by the west wall; a sheet sticks out when there is something to report
    const printer = new THREE.Group(); printer.position.set(PRINTER_AT[0], 0, PRINTER_AT[1]); printer.rotation.y = Math.PI / 2; o.add(printer);
    const stand = new THREE.Mesh(BOX(1.3, 0.62, 0.9), mat(THEMES[ti].woodDark)); stand.position.y = 0.31; stand.castShadow = true; printer.add(stand);
    const body = new THREE.Mesh(BOX(1.1, 0.42, 0.78), mat(0xdfe3ee)); body.position.y = 0.83; body.castShadow = true; printer.add(body);
    const lid = new THREE.Mesh(BOX(1.0, 0.06, 0.6), M.dark); lid.position.set(0, 1.07, -0.04); printer.add(lid);
    const out = new THREE.Mesh(BOX(0.6, 0.02, 0.5), PAPER); out.position.set(0, 0.95, 0.5); out.rotation.x = -0.25; out.visible = false; printer.add(out);
    const led = new THREE.Mesh(BOX(0.08, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0x2fd27f, toneMapped: false })); led.position.set(0.42, 0.9, 0.4); printer.add(led);
    // tests: a beacon on the server rack (amber while tests run, red when they fail, green when they pass),
    // a flash over the floor and confetti for a pass
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x3a4060, toneMapped: false });
    const beacon = new THREE.Mesh(geo("beacon", () => new THREE.CylinderGeometry(0.2, 0.24, 0.34, 12)), beaconMat); beacon.position.set(8.4, 3.33, -8.8); o.add(beacon);
    const haloMat = new THREE.SpriteMaterial({ map: haloTex(), color: 0xffb020, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const halo = new THREE.Sprite(haloMat); halo.scale.set(4.6, 4.6, 1); halo.position.set(8.4, 3.4, -8.8); halo.visible = false; o.add(halo);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xff3b55, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const flash = new THREE.Mesh(geo("flash", () => new THREE.PlaneGeometry(ROOM - 1, ROOM - 1)), flashMat); flash.rotation.x = -Math.PI / 2; flash.position.y = 0.14; flash.visible = false; flash.renderOrder = 4; o.add(flash);
    const confetti = new THREE.InstancedMesh(geo("conf", () => new THREE.PlaneGeometry(0.16, 0.26)), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CONF_N);
    confetti.count = 0; confetti.frustumCulled = false; o.add(confetti);
    const tvMat = new THREE.SpriteMaterial({ map: haloTex(), color: 0x6cc6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const tvGlow = new THREE.Sprite(tvMat); tvGlow.position.set(4.3, 1.7, 6.0); tvGlow.scale.setScalar(3.4); tvGlow.visible = false; o.add(tvGlow);
    // payroll board on the west wall above the reviewer's desk; two posters above the back-wall desks (the stack)
    const pc = document.createElement("canvas"); pc.width = 512; pc.height = 360;
    const ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace; ptex.anisotropy = 4;
    const pay = new THREE.Group(); pay.position.set(-9.24, 0, -4.6); pay.rotation.y = Math.PI / 2; o.add(pay);
    const pframe = new THREE.Mesh(BOX(2.9, 2.05, 0.32), mat(THEMES[ti].woodDark)); pframe.position.y = 3.0; pay.add(pframe);
    const pface = new THREE.Mesh(geo("payface", () => new THREE.PlaneGeometry(2.74, 1.9)), new THREE.MeshBasicMaterial({ map: ptex, toneMapped: false })); pface.position.set(0, 3.0, 0.17); pay.add(pface);
    const posters = [-8.55, 4.6].map((x) => {
      const pm = new THREE.MeshBasicMaterial({ toneMapped: false }); const m = new THREE.Mesh(geo("poster", () => new THREE.PlaneGeometry(1.5, 2.0)), pm); m.position.set(x, 3.0, -9.07); m.visible = false; o.add(m);
      const fr = new THREE.Mesh(BOX(1.62, 2.12, 0.3), M.dark); fr.position.set(x, 3.0, -9.23); fr.visible = false; o.add(fr); return { m, fr, key: "" };
    });
    const test = { state: "idle", at: 0, beacon, beaconMat, halo, haloMat, flash, flashMat, confetti, parts: null };
    // neglect: crumpled paper on the floor and cobwebs in the corners pile up when work is left to rot
    const balls = new THREE.InstancedMesh(geo("ball", () => new THREE.IcosahedronGeometry(0.27, 0)), new THREE.MeshStandardMaterial({ color: 0xf4f1e6, flatShading: true, roughness: 1 }), WEAR_BALLS);
    balls.count = 0; balls.castShadow = true; o.add(balls);
    const ballAt = Array.from({ length: WEAR_BALLS }, () => { // free floor away from the desks and the table
      for (;;) { const x = (r() - 0.5) * 15, z = (r() - 0.5) * 15; if (Math.hypot(x + 0.8, z - 1.4) > 3 && Math.abs(z) < 7.2 && x < 7) return [x, z, r() * 6, 0.7 + r() * 0.6]; }
    });
    for (let i = 0; i < WEAR_BALLS; i++) { const [x, z, rot, sc] = ballAt[i]; _m4.compose(_p.set(x, 0.17 * sc, z), _q.setFromEuler(_e.set(rot, rot * 2, 0)), _s.set(sc, sc * 0.8, sc)); balls.setMatrixAt(i, _m4); }
    balls.instanceMatrix.needsUpdate = true;
    const webs = WEB_AT.map(([x, y, z, rz, mx]) => { const w = new THREE.Mesh(geo("web", () => new THREE.PlaneGeometry(3.4, 3.4)), webMat()); w.position.set(x, y, z); w.rotation.set(0, rz, 0); w.scale.x = mx; w.visible = false; o.add(w); return w; });
    const st = { o, desk, floor, jit, boxes, tape, plant, crown, leaves, flowers, LEAF_POS, bc, btex, out, led, test, balls, webs, tvGlow, tvMat, pc, ptex, posters, wear: 0, data: {}, droop: 0, droopGoal: 0, grow: 0.8, growGoal: 0.8 };
    setPlant(st, null); drawBoard(st, null); drawPayroll(st, null);
    return st;
  }
  const WEAR_BALLS = 14;
  // cobwebs: in the corner where the two back walls meet, and high on each back wall
  const WEB_AT = [[-9.04, 2.55, -8.3, Math.PI / 2, -1], [8.3, 2.55, -9.04, 0, -1]]; // top corners of the back walls: x, y, z, facing, mirror (spun from the corner) // on the back walls: x, y, z, facing
  let WEB = null;
  function webMat() {
    if (WEB) return WEB;
    const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
    g.strokeStyle = "rgba(240,244,255,.95)"; g.lineWidth = 3;
    const cx = 0, cy = 0, R = 250; // spun from the top-left corner
    for (let k = 0; k <= 7; k++) { const a = (k / 7) * Math.PI / 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke(); }
    g.lineWidth = 2.2;
    for (let ring = 1; ring <= 7; ring++) {
      const rr = ring * 32; g.beginPath();
      for (let k = 0; k <= 7; k++) { const a = (k / 7) * Math.PI / 2, sag = k % 7 ? 0.9 : 1; const x = cx + Math.cos(a) * rr * sag, y = cy + Math.sin(a) * rr * sag; if (!k) g.moveTo(x, y); else g.quadraticCurveTo(cx + Math.cos(a - Math.PI / 28) * rr * 0.82, cy + Math.sin(a - Math.PI / 28) * rr * 0.82, x, y); }
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    WEB = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 }); return WEB;
  }
  function setWear(st, w) {
    st.wear = w = Math.max(0, Math.min(1, w || 0));
    st.balls.count = Math.round(w * WEAR_BALLS);
    st.webs.forEach((m, i) => { m.visible = w > 0.25 + i * 0.3; });
  }
  const CONF_N = 90, CONF_COLS = [0xff7aa8, 0xffd166, 0x5fd0ff, 0x7bd88f, 0xf6a23a, 0xffffff].map((c) => new THREE.Color(c));
  let HALO = null;
  function haloTex() {
    if (HALO) return HALO;
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); HALO = new THREE.CanvasTexture(c); return HALO;
  }
  const TEST_COL = { running: 0xffb020, fail: 0xff3b55, pass: 0x2fd27f };
  function setTest(st, state) {
    const T = st.test; T.state = state; T.at = performance.now();
    T.beaconMat.color.setHex(TEST_COL[state] ?? 0x3a4060);
    T.haloMat.color.setHex(TEST_COL[state] ?? 0xffffff); T.halo.visible = state !== "idle";
    if (state === "fail") { T.flashMat.color.setHex(0xff3b55); T.flash.visible = true; }
    else if (state === "pass") {
      T.flashMat.color.setHex(0x2fd27f); T.flash.visible = true;
      // confetti from above the meeting table
      const P = T.parts = []; const r = Math.random;
      for (let i = 0; i < CONF_N; i++) {
        P.push({ p: new THREE.Vector3(-0.8 + (r() - 0.5) * 3, 3.2 + r() * 1.2, 1.4 + (r() - 0.5) * 3), v: new THREE.Vector3((r() - 0.5) * 10, 3 + r() * 4, (r() - 0.5) * 10), rot: new THREE.Euler(r() * 6, r() * 6, r() * 6), spin: (r() - 0.5) * 14 });
        T.confetti.setColorAt(i, CONF_COLS[i % CONF_COLS.length]);
      }
      T.confetti.count = CONF_N; T.confetti.instanceColor.needsUpdate = true;
    } else T.flash.visible = false;
  }
  // per frame while something is happening; returns true when anything moved
  function stepTest(st, dt, now) {
    const T = st.test; if (T.state === "idle" && !T.parts) return false;
    const age = (now - T.at) / 1000;
    if (T.state === "running") { const k = 0.55 + 0.45 * Math.sin(age * 9); T.haloMat.opacity = k; T.beacon.rotation.y += dt * 6; }
    else if (T.state === "fail") {
      T.haloMat.opacity = Math.sin(age * 10) > 0 ? 0.95 : 0.15; // flashing
      T.flashMat.opacity = age < 6 ? (0.3 + 0.2 * Math.sin(age * 10)) * (1 - age / 8) : 0; if (age >= 6) T.flash.visible = false;
    } else if (T.state === "pass") {
      T.haloMat.opacity = Math.max(0, 0.9 - age / 20); T.flashMat.opacity = Math.max(0, 0.3 * (1 - age / 1.6)); if (age >= 1.6) T.flash.visible = false;
      if (age > 20) { setTest(st, "idle"); T.halo.visible = false; }
    }
    if (T.parts) {
      for (let i = 0; i < T.parts.length; i++) {
        const q = T.parts[i]; q.v.y -= 9.8 * dt * 0.55; q.v.multiplyScalar(1 - dt * 1.2); q.p.addScaledVector(q.v, dt);
        if (q.p.y < 0.16) { q.p.y = 0.16; q.v.set(0, 0, 0); } else { q.rot.x += q.spin * dt; q.rot.z += q.spin * dt * 0.7; }
        _m4.compose(q.p, _q.setFromEuler(q.p.y <= 0.16 ? _e.set(-Math.PI / 2, 0, q.rot.z) : q.rot), _s.set(1, 1, 1)); T.confetti.setMatrixAt(i, _m4);
      }
      T.confetti.instanceMatrix.needsUpdate = true;
      if (age > 9) { T.parts = null; T.confetti.count = 0; }
    }
    return true;
  }
  function setPapers(st, n) {
    // more changes → a taller stack; 228 changes buries the desk and spills onto the floor
    const sheets = n > 0 ? Math.min(PAPER_DESK + PAPER_FLOOR, 2 + Math.round(Math.sqrt(n) * 4)) : 0;
    const onDesk = Math.min(PAPER_DESK, sheets), onFloor = sheets - onDesk;
    for (let i = 0; i < onDesk; i++) {
      const [a, b, c] = st.jit[i];
      _m4.compose(_p.set(DESK_PAPER[0] + a * 0.08, DESK_H + 0.012 + i * 0.024, DESK_PAPER[1] + b * 0.08), _q.setFromEuler(_e.set(0, c * 0.5, 0)), _s.set(1, 1, 1));
      st.desk.setMatrixAt(i, _m4);
    }
    st.desk.count = onDesk; st.desk.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < onFloor; i++) {
      const [a, b, c] = st.jit[PAPER_DESK + i];
      // a messy pile: wider at the bottom
      const spread = 0.5 * (1 - i / PAPER_FLOOR);
      _m4.compose(_p.set(FLOOR_PAPER[0] + a * spread, 0.012 + i * 0.026, FLOOR_PAPER[1] + b * spread), _q.setFromEuler(_e.set(a * 0.08, c * 2.5, b * 0.08)), _s.set(1, 1, 1));
      st.floor.setMatrixAt(i, _m4);
    }
    st.floor.count = onFloor; st.floor.instanceMatrix.needsUpdate = true;
  }
  function setBoxes(st, n) {
    const k = Math.min(BOX_MAX, n || 0);
    // rows of 4, 3, 2, 1 stacked like a small pyramid
    const rows = [4, 3, 2, 1]; let i = 0;
    for (let row = 0; row < rows.length && i < k; row++) {
      for (let c = 0; c < rows[row] && i < k; c++, i++) {
        const x = BOXES_AT[0] + (c - (rows[row] - 1) / 2) * 0.92, y = 0.33 + row * 0.66, rot = (st.jit[i][0]) * 0.18;
        _m4.compose(_p.set(x, y, BOXES_AT[1]), _q.setFromEuler(_e.set(0, rot, 0)), _s.set(1, 1, 1));
        st.boxes.setMatrixAt(i, _m4); st.tape.setMatrixAt(i, _m4);
      }
    }
    st.boxes.count = st.tape.count = k; st.boxes.instanceMatrix.needsUpdate = st.tape.instanceMatrix.needsUpdate = true;
  }
  // health: ratio 0..1 (verified share of the scope; null = no scope yet), sick: a failed verification or an error
  function setPlant(st, h) {
    const ratio = h?.ratio ?? null, sick = !!h?.sick;
    st.growGoal = 0.75 + 0.55 * (ratio ?? 0.4); st.droopGoal = sick ? 1 : 0;
    const col = sick ? LEAF_DRY : ratio != null && ratio < 0.25 ? LEAF_SICK : LEAF;
    const n = ratio == null ? 6 : 4 + Math.round(ratio * 5);
    for (let i = 0; i < st.LEAF_POS.length; i++) st.leaves.setColorAt(i, col);
    st.leaves.count = n; st.leaves.instanceColor.needsUpdate = true;
    const f = !sick && ratio != null && ratio >= 0.5 ? Math.round((ratio - 0.4) * 10) : 0;
    st.flowers.count = Math.min(6, f);
    for (let i = 0; i < st.flowers.count; i++) { // on the outside of the leaves, where the camera sees them
      const [x, y, z] = st.LEAF_POS[(i * 2 + 1) % st.LEAF_POS.length]; _p.set(x, 0.55, z).normalize().multiplyScalar(0.36);
      _m4.makeTranslation(x + _p.x, y + _p.y, z + _p.z); st.flowers.setMatrixAt(i, _m4); st.flowers.setColorAt(i, FLOWER[i % 3]);
    }
    st.flowers.instanceMatrix.needsUpdate = true; if (st.flowers.instanceColor) st.flowers.instanceColor.needsUpdate = true;
    st.layoutLeaves = true;
  }
  function layoutLeaves(st) {
    const d = st.droop;
    for (let i = 0; i < st.leaves.count; i++) {
      const [x, y, z] = st.LEAF_POS[i];
      // drooping: leaves sink and fall outwards
      _m4.compose(_p.set(x * (1 + d * 0.6), y * (1 - d * 0.45), z * (1 + d * 0.6)), _q.setFromEuler(_e.set(z * d * 1.5, i, -x * d * 1.5)), _s.set(1, 0.7 + (1 - d) * 0.3, 1));
      st.leaves.setMatrixAt(i, _m4);
    }
    st.leaves.instanceMatrix.needsUpdate = true;
    st.crown.scale.setScalar(st.grow);
  }
  // payroll: rows {name, usd}, total, label; money is drawn with the caller's formatting
  function drawPayroll(st, d) {
    const key = JSON.stringify(d || null); if (st.payKey === key) return; st.payKey = key;
    const g = st.pc.getContext("2d"), W = 512, Hh = 360;
    g.fillStyle = "#f7f1e3"; g.fillRect(0, 0, W, Hh); // paper
    g.fillStyle = "#2b2f45"; g.fillRect(0, 0, W, 54);
    g.fillStyle = "#ffd166"; g.font = "800 24px 'Bricolage Grotesque', 'Instrument Sans', system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillText(d?.title || "PAYROLL", 18, 27);
    g.textAlign = "right"; g.fillStyle = "#ffffff"; g.font = "800 26px 'JetBrains Mono', Consolas, monospace"; g.fillText(d?.total || "", W - 18, 27);
    const rows = d?.rows || [];
    if (!rows.length) { g.fillStyle = "#9a9480"; g.font = "600 22px 'Instrument Sans', system-ui, sans-serif"; g.textAlign = "center"; g.fillText(d?.empty || "–", W / 2, 200); st.ptex.needsUpdate = true; return; }
    const max = Math.max(...rows.map((r) => r.usd), 0.0001), rowH = Math.min(68, (Hh - 70) / rows.length);
    rows.forEach((r, i) => {
      const y = 70 + i * rowH;
      g.textAlign = "left"; g.fillStyle = "#2b2f45"; g.font = "700 21px 'Instrument Sans', system-ui, sans-serif"; g.fillText(r.name, 18, y + 16);
      g.fillStyle = "#e3dcc8"; g.fillRect(18, y + 34, W - 36, 14);
      g.fillStyle = r.color || "#f6a23a"; g.fillRect(18, y + 34, Math.max(6, (W - 36) * (r.usd / max)), 14);
      g.textAlign = "right"; g.fillStyle = "#2b2f45"; g.font = "800 21px 'JetBrains Mono', Consolas, monospace"; g.fillText(r.money, W - 18, y + 16);
    });
    st.ptex.needsUpdate = true;
  }
  // a poster per technology: a plain, original design (colour, a short glyph, the name) — no logos
  const POSTER = {
    angular: ["#c3002f", "A", "Angular"], react: ["#20232a", "⚛", "React"], next: ["#111111", "N", "Next.js"], vue: ["#35495e", "V", "Vue"], svelte: ["#ff3e00", "S", "Svelte"],
    nest: ["#e0234e", "N", "NestJS"], node: ["#3c873a", "JS", "Node"], typescript: ["#3178c6", "TS", "TypeScript"], three: ["#1b1b1b", "3D", "three.js"], electron: ["#2b2e3b", "e", "Electron"],
    reactnative: ["#61dafb", "RN", "React Native"], dotnet: ["#512bd4", ".NET", "C# / .NET"], godot: ["#478cbf", "G", "Godot"], php: ["#4f5b93", "php", "PHP"], python: ["#3572a5", "Py", "Python"],
    go: ["#00add8", "Go", "Go"], rust: ["#b7410e", "Rs", "Rust"], flutter: ["#02569b", "F", "Flutter"], android: ["#3ddc84", "A", "Android"], chrome: ["#4285f4", "⊕", "Extension"], docker: ["#2496ed", "▣", "Docker"],
  };
  const posterTex = new Map();
  function posterTexture(key) {
    if (posterTex.has(key)) return posterTex.get(key);
    const [bg, glyph, name] = POSTER[key] || ["#555", "?", key];
    const c = document.createElement("canvas"); c.width = 192; c.height = 256; const g = c.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, 192, 256);
    g.fillStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.arc(96, 110, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `900 ${glyph.length > 2 ? 54 : 84}px 'Bricolage Grotesque', 'Instrument Sans', system-ui, sans-serif`; g.fillText(glyph, 96, 112);
    g.fillStyle = "#ffffff"; g.fillRect(0, 196, 192, 60); g.fillStyle = bg; g.font = "800 24px 'Instrument Sans', system-ui, sans-serif"; g.fillText(name, 96, 226);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; posterTex.set(key, t); return t;
  }
  function setPosters(st, stack) {
    st.posters.forEach((p, i) => { const k = (stack || [])[i]; p.m.visible = p.fr.visible = !!k; if (k && k !== p.key) { p.key = k; p.m.material.map = posterTexture(k); p.m.material.needsUpdate = true; } });
  }
  function drawBoard(st, tasks) {
    const key = JSON.stringify(tasks || null); if (st.boardKey === key) return; st.boardKey = key;
    const g = st.bc.getContext("2d"), W = 512, Hh = 300;
    g.fillStyle = "#f4f6fb"; g.fillRect(0, 0, W, Hh);
    g.strokeStyle = "#d5dae6"; g.lineWidth = 2;
    for (const x of [W / 3, (2 * W) / 3]) { g.beginPath(); g.moveTo(x, 18); g.lineTo(x, Hh - 14); g.stroke(); }
    const cols = [["todo", "#ffd166"], ["doing", "#6cc6ff"], ["done", "#7bd88f"]];
    g.textAlign = "center"; g.textBaseline = "middle";
    cols.forEach(([k, color], ci) => {
      const cx = W / 6 + (ci * W) / 3, n = tasks ? (tasks[k] || 0) + (k === "todo" ? tasks.blocked || 0 : 0) : 0;
      g.fillStyle = "#3a4258"; g.font = "700 26px 'Instrument Sans', Segoe UI, system-ui, sans-serif";
      g.fillText(boardLabels[ci] || k, cx, 30);
      // up to 6 notes per column, then a "+n"
      const shown = Math.min(6, n);
      for (let i = 0; i < shown; i++) {
        const x = cx - 50 + (i % 2) * 58, y = 62 + Math.floor(i / 2) * 64, rot = (((i * 37 + ci * 11) % 9) - 4) * 0.02;
        g.save(); g.translate(x + 23, y + 25); g.rotate(rot);
        g.fillStyle = color; g.fillRect(-23, -25, 46, 50);
        g.fillStyle = "rgba(0,0,0,.18)"; for (let l = 0; l < 3; l++) g.fillRect(-15, -14 + l * 11, 30 - l * 6, 3);
        g.restore();
      }
      if (n > 6) { g.fillStyle = "#3a4258"; g.font = "800 30px 'Instrument Sans', Segoe UI, system-ui, sans-serif"; g.fillText("+" + (n - 6), cx, Hh - 26); }
      if (!n) { g.fillStyle = "#b5bccc"; g.font = "600 40px 'Instrument Sans', Segoe UI, system-ui, sans-serif"; g.fillText("–", cx, 140); }
    });
    if (tasks?.blocked) { g.fillStyle = "#e5484d"; g.beginPath(); g.arc(W / 3 - 22, 30, 12, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.font = "800 18px system-ui"; g.fillText("!", W / 3 - 22, 31); }
    st.btex.needsUpdate = true;
  }
  // the room as buttons: local box hit areas (x, y, z: centre; hx/hz: half size on the ground at height y)
  const HOT = [
    { kind: "board", x: BOARD_AT[0], y: BOARD_Y, z: BOARD_AT[1] + 0.2, hx: 1.9, hz: 1.1 },
    { kind: "printer", x: PRINTER_AT[0], y: 0.9, z: PRINTER_AT[1], hx: 0.75, hz: 0.85 },
    { kind: "docs", x: -8.75, y: 1.3, z: 3.2, hx: 0.75, hz: 1.2 }, { kind: "docs", x: -8.75, y: 1.3, z: 7.6, hx: 0.75, hz: 1.2 },
    { kind: "coffee", x: 8.9, y: 1.35, z: -4.2, hx: 0.7, hz: 0.75 },
    { kind: "rack", x: 8.4, y: 1.6, z: -8.8, hx: 1.05, hz: 0.75 },
    { kind: "git", x: DESK_PAPER[0], y: DESK_H + 0.3, z: DESK_PAPER[1], hx: 0.5, hz: 0.45, when: (u) => u.office.desk.count > 0 },
    { kind: "git", x: FLOOR_PAPER[0], y: 0.4, z: FLOOR_PAPER[1], hx: 0.75, hz: 0.75, when: (u) => u.office.floor.count > 0 },
    { kind: "git", x: BOXES_AT[0], y: 0.6, z: BOXES_AT[1], hx: 1.9, hz: 0.75, when: (u) => u.office.boxes.count > 0 },
    { kind: "plant", x: PLANT_AT[0], y: 1.0, z: PLANT_AT[1], hx: 0.7, hz: 0.7 },
    { kind: "tv", x: 3.6, y: 1.55, z: 6.0, hx: 0.55, hz: 1.25 },
    { kind: "payroll", x: -9.1, y: 3.0, z: -4.6, hx: 0.5, hz: 1.5 },
    { kind: "wear", x: -8.9, y: 3.0, z: -8.3, hx: 0.9, hz: 1.5, when: (u) => u.office.wear > 0.25 },
    // the monitors: click to lean in and read what is on them
    ...["dev", "tester", "reviewer"].map((role) => { const d = STATIONS[role].desk; return { kind: "screen:" + role, x: d[0], y: DESK_H + 0.55, z: d[1], hx: STATIONS[role].ry ? 0.55 : 0.62, hz: STATIONS[role].ry ? 0.62 : 0.55 }; }),
  ];
  // the waiting line for permission: inside the front door, facing the camera
  const QUEUE = [0, 1, 2, 3].map((k) => new THREE.Vector3(-1.4 - k * 1.25, 0, 7.9));

  // ---- night: warm halos over the lamps, a cool glow in front of the screens of members at work
  const lampHaloMat = new THREE.SpriteMaterial({ color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  function nightLights(g, lamps, screens) {
    const grp = new THREE.Group(); g.add(grp); grp.visible = night > 0.3;
    lampHaloMat.map = haloTex();
    for (const [x, y, z] of lamps) { const h = new THREE.Sprite(lampHaloMat); h.position.set(x, y, z); h.scale.setScalar(y > 2 ? 3.4 : 2.4); grp.add(h); }
    const glows = [];
    for (const sc of screens) {
      const m = new THREE.SpriteMaterial({ map: haloTex(), color: 0x6cc6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const h = new THREE.Sprite(m); h.position.set(sc.x, DESK_H + 0.75, sc.z); h.scale.setScalar(2.6); grp.add(h);
      glows.push({ role: sc.role, mat: m });
    }
    return { grp, glows };
  }
  // the light of the hour: 1 = day, 0 = night (dusk and dawn in between, with a warm sunset tint)
  let night = 0; // 0 day … 1 night
  const DAY_HEMI = new THREE.Color(0xdfe6ff), NIGHT_HEMI = new THREE.Color(0x5966b8), DAY_SUN = new THREE.Color(0xfff4e0), NIGHT_SUN = new THREE.Color(0x8fa2ff), DUSK_SUN = new THREE.Color(0xff9d5c);
  function daylight(hour) {
    const h = ((hour % 24) + 24) % 24;
    const k = h >= 7.5 && h < 17 ? 1 : h >= 17 && h < 20 ? 1 - (h - 17) / 3 : h >= 5.5 && h < 7.5 ? (h - 5.5) / 2 : 0;
    const dusk = Math.max(0, 1 - Math.abs(k - 0.5) * 2) * (h > 12 ? 1 : 0.6); // strongest half way through the change
    night = 1 - k;
    hemi.intensity = 0.85 + 0.75 * k; hemi.color.copy(NIGHT_HEMI).lerp(DAY_HEMI, k);
    sun.intensity = 0.6 + 1.8 * k; sun.color.copy(NIGHT_SUN).lerp(DAY_SUN, k).lerp(DUSK_SUN, dusk * 0.8);
    lampHaloMat.opacity = Math.max(0, night - 0.25) * 0.75;
    for (const g of modules.values()) if (g.userData.night) g.userData.night.grp.visible = night > 0.3;
    renderer.shadowMap.needsUpdate = true;
    return { k, dusk };
  }

  // ---- live screens: what the member is really doing (code being written, the command and its output)
  const LIVE = new Map(); // screen material → { c, tex }
  const SCR_W = 384, SCR_H = 233; // same aspect as the display panel (0.372 × 0.226)
  function liveScreen(mat) {
    let L = LIVE.get(mat);
    if (!L) { const c = document.createElement("canvas"); c.width = SCR_W; c.height = SCR_H; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; mat.map = tex; mat.needsUpdate = true; L = { c, tex }; LIVE.set(mat, L); }
    return L;
  }
  function codeLine(g, text, x, y) {
    // a light highlight: strings, comments, keywords
    const s = String(text).replace(/\t/g, "  ").slice(0, 46);
    const cm = s.search(/(\/\/|#(?!include)|--\s)/);
    const code = cm >= 0 ? s.slice(0, cm) : s, comment = cm >= 0 ? s.slice(cm) : "";
    const parts = []; let last = 0;
    code.replace(/("[^"]*"?|'[^']*'?|`[^`]*`?)|\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|public|private|protected|static|void|new|def|using|namespace|interface|type|enum|readonly|string|int|bool|true|false|null|this)\b/g, (m, str, kw, i) => {
      if (i > last) parts.push([code.slice(last, i), "#dfe6f5"]); parts.push([m, str ? "#ffc66b" : "#6cc6ff"]); last = i + m.length; return m;
    });
    if (last < code.length) parts.push([code.slice(last), "#dfe6f5"]);
    if (comment) parts.push([comment, "#7d86a3"]);
    let cx = x; for (const [tx, col] of parts) { g.fillStyle = col; g.fillText(tx, cx, y); cx += g.measureText(tx).width; }
  }
  // output colouring: "Failed: 0" is not a failure
  const lineColor = (l) => /\bfail(ed|ure|ing|s)?\b(?![:=]?\s*0\b)|\berror\b|✗|✕|×/i.test(l) ? "#ff6b81" : /\bpass(ed|es)?\b|\bok\b|✓|✔|success/i.test(l) ? "#7bd88f" : "#aab3cc";
  function drawScreen(mat, d) {
    const { c, tex } = liveScreen(mat), g = c.getContext("2d");
    g.fillStyle = d.kind === "term" ? "#0a0e18" : "#0e1424"; g.fillRect(0, 0, SCR_W, SCR_H);
    // title bar
    g.fillStyle = d.kind === "term" ? "#151b2c" : "#1b2238"; g.fillRect(0, 0, SCR_W, 34);
    g.fillStyle = d.kind === "term" ? "#2fd27f" : "#f6a23a"; g.beginPath(); g.arc(16, 17, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ffffff"; g.font = "700 19px 'JetBrains Mono', Consolas, monospace"; g.textBaseline = "middle";
    g.fillText(String(d.title || "").slice(0, 28), 30, 18);
    g.font = "500 16px 'JetBrains Mono', Consolas, monospace";
    const lines = d.lines || [];
    if (d.kind === "term") {
      let y = 54;
      if (d.cmd) { g.fillStyle = "#2fd27f"; g.fillText("$", 10, y); g.fillStyle = "#ffffff"; g.fillText(String(d.cmd).replace(/\s+/g, " ").slice(0, 40), 28, y); y += 22; }
      for (const l of lines.slice(-((d.ok == null ? 7 : 6) - (d.cmd ? 1 : 0)))) { g.fillStyle = lineColor(l); g.fillText(String(l).slice(0, 42), 10, y); y += 22; }
      if (d.ok != null) { g.fillStyle = d.ok ? "#2fd27f" : "#ff4d6a"; g.fillRect(0, SCR_H - 30, SCR_W, 30); g.fillStyle = "#0a0e18"; g.font = "800 17px 'JetBrains Mono', Consolas, monospace"; g.fillText(d.ok ? "✓ OK" : "✗ FAILED", 12, SCR_H - 15); }
      else { g.fillStyle = "#ffffff"; g.fillRect(28, Math.min(y, SCR_H - 30) - 9, 10, 18); } // cursor
    } else {
      lines.slice(0, 8).forEach((l, i) => { const y = 54 + i * 22; g.fillStyle = "#4a5372"; g.fillText(String(i + 1).padStart(2), 6, y); codeLine(g, l, 36, y); });
      if (!lines.length) { g.fillStyle = "#4a5372"; for (let i = 0; i < 6; i++) g.fillRect(36, 48 + i * 22, 60 + ((i * 97) % 220), 8); }
    }
    tex.needsUpdate = true; LIVE.get(mat).drawn = true;
  }
  // a readable copy of a desk's screen in the corner of the stage (the 3D monitor is small and at an angle)
  const peek = document.createElement("div"); peek.className = "screen-peek"; peek.hidden = true;
  peek.innerHTML = `<div class="sp-head"><b></b><button type="button" class="sp-x" aria-label="×">×</button></div>`;
  canvas.parentElement.append(peek);
  peek.querySelector(".sp-x").onclick = () => closePeek();
  let peekAt = null;
  function closePeek() { peek.hidden = true; peekAt = null; peek.querySelectorAll("canvas").forEach((c) => c.remove()); }
  function peekScreen(g, role, m) {
    closePeek();
    const list = g.userData.screens[role] || []; if (!list.length) return;
    peek.querySelector("b").textContent = `${g.userData.name} · ${m?.name && peekLabel ? peekLabel(m.id) : role}`;
    for (const sm of list) { const L = liveScreen(sm); if (!LIVE.get(sm).drawn) drawScreen(sm, { kind: "code", title: "", lines: [] }); peek.append(L.c); }
    peek.hidden = false; peekAt = { zoomMax: 9 };
  }
  function setScreen(id, d) {
    const g = moduleOf(id); const m = g?.userData.members.get(id); if (!m) return;
    const list = g.userData.screens[m.role] || []; if (!list.length) return;
    // the developer has two monitors: code on the left, the terminal on the right
    drawScreen(list[d.kind === "term" && list.length > 1 ? 1 : 0], d);
  }

  // ---- the office cat: one per station; goes where attention is needed (a member waiting for permission, a room
  // whose tests broke, an error), sits next to the member who needs you; with nothing going on it naps on a rug.
  // Clicking it takes you there.
  const CAT = { fur: mat(0xf29a4a, { roughness: 0.85 }), dark: mat(0xc96b28, { roughness: 0.85 }), white: mat(0xfff4e6, { roughness: 0.9 }), eye: mat(0x1b1f2e), nose: mat(0xff8fa8) };
  function buildCat() {
    const root = new THREE.Group(); root.visible = false; scene.add(root);
    const body = new THREE.Group(); root.add(body);
    const box = (w, h, d, m, x, y, z, parent = body) => { const o = new THREE.Mesh(BOX(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    box(0.56, 0.44, 0.98, CAT.fur, 0, 0.6, 0); box(0.5, 0.06, 0.4, CAT.dark, 0, 0.83, 0.05); box(0.46, 0.06, 0.24, CAT.dark, 0, 0.83, -0.32); // body + stripes
    box(0.4, 0.16, 0.5, CAT.white, 0, 0.42, 0.12); // belly
    const head = new THREE.Group(); head.position.set(0, 0.95, 0.52); body.add(head);
    box(0.56, 0.5, 0.48, CAT.fur, 0, 0, 0, head); box(0.34, 0.2, 0.1, CAT.white, 0, -0.1, 0.26, head);
    box(0.14, 0.16, 0.1, CAT.fur, -0.18, 0.32, 0, head); box(0.14, 0.16, 0.1, CAT.fur, 0.18, 0.32, 0, head);
    box(0.08, 0.1, 0.06, CAT.nose, -0.18, 0.31, 0.04, head); box(0.08, 0.1, 0.06, CAT.nose, 0.18, 0.31, 0.04, head);
    const eyes = [box(0.09, 0.11, 0.04, CAT.eye, -0.13, 0.05, 0.25, head), box(0.09, 0.11, 0.04, CAT.eye, 0.13, 0.05, 0.25, head)];
    box(0.08, 0.06, 0.04, CAT.nose, 0, -0.04, 0.32, head);
    const legs = [[-0.17, 0.32], [0.17, 0.32], [-0.17, -0.34], [0.17, -0.34]].map(([x, z]) => { const p = new THREE.Group(); p.position.set(x, 0.42, z); body.add(p); box(0.15, 0.42, 0.15, CAT.fur, 0, -0.21, 0, p); box(0.16, 0.06, 0.18, CAT.white, 0, -0.4, 0.01, p); return p; });
    const tail = new THREE.Group(); tail.position.set(0, 0.74, -0.47); body.add(tail);
    box(0.12, 0.12, 0.62, CAT.fur, 0, 0.18, -0.24, tail).rotation.x = -0.9; box(0.13, 0.13, 0.2, CAT.dark, 0, 0.44, -0.4, tail).rotation.x = -0.9;
    const zz = new THREE.Sprite(zzMat()); zz.scale.set(0.9, 0.9, 1); zz.renderOrder = 12; zz.visible = false; root.add(zz); zz.position.set(0.2, 1.7, 0);
    const alert = new THREE.Sprite(signMat()); alert.scale.set(0.75, 0.75, 1); alert.renderOrder = 12; alert.visible = false; root.add(alert); alert.position.set(0, 2.1, 0);
    return { root, body, head, legs, tail, eyes, zz, alert, room: null, pos: new THREE.Vector3(), yaw: 0, fade: 0, phase: "in", focus: null, mode: "sleep", t0: Math.random() * 10 };
  }
  let ZZ = null;
  function zzMat() {
    if (ZZ) return ZZ;
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.strokeStyle = "#2f5bea"; g.lineWidth = 6; g.font = "900 54px 'Bricolage Grotesque', system-ui, sans-serif"; g.textBaseline = "middle";
    g.strokeText("z", 20, 86); g.fillText("z", 20, 86); g.font = "900 72px 'Bricolage Grotesque', system-ui, sans-serif"; g.strokeText("Z", 58, 44); g.fillText("Z", 58, 44);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; ZZ = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }); return ZZ;
  }
  let cat = null;
  const CAT_NAP = new THREE.Vector3(5.0, 0.04, 4.1), CAT_DOOR = new THREE.Vector3(3.2, 0, 8.2), _cg = new THREE.Vector3(), _cd = new THREE.Vector3();
  // focus: { teamId, memberId | null, alert }  (null = nap in the first room)
  function setCatFocus(f) {
    if (!cat) cat = buildCat();
    if (!modules.size) { cat.focus = f; return; } // placed once the rooms exist (setAgents)
    const room = f?.teamId && modules.has(f.teamId) ? f.teamId : modules.keys().next().value;
    cat.focus = f && modules.has(f.teamId) ? f : null; cat.mode = cat.focus ? "go" : "sleep";
    if (room !== cat.room) { if (cat.room) cat.phase = "out"; else { cat.room = room; cat.phase = "in"; cat.pos.copy(CAT_NAP); cat.fade = 0; } cat.next = room; }
    cat.root.visible = true; hot = Math.max(hot, performance.now() + 2000);
  }
  function stepCat(dt, t) { // returns true while the cat moves (the shadows need an update then)
    if (!cat || !cat.room) return false;
    const g = modules.get(cat.room); if (!g) { cat.room = null; return false; }
    const c = cat;
    // between rooms: shrink away, reappear at the other room's door
    if (c.phase === "out") { c.fade = Math.max(0, c.fade - dt * 3); if (!c.fade) { c.room = c.next; c.pos.copy(CAT_DOOR); c.phase = "in"; } }
    else if (c.phase === "in") { c.fade = Math.min(1, c.fade + dt * 3); if (c.fade >= 1) c.phase = "here"; }
    const u = modules.get(c.room)?.userData; if (!u) return false;
    let goal = CAT_NAP, sleeping = false, look = null;
    const m = c.focus?.memberId ? u.members.get(c.focus.memberId) : null;
    if (c.focus && m) { _cg.copy(m.cur).add(_cd.set(0.95, 0, 0.75)); goal = _cg; look = m.cur; }
    else if (c.focus) { goal = _cg.set(7.2, 0, -7.4); look = _cd.set(8.4, 0, -8.8); } // the server rack (failing tests)
    else sleeping = true;
    _cd.subVectors(goal, c.pos); _cd.y = 0; const dist = _cd.length();
    const walking = c.phase !== "out" && dist > 0.12;
    if (walking) { c.pos.addScaledVector(_cd.normalize(), Math.min(dist, 3.6 * dt)); c.yaw = angLerp(c.yaw, Math.atan2(_cd.x, _cd.z), Math.min(1, dt * 8)); }
    else if (look) c.yaw = angLerp(c.yaw, Math.atan2(look.x - c.pos.x, look.z - c.pos.z), Math.min(1, dt * 6));
    const tt = t + c.t0, nap = sleeping && !walking;
    c.root.position.set(g.position.x + c.pos.x, g.position.y + (nap ? 0.04 : 0), g.position.z + c.pos.z);
    c.root.rotation.y = c.yaw; c.root.scale.setScalar(Math.max(0.001, c.fade) * 1.2);
    // pose: walking legs, sitting (hind legs folded), napping (lying, tail curled, eyes closed)
    c.legs.forEach((p, i) => { p.rotation.x = walking ? Math.sin(tt * 12 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6 : 0; });
    c.body.position.y = nap ? -0.36 : walking ? Math.abs(Math.sin(tt * 12)) * 0.05 : 0;
    c.body.rotation.x = !walking && !nap ? -0.32 : 0; // sitting up
    c.legs[2].visible = c.legs[3].visible = !nap; c.legs[0].visible = c.legs[1].visible = !nap;
    c.tail.rotation.y = Math.sin(tt * (c.focus ? 6 : 1.5)) * (nap ? 0.25 : 0.6); c.tail.rotation.x = nap ? 0.85 : 0;
    c.head.rotation.x = nap ? 0.35 : 0; c.head.rotation.y = !walking && !nap ? Math.sin(tt * 0.7) * 0.4 : 0;
    for (const e of c.eyes) e.scale.y = nap ? 0.2 : (Math.sin(tt * 1.3) > 0.985 ? 0.15 : 1); // blinks
    c.zz.visible = nap; if (nap) c.zz.position.y = 1.1 + (tt % 2) * 0.25;
    c.alert.visible = !!c.focus?.alert && !walking && c.phase === "here"; if (c.alert.visible) c.alert.position.y = 2.0 + Math.abs(Math.sin(tt * 4)) * 0.18;
    return walking || c.phase !== "here";
  }
  function catHit(ev) {
    if (!cat?.root.visible || !cat.room || cat.phase === "out") return false;
    _hp.constant = -0.6; if (!ray.ray.intersectPlane(_hp, _hv)) return false;
    return Math.hypot(_hv.x - cat.root.position.x, _hv.z - cat.root.position.z) < 0.85;
  }

  // ---- merge static parts by material: ~30 draw calls per room instead of ~200
  const _inv = new THREE.Matrix4(), _mm = new THREE.Matrix4();
  function mergeStatics(root) {
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const groups = new Map(), victims = [];
    root.traverse((o) => {
      if (!o.isMesh || o.userData.keep || o.isSkinnedMesh) return;
      const gm = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(gm.attributes)) if (!["position", "normal", "uv"].includes(k)) gm.deleteAttribute(k);
      gm.applyMatrix4(_mm.multiplyMatrices(_inv, o.matrixWorld));
      const key = o.material.uuid + "|" + Object.keys(gm.attributes).sort().join(",") + "|" + o.castShadow;
      if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, list: [] });
      groups.get(key).list.push(gm); victims.push(o);
    });
    for (const o of victims) o.parent.remove(o);
    const out = [];
    for (const { mat, cast, list } of groups.values()) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const gm of list) gm.dispose();
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat); m.castShadow = cast; m.receiveShadow = true;
      root.add(m); out.push(merged);
    }
    return out;
  }

  // ---- label and bubble (canvas textures; redrawn only when the content changes)
  function labelSprite(text) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 96;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(9.6, 1.8, 1); s.renderOrder = 12; // the room name is always above the bubbles
    let label = text, lastState = null;
    s.userData.draw = (state, force = false) => { // true: selected, "target": drop target
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
    s.scale.set(7.2, 1.08, 1); s.renderOrder = 11; s.visible = false;
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
    return { sprite: s, set, redraw: () => shown && set(shown, true), get text() { return shown; } };
  }

  // a speech bubble: the first words of a member's reply, for a few seconds (two lines, comic style)
  function makeSpeech() {
    const c = document.createElement("canvas"); c.width = 720; c.height = 190;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); sp.scale.set(7.2, 1.9, 1); sp.renderOrder = 14; sp.visible = false;
    const wrap = (g, text, w) => {
      const words = String(text).split(/\s+/), lines = []; let cur = "";
      for (const wd of words) { const tr = cur ? cur + " " + wd : wd; if (g.measureText(tr).width > w && cur) { lines.push(cur); cur = wd; if (lines.length === 2) break; } else cur = tr; }
      if (lines.length < 2 && cur) lines.push(cur);
      if (lines.length === 2 && (words.join(" ").length > lines.join(" ").length + 1)) { let l = lines[1]; while (g.measureText(l + "…").width > w && l.length) l = l.slice(0, -1); lines[1] = l + "…"; }
      return lines;
    };
    return {
      sprite: sp, until: 0,
      say(text) {
        const g = c.getContext("2d"); g.clearRect(0, 0, 720, 190);
        g.font = "600 38px 'Instrument Sans', Segoe UI, system-ui, sans-serif";
        const lines = wrap(g, text, 640), w = Math.min(700, Math.max(...lines.map((l) => g.measureText(l).width)) + 56), h = 30 + lines.length * 46, x0 = (720 - w) / 2;
        g.fillStyle = "#ffffff"; g.strokeStyle = "#172033"; g.lineWidth = 5;
        g.beginPath(); g.roundRect(x0, 6, w, h, 26); g.moveTo(352, h + 4); g.lineTo(372, h + 34); g.lineTo(386, h + 4); g.fill(); g.stroke();
        g.fillStyle = "#ffffff"; g.fillRect(350, h - 2, 40, 10); // hide the stroke where the tail joins
        g.fillStyle = "#172033"; g.textBaseline = "middle"; g.textAlign = "left";
        lines.forEach((l, i) => g.fillText(l, x0 + 28, 6 + 34 + i * 46));
        tex.needsUpdate = true; sp.visible = true; this.until = performance.now() + 7000;
      },
    };
  }
  // the "!" over a member waiting for permission (one shared texture)
  let SIGN = null;
  function signMat() {
    if (SIGN) return SIGN;
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    g.fillStyle = "#f6a23a"; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 8; g.stroke();
    g.fillStyle = "#2a1600"; g.font = "900 84px 'Bricolage Grotesque', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("!", 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    SIGN = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }); return SIGN;
  }

  // a document over the head of a member carrying a task or a result (visible from every side, unlike something held)
  let DOC = null;
  function docMat() {
    if (DOC) return DOC;
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#2f5bea"; g.lineWidth = 7; g.stroke();
    g.fillStyle = "#ffe08a"; g.strokeStyle = "#c8731a"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(38, 30); g.lineTo(76, 30); g.lineTo(92, 46); g.lineTo(92, 98); g.lineTo(38, 98); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#c8731a"; for (let i = 0; i < 4; i++) g.fillRect(47, 52 + i * 11, i === 3 ? 22 : 36, 4);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    DOC = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }); return DOC;
  }

  // ---- character (animated)
  function makeCharacter(look, holder) {
    const wrap = new THREE.Group(); holder.add(wrap);
    const state = { wrap, mixer: null, actions: {}, current: null, ts: 0.88 + Math.random() * 0.24 }; // every character at a slightly different tempo
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
    next.reset().setEffectiveWeight(1); next.timeScale = st.ts;
    if (name === "idle" || name === "sit") next.time = Math.random() * next.getClip().duration; // so they do not breathe in sync
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.25, false);
    st.current = name;
  }

  // ---- module = project room (built once; afterwards only its slot/name/doors/members are updated)
  const H = ROOM / 2;
  const DOORS = [["E", H, 0, Math.PI / 2], ["W", -H, 0, Math.PI / 2], ["S", 0, H, 0], ["N", 0, -H, 0]];
  const ringGeo = () => geo("ring", () => new THREE.RingGeometry(0.85, 1.1, 32));
  function buildModule(teamId, lead, index) {
    const g = new THREE.Group();
    const home = slotPos(index);
    g.position.copy(home); scene.add(g);
    const cut = { planes: makePlanes(), cache: new Map() };
    setPlanes(cut.planes, home.x, 0, home.z);
    const seed = hash(teamId), r = rng(seed), ti = seed % THEMES.length;
    g.userData = { teamId, home, cut, ti, lastX: home.x, lastY: 0, lastZ: home.z, doorKey: null, members: new Map(), screens: {}, name: lead.name };

    const statics = new THREE.Group(); g.add(statics);
    placeKit("room-large", 0, 0, 0, statics, cut);
    const cab = placeKit("cables", -1.5, -8.6, 0, statics); if (cab) { cab.scale.setScalar(1.2); cab.updateMatrix(); }
    const look = Number.isInteger(lead.char) ? lead.char : index;
    // all four corners are always built (empty desks show the team can grow)
    buildLamps = []; buildScreens = [];
    for (const role of Object.keys(STATIONS)) g.userData.screens[role] = station(role, statics, look + ROLE_ORDER[role], ti, r).screens;
    const accent = mat(THEMES[ti].red);
    g.userData.leds = rack(statics, 8.4, -8.8, 0, accent);
    g.userData.spots = commons(statics, ti, r);
    g.userData.night = nightLights(g, buildLamps, buildScreens); buildLamps = buildScreens = null;
    g.userData.merged = mergeStatics(statics);
    freeze(statics);
    g.userData.office = officeProps(g, ti, seed);

    const doors = new THREE.Group(); g.add(doors);
    const label = labelSprite(lead.name); label.position.set(-2.5, 10.5, -2.5); g.add(label);
    const ring = new THREE.Mesh(ringGeo(), new THREE.MeshBasicMaterial({ color: 0x5b8cff, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.visible = false; g.add(ring);
    Object.assign(g.userData, { doors, label, ring });
    return g;
  }
  // team member: its own character, status marker and bubble
  function addMember(g, a) {
    const role = STATIONS[a.role] ? a.role : "dev";
    const st = STATIONS[role];
    const pbMat = new THREE.MeshStandardMaterial({ color: STATUS_COLOR.idle, emissive: STATUS_COLOR.idle, emissiveIntensity: 1, flatShading: true });
    const plumb = new THREE.Mesh(geo("plumb", () => new THREE.OctahedronGeometry(0.36)), pbMat); plumb.scale.y = 1.5; g.add(plumb);
    const bubble = makeBubble(); g.add(bubble.sprite); bubble.set(activities.get(a.id) || "");
    const sign = new THREE.Sprite(signMat()); sign.scale.set(1.3, 1.3, 1); sign.renderOrder = 13; sign.visible = false; g.add(sign);
    const speech = makeSpeech(); g.add(speech.sprite);
    const folder = new THREE.Sprite(docMat()); folder.scale.set(1.25, 1.25, 1); folder.renderOrder = 13; folder.visible = false; g.add(folder); // the task / result being carried
    const look = Number.isInteger(a.char) ? a.char : 0;
    const ch = makeCharacter(look, g);
    const seat = new THREE.Vector3(st.seat[0], 0, st.seat[1]);
    const m = {
      id: a.id, role, ch, plumb, pbMat, bubble, sign, folder, speech, seat, face: st.face, waiting: attention.has(a.id),
      cur: seat.clone().add(new THREE.Vector3(1.2, 0, 1.2)), yaw: 0, t0: Math.random() * 20,
      spot: -1, dwellUntil: 0, speed: 3.0 + Math.random() * 1.3, errand: null, // everyone wanders at their own pace
      status: statuses.get(a.id) || a.status || "idle", statusAt: 0,
    };
    g.userData.members.set(a.id, m); memberTeam.set(a.id, g.userData.teamId);
    return m;
  }
  function removeMember(g, id) {
    const m = g.userData.members.get(id); if (!m) return;
    m.ch.mixer?.stopAllAction(); g.remove(m.ch.wrap, m.plumb, m.bubble.sprite, m.sign, m.folder, m.speech.sprite);
    m.speech.sprite.material.map.dispose(); m.speech.sprite.material.dispose();
    m.pbMat.dispose(); m.bubble.sprite.material.map.dispose(); m.bubble.sprite.material.dispose();
    g.userData.members.delete(id); memberTeam.delete(id);
  }
  function setDoors(g, flags) {
    const key = DOORS.map(([s]) => (flags[s] ? 1 : 0)).join("");
    if (g.userData.doorKey === key) return;
    g.userData.doorKey = key;
    const holder = g.userData.doors;
    while (holder.children.length) holder.remove(holder.children[0]);
    for (const [side, x, z, r] of DOORS) if (!flags[side]) placeKit(side === "N" || side === "W" ? "gate-door-window" : "gate-door", x, z, r, holder, g.userData.cut);
  }
  function disposeModule(g) {
    scene.remove(g);
    for (const id of [...g.userData.members.keys()]) removeMember(g, id);
    for (const m of g.userData.cut.cache.values()) m.dispose();
    g.userData.label.material.map.dispose(); g.userData.label.material.dispose(); g.userData.ring.material.dispose();
    for (const list of Object.values(g.userData.screens)) for (const s of list) s.dispose();
    g.userData.leds.material.dispose(); g.userData.leds.dispose();
    for (const gm of g.userData.merged) gm.dispose();
    const of = g.userData.office; of.btex.dispose(); of.leaves.material.dispose(); of.flowers.material.dispose(); of.led.material.dispose();
    for (const gl of g.userData.night.glows) gl.mat.dispose();
    for (const list of Object.values(g.userData.screens)) for (const sm of list) { const L = LIVE.get(sm); if (L) { L.tex.dispose(); LIVE.delete(sm); } }
    of.balls.material.dispose(); of.tvMat.dispose(); of.ptex.dispose(); for (const p of of.posters) p.m.material.dispose();
    of.test.beaconMat.dispose(); of.test.haloMat.dispose(); of.test.flashMat.dispose(); of.test.confetti.material.dispose();
  }

  // ---- state
  const modules = new Map(); const corridors = new THREE.Group(); scene.add(corridors);
  const memberTeam = new Map(); // agent → team (module)
  let agentsCache = []; const statuses = new Map(); let selectedId = null; let layoutKey = "";
  const attention = new Set(); // members waiting for permission: they leave their desk and queue at the door
  const officeData = new Map(); // team → last office data (applied when the room is (re)built)
  const moduleOf = (agentId) => modules.get(memberTeam.get(agentId));
  function setAgents(list) {
    agentsCache = list;
    if (!kit.ready) return;
    // projects in the order they first appear; without a team key the agent is a one-person team
    const teams = new Map();
    for (const a of list) { const k = a.team || a.id; if (!teams.has(k)) teams.set(k, []); teams.get(k).push(a); }
    const order = [...teams.keys()];
    cols = Math.max(1, Math.ceil(Math.sqrt(order.length)));
    for (const [id, g] of modules) if (!teams.has(id)) { disposeModule(g); modules.delete(id); }
    const at = (c, r) => { const i = r * cols + c; return c >= 0 && c < cols && r >= 0 && i < order.length; };
    order.forEach((tid, i) => {
      const members = teams.get(tid); const lead = members[0];
      let g = modules.get(tid);
      if (!g) { g = buildModule(tid, lead, i); modules.set(tid, g); if (officeData.has(tid)) applyOffice(tid, officeData.get(tid)); }
      else {
        slotPos(i, g.userData.home);                   // new slot: the frame loop glides it there
        if (g.userData.name !== lead.name) { g.userData.name = lead.name; g.userData.label.userData.setText(lead.name); }
      }
      // members: added/removed roles
      const ids = new Set(members.map((a) => a.id));
      for (const id of [...g.userData.members.keys()]) if (!ids.has(id)) removeMember(g, id);
      for (const a of members) { if (!g.userData.members.has(a.id)) addMember(g, a); g.userData.members.get(a.id).name = a.name; }
      g.userData.roleNames = members.map((a) => a.role);
      const { c, r } = slot(i);
      setDoors(g, { E: at(c + 1, r), W: at(c - 1, r), S: at(c, r + 1), N: at(c, r - 1) });
    });
    // corridors and the shadow camera only when the layout (count/columns) changes
    const key = `${order.length}|${cols}`;
    if (key !== layoutKey) {
      layoutKey = key;
      while (corridors.children.length) corridors.remove(corridors.children[0]);
      for (let i = 0; i < order.length; i++) {
        const { c, r } = slot(i);
        for (const [dc, dr, rot] of [[1, 0, 0], [0, 1, Math.PI / 2]]) {
          if (!at(c + dc, r + dr)) continue;
          const cx = c * PITCH + dc * PITCH / 2, cz = r * PITCH + dr * PITCH / 2;
          const cut = { planes: makePlanes(), cache: new Map() }; setPlanes(cut.planes, cx, 0, cz);
          placeKit("corridor", cx, cz, rot, corridors, cut);
        }
      }
      const rows = Math.ceil(order.length / cols);
      const w = (cols - 1) * PITCH, d = (rows - 1) * PITCH;
      sun.target.position.set(w / 2, 0, d / 2); sun.position.set(w / 2 + 30, 60, d / 2 + 18); sun.target.updateMatrixWorld();
      const ext = Math.max(w, d) / 2 + ROOM;
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 200 }); sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.mapSize.set(2048, 2048); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      fitAll(false);
    }
    for (const [id, st] of statuses) applyStatus(id, st);
    updateSelection();
    if (cat && (!cat.room || !modules.has(cat.room))) setCatFocus(cat.focus); // the rooms were not built yet / the room went away
  }
  function bounds() {
    const n = modules.size || 1;
    const rows = Math.max(1, Math.ceil(n / cols));
    const w = (cols - 1) * PITCH, d = (rows - 1) * PITCH;
    return { cx: w / 2, cz: d / 2, size: Math.max(w, d) + ROOM };
  }
  // smooth camera transition
  const camGoal = { target: null, zoom: null };
  function fitAll(animate = true) {
    const b = bounds();
    const t = new THREE.Vector3(b.cx, 1.5, b.cz), z = Math.max(16, b.size * 0.74);
    if (animate) { camGoal.target = t; camGoal.zoom = z; } else { target.copy(t); zoom = z; camGoal.target = null; resize(); }
  }
  function focusAgent(id) {
    const g = moduleOf(id) || modules.get(id); if (!g) return;
    camGoal.target = new THREE.Vector3(g.userData.home.x, 1.5, g.userData.home.z); camGoal.zoom = Math.min(zoom, 17);
  }
  function applyStatus(id, st) {
    statuses.set(id, st);
    const g = moduleOf(id); if (!g) return;
    const m = g.userData.members.get(id); if (!m) return;
    const c = STATUS_COLOR[st] ?? STATUS_COLOR.idle;
    m.pbMat.color.setHex(c); m.pbMat.emissive.setHex(c);
    if (m.status !== st) m.statusAt = performance.now();
    m.status = st;
  }

  // live data → props. d: { changed, ahead, health: { ratio, sick }, tasks: { todo, doing, done, blocked }, report }
  function applyOffice(teamId, d) {
    officeData.set(teamId, d);
    const g = modules.get(teamId); if (!g) return;
    const st = g.userData.office, prev = st.data || {};
    if (d.changed !== prev.changed) setPapers(st, d.changed || 0);
    if (d.ahead !== prev.ahead) setBoxes(st, d.ahead || 0);
    if (JSON.stringify(d.health) !== JSON.stringify(prev.health)) setPlant(st, d.health);
    if (d.wear !== prev.wear) setWear(st, d.wear);
    drawPayroll(st, d.payroll || null); setPosters(st, d.stack || []);
    drawBoard(st, d.tasks || null);
    st.out.visible = !!d.report; st.led.material.color.setHex(d.report ? 0x2fd27f : 0x5b6280);
    st.data = { ...d };
    renderer.shadowMap.needsUpdate = true;
  }
  // from walks to to's desk with a folder (team hand-off: a task to a member, a result back to the lead)
  const _side = new THREE.Vector3();
  function handoff(fromId, toId) {
    const g = moduleOf(fromId); if (!g || moduleOf(toId) !== g) return;
    const a = g.userData.members.get(fromId), b = g.userData.members.get(toId); if (!a || !b || a === b) return;
    _side.set(Math.cos(b.face), 0, -Math.sin(b.face)); // the side of the recipient's chair
    const to = b.seat.clone().addScaledVector(_side, 1.25);
    a.errand = { to, look: b.seat.clone(), until: performance.now() + 14000, arrived: 0 }; a.folder.visible = true;
    hot = Math.max(hot, performance.now() + 4000);
  }
  function setTestState(teamId, state) { const g = modules.get(teamId); if (g?.userData.office) setTest(g.userData.office, state); hot = Math.max(hot, performance.now() + 1500); }
  // everyone of a room around the meeting table (morning stand-up)
  function gather(teamId, on) { const g = modules.get(teamId); if (!g) return; g.userData.gather = !!on; hot = Math.max(hot, performance.now() + 3000); }
  function setAttention(id, on) {
    if (on) attention.add(id); else attention.delete(id);
    const m = moduleOf(id)?.userData.members.get(id); if (m) m.waiting = !!on;
  }
  function updateSelection() {
    const selTeam = memberTeam.get(selectedId);
    for (const [id, g] of modules) { g.userData.label.userData.draw(id === selTeam); g.userData.ring.visible = id === selTeam && g.userData.members.size > 1; }
  }
  // which module's slot a ground point falls into (except the dragged one)
  function slotAt(p, except) {
    for (const [id, g] of modules) if (id !== except && Math.abs(p.x - g.userData.home.x) < ROOM / 2 + 1 && Math.abs(p.z - g.userData.home.z) < ROOM / 2 + 1) return id;
    return null;
  }

  // ---- picking / hover (intersection with the ground plane; no mesh raycast, cheap)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const PICK_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5), GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpP = new THREE.Vector3();
  function castTo(plane, clientX, clientY, out) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    return ray.ray.intersectPlane(plane, out);
  }
  // which room (team)
  function pickTeam(ev) {
    if (!castTo(PICK_PLANE, ev.clientX, ev.clientY, tmpP)) return null;
    for (const g of modules.values()) if (Math.abs(tmpP.x - g.position.x) < ROOM / 2 + 0.5 && Math.abs(tmpP.z - g.position.z) < ROOM / 2 + 0.5) return g;
    return null;
  }
  // which agent: the nearest character in the room (or its corner); in a one-person room directly that one
  function pick(ev) {
    const g = pickTeam(ev); if (!g) return null;
    const ms = [...g.userData.members.values()]; if (ms.length === 1) return ms[0].id;
    const lx = tmpP.x - g.position.x, lz = tmpP.z - g.position.z;
    let best = null, bd = Infinity;
    for (const m of ms) {
      const d = Math.min(Math.hypot(lx - m.cur.x, lz - m.cur.z), Math.hypot(lx - m.seat.x, lz - m.seat.z) + 0.8);
      if (d < bd) { bd = d; best = m; }
    }
    // if no character was clicked: the team lead (developer)
    if (bd > 1.8) return (ms.find((m) => m.role === "dev") || ms[0]).id;
    return best.id;
  }
  const groundAt = (x, y) => { const p = new THREE.Vector3(); return castTo(GROUND, x, y, p) ? p : null; };
  // which prop (whiteboard, printer, papers…) is under the cursor: the ray against a horizontal plane at the prop's height
  const _hp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hv = new THREE.Vector3();
  function pickProp(ev) {
    if (!castTo(PICK_PLANE, ev.clientX, ev.clientY, tmpP)) return null; // also sets the ray
    if (catHit(ev)) return { teamId: cat.room, kind: "cat", g: modules.get(cat.room) };
    let best = null, bt = Infinity;
    for (const g of modules.values()) {
      const u = g.userData; if (!u.office) continue;
      for (const h of HOT) {
        if (h.when && !h.when(u)) continue;
        _hp.constant = -(h.y + g.position.y);
        if (!ray.ray.intersectPlane(_hp, _hv)) continue;
        const lx = _hv.x - g.position.x, lz = _hv.z - g.position.z;
        if (Math.abs(lx - h.x) > h.hx || Math.abs(lz - h.z) > h.hz) continue;
        const d = ray.ray.origin.distanceTo(_hv);
        if (d < bt) { bt = d; best = { teamId: u.teamId, kind: h.kind, g }; }
      }
    }
    if (!best) return null;
    // a character standing right there wins (they are what people click most)
    if (castTo(GROUND, ev.clientX, ev.clientY, tmpP)) {
      const lx = tmpP.x - best.g.position.x, lz = tmpP.z - best.g.position.z;
      for (const m of best.g.userData.members.values()) if (Math.hypot(lx - m.cur.x, lz - m.cur.z) < 0.9) return null;
    }
    return best;
  }
  const tip = document.createElement("div"); tip.className = "prop-tip"; tip.hidden = true; canvas.parentElement.append(tip);
  let tipKey = "";
  function showTip(hit, ev) {
    if (!hit) { if (!tip.hidden) { tip.hidden = true; tipKey = ""; } if (canvas.style.cursor === "pointer") canvas.style.cursor = ""; return; }
    const text = propTip(hit.teamId, hit.kind) || ""; if (!text) return showTip(null);
    const key = hit.teamId + "|" + hit.kind + "|" + text;
    if (key !== tipKey) { tip.textContent = text; tipKey = key; }
    const r = canvas.getBoundingClientRect();
    tip.hidden = false; tip.style.left = ev.clientX - r.left + "px"; tip.style.top = ev.clientY - r.top + "px";
    canvas.style.cursor = "pointer";
  }

  // ---- navigation: drag to pan, wheel to zoom towards the cursor
  const clampZoom = (z) => Math.min(130, Math.max(4, z));
  function zoomAt(factor, clientX, clientY) {
    camGoal.target = null; camGoal.zoom = null;
    const before = clientX != null ? groundAt(clientX, clientY) : null;
    zoom = clampZoom(zoom * factor); resize();
    if (before) { const after = groundAt(clientX, clientY); if (after) { target.add(before.sub(after)); resize(); } }
  }
  // ---- room move visuals: ground frames + a name tag following the cursor
  function frameMesh(color) {
    const shape = new THREE.Shape(), r = 3, o = ROOM / 2 + 1.3, i = ROOM / 2 + 0.4;
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
    // left button on a room moves the room; on empty space or with the middle button the map pans
    const room = ev.button === 0 && modules.size > 1 ? pickTeam(ev)?.userData.teamId : null;
    // hold to move a room (~0.35 s); dragging right away pans the map (so navigating stays easy when zoomed in)
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, p0: groundAt(ev.clientX, ev.clientY), moved: false, room, target: null, t0: performance.now() };
    if (room) { clearTimeout(drag.holdT); const d0 = drag; d0.holdT = setTimeout(() => { if (drag === d0 && !d0.moved) canvas.style.cursor = "move"; }, 350); }
  });
  let hoverQueued = null; // limit the hover computation to one per frame
  canvas.addEventListener("pointermove", (ev) => {
    if (drag && drag.id === ev.pointerId) {
      if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6) {
        if (drag.room && performance.now() - drag.t0 < 350) drag.room = null; // fast drag = pan
        clearTimeout(drag.holdT);
        drag.moved = true; canvas.setPointerCapture(ev.pointerId); canvas.style.cursor = "grabbing"; onHover(null); camGoal.target = null;
        if (drag.room) { const g = modules.get(drag.room); srcFrame.position.set(g.userData.home.x, 0.03, g.userData.home.z); srcFrame.visible = true; }
      }
      if (drag.moved && drag.room) {
        const g = modules.get(drag.room);
        if (g && castTo(GROUND, ev.clientX, ev.clientY, tmpP)) {
          const t = slotAt(tmpP, drag.room);
          if (t !== drag.target) {
            if (drag.target) modules.get(drag.target)?.userData.label.userData.draw(drag.target === memberTeam.get(selectedId));
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
    clearTimeout(drag.holdT); if (!drag.moved) canvas.style.cursor = "";
    canvas.dataset.dragged = drag.moved ? "1" : "";
    if (drag.moved && drag.room) {
      srcFrame.visible = dstFrame.visible = false; ghost.style.display = "none";
      if (drag.target) {
        const a = drag.room, b = drag.target;
        modules.get(b)?.userData.label.userData.draw(b === memberTeam.get(selectedId));
        // swap immediately (without waiting for the server); once the server saves the order the same layout arrives
        const ga = modules.get(a), gb = modules.get(b);
        if (ga && gb) { const tmp = ga.userData.home.clone(); ga.userData.home.copy(gb.userData.home); gb.userData.home.copy(tmp); }
        onReorder(a, b);
      }
    }
    drag = null; canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("click", (ev) => {
    if (canvas.dataset.dragged) { canvas.dataset.dragged = ""; return; }
    const hit = pickProp(ev);
    if (hit?.kind.startsWith("screen:")) { // lean in: the camera goes to the desk, the member's chat opens
      const role = hit.kind.slice(7), g = hit.g, d = STATIONS[role].desk, m = [...g.userData.members.values()].find((x) => x.role === role);
      showTip(null); camGoal.target = new THREE.Vector3(g.position.x + d[0], DESK_H, g.position.z + d[1]); camGoal.zoom = 4.2;
      peekScreen(g, role, m);
      if (m) onSelect(m.id); return;
    }
    if (hit) { showTip(null); onProp(hit.teamId, hit.kind); return; }
    const id = pick(ev); if (id) onSelect(id);
  });
  canvas.addEventListener("dblclick", (ev) => { const id = pick(ev); if (id) focusAgent(id); else fitAll(); });
  canvas.addEventListener("wheel", (ev) => { ev.preventDefault(); zoomAt(Math.pow(1.0015, ev.deltaY), ev.clientX, ev.clientY); }, { passive: false });
  canvas.addEventListener("pointerleave", () => { hoverQueued = null; onHover(null); showTip(null); });

  // ---- animation loop (no object creation per frame)
  const dV = new THREE.Vector3(), goalV = new THREE.Vector3();
  const timer = new THREE.Timer();
  function adaptResolution(dt, target) {
    if (performance.now() < resizingUntil || !document.hasFocus()) return; // do not measure while the panel is being dragged / in the background
    // if the frame time clearly exceeds the target 30 times lower the resolution; raise it again after a long calm stretch
    if (dt > target * 1.6) { slowFrames++; fastFrames = 0; } else if (dt < target * 1.15) { fastFrames++; slowFrames = 0; }
    if (slowFrames > 30 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); slowFrames = 0; }
    if (fastFrames > 240 && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, dpr + 0.25); renderer.setPixelRatio(dpr); resize(); fastFrames = 0; }
  }
  let paused = false, held = false;
  // Frame rate: 60 during interaction (dragging, camera, mouse over); 30 when calm; 10 when the window is in the background.
  // Drawing every frame while the scene was calm ate into the UI's (chat, editor) share.
  let lastDraw = 0, shadowTick = 0, hot = 0;
  const poke = () => { hot = performance.now() + 1500; };
  for (const e of ["pointermove", "pointerdown", "wheel"]) canvas.addEventListener(e, poke, { passive: true });
  let frameErrs = 0;
  function frame() {
    if (paused) return;
    requestAnimationFrame(frame);
    try { frameBody(); } catch (e) { if (frameErrs++ < 3) console.error("[scene] frame error:", e); }
  }
  function frameBody() {
    const nowT = performance.now();
    const busy = drag || camGoal.target || camGoal.zoom || nowT < hot;
    const fps = !document.hasFocus() ? 10 : busy ? 60 : 30;
    if (nowT - lastDraw < 1000 / fps - 2) return;
    lastDraw = nowT;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1), t = timer.getElapsed();
    adaptResolution(dt, 1 / fps);
    if (hoverQueued) {
      const ev = hoverQueued; hoverQueued = null;
      const hit = drag ? null : pickProp(ev); showTip(hit, ev);
      if (hit) onHover(null); else { const id = pick(ev); onHover(id, ev.clientX, ev.clientY); }
    }
    if (peekAt && zoom > peekAt.zoomMax && !camGoal.zoom) closePeek();
    for (const g of modules.values()) { const lv = zoom > 12.5; if (g.userData.label.visible !== lv) g.userData.label.visible = lv; } // room names get in the way up close
    // the broadcast camera: slow glides (speed < 1) instead of snaps
    if (camGoal.target || camGoal.zoom) {
      const k = Math.min(1, dt * 7 * (camGoal.speed || 1));
      if (camGoal.target) { target.lerp(camGoal.target, k); if (target.distanceTo(camGoal.target) < 0.02) camGoal.target = null; }
      if (camGoal.zoom) { zoom += (camGoal.zoom - zoom) * k; if (Math.abs(camGoal.zoom - zoom) < 0.02) camGoal.zoom = null; }
      resize();
    }
    const now = performance.now();
    let moved = !!drag?.room; // shadows depend only on what MOVES (the camera does not change them)
    for (const g of modules.values()) {
      const u = g.userData;
      // slot change: glide home; update the cutaway planes only when the position changes
      if (g.position.distanceToSquared(u.home) > 1e-4) { g.position.lerp(u.home, Math.min(1, dt * 10)); moved = true; }
      if (g.position.x !== u.lastX || g.position.y !== u.lastY || g.position.z !== u.lastZ) {
        u.lastX = g.position.x; u.lastY = g.position.y; u.lastZ = g.position.z;
        setPlanes(u.cut.planes, u.lastX, u.lastY, u.lastZ);
      }
      let anyWorking = false, anyTool = false;
      let k = 0, queued = 0;
      const of = u.office;
      if (of && (Math.abs(of.droop - of.droopGoal) > 0.002 || Math.abs(of.grow - of.growGoal) > 0.002 || of.layoutLeaves)) {
        of.droop += (of.droopGoal - of.droop) * Math.min(1, dt * 1.5); of.grow += (of.growGoal - of.grow) * Math.min(1, dt * 1.5);
        of.layoutLeaves = false; layoutLeaves(of); moved = true;
      }
      if (of?.tvGlow.visible) of.tvMat.opacity = 0.55 + Math.sin(t * 9) * 0.12 + Math.sin(t * 23) * 0.08; // the TV flickers while it plays the day
      if (of && stepTest(of, dt, now)) { u.testing = of.test.state === "running"; if (of.test.parts) hot = Math.max(hot, now + 200); }
      for (const m of u.members.values()) {
        const st = m.status || "idle", ch = m.ch, tt = t + m.t0;
        const working = st === "thinking" || st === "tool";
        anyWorking ||= working; anyTool ||= st === "tool";
        const since = (now - (m.statusAt || 0)) / 1000;
        let goal, sit = false, face = Math.PI / 4, sitY = 0.32;
        const waiting = m.waiting && !working;
        const er = m.errand;
        if (er && now > er.until) { m.errand = null; m.folder.visible = false; }
        if (u.gather && !working && !m.errand) {
          const sp = u.spots[Math.min(k, 3) % u.spots.length]; goal = sp.v; sit = sp.sit; sitY = sp.y; face = sp.face;
        } else if (m.errand) {
          // a hand-off: walk to the other desk with a folder, hand it over, come back
          goal = er.to; face = Math.atan2(er.look.x - m.cur.x, er.look.z - m.cur.z);
        } else if (waiting) { goal = QUEUE[Math.min(queued++, QUEUE.length - 1)]; face = Math.PI / 4; }
        else if (working) { goal = m.seat; sit = true; face = m.face; }
        else if ((st === "done" || st === "error") && since < 4) { goal = goalV.copy(m.seat).addScaledVector(dV.set(1, 0, 1).normalize(), 1.6); }
        else {
          // every member at its own pace: arrives somewhere, stays a random while, then goes to a free hangout spot
          if (m.spot < 0 || (m.dwellUntil && now > m.dwellUntil)) {
            const taken = new Set([...u.members.values()].filter((o) => o !== m).map((o) => o.spot));
            const free = u.spots.map((_, i) => i).filter((i) => !taken.has(i) && i !== m.spot);
            m.spot = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * u.spots.length);
            m.dwellUntil = 0;
          }
          const sp = u.spots[m.spot % u.spots.length];
          goal = sp.v; sit = sp.sit; face = sp.face; sitY = sp.y;
          if (!m.dwellUntil && Math.hypot(m.cur.x - goal.x, m.cur.z - goal.z) < 0.1) m.dwellUntil = now + (sp.sit ? 9000 : 4000) + Math.random() * 12000;
        }
        dV.subVectors(goal, m.cur); dV.y = 0;
        const dist = dV.length();
        if (m.errand && dist <= 0.05 && !m.errand.arrived) { m.errand.arrived = now; m.errand.until = Math.min(m.errand.until, now + 1600); }
        if (m.errand?.arrived && now - m.errand.arrived > 700) m.folder.visible = false; // handed over
        if (dist > 0.05) {
          m.cur.addScaledVector(dV.normalize(), Math.min(dist, (m.errand ? 5.2 : m.speed) * dt));
          m.yaw = angLerp(m.yaw, Math.atan2(dV.x, dV.z), Math.min(1, dt * 10));
          play(ch, "walk"); sit = false;
        } else if (m.errand) { m.yaw = angLerp(m.yaw, face, dt * 10); play(ch, "interact-right"); }
        else if (waiting) { m.yaw = angLerp(m.yaw, face, dt * 8); play(ch, (tt % 5) < 1.6 ? "interact-right" : "idle"); } // waves now and then
        else if (working) { m.yaw = angLerp(m.yaw, m.face, Math.min(1, dt * 10)); play(ch, "sit"); }
        else if (st === "done" && since < 4) { m.yaw = angLerp(m.yaw, Math.PI / 4, dt * 8); play(ch, "emote-yes"); }
        else if (st === "error" && since < 4) { m.yaw = angLerp(m.yaw, Math.PI / 4, dt * 8); play(ch, "emote-no"); }
        else if (sit) { m.yaw = angLerp(m.yaw, face, dt * 8); play(ch, "sit"); }
        else { m.yaw = angLerp(m.yaw, face, dt * 4); play(ch, "idle"); }
        ch.wrap.position.set(m.cur.x, sit ? sitY : 0, m.cur.z);
        ch.wrap.rotation.y = m.yaw;
        // a walking character animates every frame; a seated/idle one 15 times a second (10 rooms × 4 members add up)
        m.acc = (m.acc || 0) + dt;
        if (ch.mixer && (dist > 0.05 || m.acc >= 1 / 15)) { ch.mixer.update(m.acc); m.acc = 0; }
        m.plumb.position.set(m.cur.x, 3.9 + Math.sin(tt * 2) * 0.12, m.cur.z); m.plumb.rotation.y = tt * 1.5;
        const carrying = m.folder.visible;
        m.plumb.visible = !waiting && !carrying; m.sign.visible = waiting;
        if (carrying) m.folder.position.set(m.cur.x, 4.1 + Math.sin(tt * 5) * 0.12, m.cur.z);
        if (waiting) { m.sign.position.set(m.cur.x, 4.2 + Math.abs(Math.sin(tt * 3)) * 0.35, m.cur.z); }
        m.pbMat.emissiveIntensity = working ? 1.1 + Math.sin(tt * 6) * 0.5 : 0.8;
        m.bubble.sprite.position.set(m.cur.x, 4.7 + (k % 2) * 1.1, m.cur.z); // just above the head; stays below the room name
        if (m.speech.sprite.visible) {
          const left = m.speech.until - now;
          if (left <= 0) { m.speech.sprite.visible = false; m.bubble.sprite.visible = !!m.bubble.text; }
          else { m.speech.sprite.position.set(m.cur.x, 5.6 + (k % 2) * 0.6, m.cur.z); m.speech.sprite.material.opacity = Math.min(1, left / 600); m.bubble.sprite.visible = false; }
        }
        for (const s of u.screens[m.role] || []) s.color.setScalar(st === "tool" ? 1 : working ? 0.85 : 0.35);
        if (u.night && night > 0.3) for (const gl of u.night.glows) if (gl.role === m.role) gl.mat.opacity = working ? (0.5 + Math.sin(tt * 3) * 0.08) * night : 0.06 * night;
        if (m.id === selectedId && u.members.size > 1) u.ring.position.set(m.cur.x, 0.06, m.cur.z);
        k++;
      }
      if (Math.random() < (u.testing ? 0.95 : anyTool ? 0.5 : anyWorking ? 0.2 : 0.04)) {
        u.leds.setColorAt((Math.random() * 20) | 0, Math.random() < 0.5 ? LED_OFF : LED_ON[Math.random() < 0.6 ? 0 : 1]);
        u.leds.instanceColor.needsUpdate = true;
      }
    }
    if (cat && stepCat(dt, t)) moved = true;
    if (++shadowTick % 3 === 0 || moved) renderer.shadowMap.needsUpdate = true; // the shadow pass doubles the draw calls: ~10-20 Hz, every frame only while a room glides
    renderer.render(scene, cam);
  }
  resize(); requestAnimationFrame(frame);
  // once the fonts load only the canvas texts are redrawn (the scene is not rebuilt)
  document.fonts?.ready.then(() => { for (const g of modules.values()) { g.userData.label.userData.redraw(); for (const m of g.userData.members.values()) m.bubble.redraw(); } });

  return {
    pickAt: (x, y) => pick({ clientX: x, clientY: y }),
    setAgents, setStatus: applyStatus, setOffice: applyOffice, setAttention, handoff, setTest: setTestState, setScreen, gather,
    setCat: setCatFocus,
    // broadcast: glide to a room (or a member) at a zoom, slowly; drift: a gentle sideways offset for life
    glide(idOrTeam, z = 11, speed = 0.35, drift = 0) {
      const g = modules.get(idOrTeam) || moduleOf(idOrTeam); if (!g) return false;
      const m = g.userData.members.get(idOrTeam); const base = m ? new THREE.Vector3(g.position.x + m.cur.x, 1.2, g.position.z + m.cur.z) : new THREE.Vector3(g.userData.home.x, 1.5, g.userData.home.z);
      base.x += drift; base.z -= drift;
      camGoal.target = base; camGoal.zoom = clampZoom(z); camGoal.speed = speed; return true;
    },
    roomsWithWork() { const out = []; for (const [tid, g] of modules) { let n = 0; for (const m of g.userData.members.values()) { const st = statuses.get(m.id); if (st === "thinking" || st === "tool") n++; } out.push({ teamId: tid, working: n }); } return out; },
    snapshot() { renderer.render(scene, cam); return canvas.toDataURL("image/png"); },
    stream(fps = 30) { return canvas.captureStream(fps); },
    say(id, text) { const m = moduleOf(id)?.userData.members.get(id); if (m && text) { m.speech.say(text); hot = Math.max(hot, performance.now() + 1000); } },
    setTV(teamId, on) { const of = modules.get(teamId)?.userData.office; if (of) of.tvGlow.visible = !!on; }, catInfo: () => (cat ? { room: cat.room, focus: cat.focus, phase: cat.phase } : null),
    // camera to a room at a given zoom (stand-up tour)
    tour(teamId, z = 12) { const g = modules.get(teamId); if (!g) return; camGoal.target = new THREE.Vector3(g.userData.home.x, 1.5, g.userData.home.z); camGoal.zoom = clampZoom(z); },
    daylight: (hour) => { const r = daylight(hour); for (const g of modules.values()) if (g.userData.night) g.userData.night.grp.visible = night > 0.3; return r; },
    // where a prop is on screen (tests, onboarding hints)
    propAt(teamId, kind) {
      const g = modules.get(teamId), h = HOT.find((x) => x.kind === kind); if (!g || !h) return null;
      const v = new THREE.Vector3(g.position.x + h.x, h.y, g.position.z + h.z).project(cam), r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    },
    setActivity(id, text) { activities.set(id, text); moduleOf(id)?.userData.members.get(id)?.bubble.set(text); },
    select(id) { selectedId = id; updateSelection(); },
    // stop drawing while a full-screen view (document library) covers the scene
    // hold: the scene stays off (focus mode) whatever else asks to pause or resume it
    hold(on) { held = on; if (on) { if (!paused) { paused = true; } } else if (paused) { paused = false; timer.update(); requestAnimationFrame(frame); } },
    pause(on) { if (held) on = true; if (on === paused) return; paused = on; if (!on) { timer.update(); requestAnimationFrame(frame); } },
    focus: focusAgent, fit: () => fitAll(true),
    zoomIn: () => { camGoal.zoom = clampZoom((camGoal.zoom || zoom) / 1.3); }, zoomOut: () => { camGoal.zoom = clampZoom((camGoal.zoom || zoom) * 1.3); },
    stats: () => ({ dpr, paused, rooms: modules.size, ...renderer.info.render, programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
}
