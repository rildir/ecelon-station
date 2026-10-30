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

export function createStation(canvas, { onSelect, onHover, onReorder = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const DPR_MAX = Math.min(devicePixelRatio || 1, 2);
  let dpr = DPR_MAX; renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF instead of soft shadows: looks almost the same, costs far less
  // shadow pass runs every frame: with three >= 0.18x the PCF sampler is invalid on frames where the pass is skipped (GL_INVALID_OPERATION)
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
  new ResizeObserver(() => { resize(); if (kit.ready) renderer.render(scene, cam); slowFrames = 0; resizingUntil = performance.now() + 400; }).observe(canvas);

  // ---- light (only two lights, fixed)
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30364a, 1.6));
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
  function furn(name, parent, x, z, ry = 0, { y = 0, s = FS, ti = 0 } = {}) {
    const src = kit["f:" + name]; if (!src) return null;
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

  const SCREEN_GEO = () => geo("scr", () => new THREE.PlaneGeometry(0.33, 0.19));
  function monitor(parent, st, lx, lz, turn, look, ti, s = FS) {
    const [x, z] = deskLocal(st, lx, lz);
    const o = furn("computer-screen", parent, x, z, st.ry + turn, { y: DESK_H, s, ti }); if (!o) return null;
    const scr = new THREE.Mesh(SCREEN_GEO(), screenMaterial(look)); scr.position.set(0, 0.175, -0.052); scr.rotation.y = Math.PI; scr.userData.keep = true; o.add(scr);
    return scr.material;
  }
  // every role's corner is distinct; empty: when the role is absent the screens stay dim
  function station(role, parent, look, ti, r) {
    const st = STATIONS[role]; const screens = [];
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
    return { sprite: s, set, redraw: () => shown && set(shown, true) };
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
    for (const role of Object.keys(STATIONS)) g.userData.screens[role] = station(role, statics, look + ROLE_ORDER[role], ti, r).screens;
    const accent = mat(THEMES[ti].red);
    g.userData.leds = rack(statics, 8.4, -8.8, 0, accent);
    g.userData.spots = commons(statics, ti, r);
    g.userData.merged = mergeStatics(statics);
    freeze(statics);

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
    const look = Number.isInteger(a.char) ? a.char : 0;
    const ch = makeCharacter(look, g);
    const seat = new THREE.Vector3(st.seat[0], 0, st.seat[1]);
    const m = {
      id: a.id, role, ch, plumb, pbMat, bubble, seat, face: st.face,
      cur: seat.clone().add(new THREE.Vector3(1.2, 0, 1.2)), yaw: 0, t0: Math.random() * 20,
      spot: -1, dwellUntil: 0, speed: 3.0 + Math.random() * 1.3, // everyone wanders at their own pace
      status: statuses.get(a.id) || a.status || "idle", statusAt: 0,
    };
    g.userData.members.set(a.id, m); memberTeam.set(a.id, g.userData.teamId);
    return m;
  }
  function removeMember(g, id) {
    const m = g.userData.members.get(id); if (!m) return;
    m.ch.mixer?.stopAllAction(); g.remove(m.ch.wrap, m.plumb, m.bubble.sprite);
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
  }

  // ---- state
  const modules = new Map(); const corridors = new THREE.Group(); scene.add(corridors);
  const memberTeam = new Map(); // agent → team (module)
  let agentsCache = []; const statuses = new Map(); let selectedId = null; let layoutKey = "";
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
      if (!g) { g = buildModule(tid, lead, i); modules.set(tid, g); }
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

  // ---- navigation: drag to pan, wheel to zoom towards the cursor
  const clampZoom = (z) => Math.min(130, Math.max(7, z));
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
  canvas.addEventListener("click", (ev) => { if (canvas.dataset.dragged) { canvas.dataset.dragged = ""; return; } const id = pick(ev); if (id) onSelect(id); });
  canvas.addEventListener("dblclick", (ev) => { const id = pick(ev); if (id) focusAgent(id); else fitAll(); });
  canvas.addEventListener("wheel", (ev) => { ev.preventDefault(); zoomAt(Math.pow(1.0015, ev.deltaY), ev.clientX, ev.clientY); }, { passive: false });
  canvas.addEventListener("pointerleave", () => { hoverQueued = null; onHover(null); });

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
  let paused = false;
  // Frame rate: 60 during interaction (dragging, camera, mouse over); 30 when calm; 10 when the window is in the background.
  // Drawing every frame while the scene was calm ate into the UI's (chat, editor) share.
  let lastDraw = 0, hot = 0;
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
    if (hoverQueued) { const ev = hoverQueued; hoverQueued = null; const id = pick(ev); onHover(id, ev.clientX, ev.clientY); }
    if (camGoal.target || camGoal.zoom) {
      const k = Math.min(1, dt * 7);
      if (camGoal.target) { target.lerp(camGoal.target, k); if (target.distanceTo(camGoal.target) < 0.02) camGoal.target = null; }
      if (camGoal.zoom) { zoom += (camGoal.zoom - zoom) * k; if (Math.abs(camGoal.zoom - zoom) < 0.02) camGoal.zoom = null; }
      resize();
    }
    const now = performance.now();
    for (const g of modules.values()) {
      const u = g.userData;
      // slot change: glide home; update the cutaway planes only when the position changes
      if (g.position.distanceToSquared(u.home) > 1e-4) g.position.lerp(u.home, Math.min(1, dt * 10));
      if (g.position.x !== u.lastX || g.position.y !== u.lastY || g.position.z !== u.lastZ) {
        u.lastX = g.position.x; u.lastY = g.position.y; u.lastZ = g.position.z;
        setPlanes(u.cut.planes, u.lastX, u.lastY, u.lastZ);
      }
      let anyWorking = false, anyTool = false;
      let k = 0;
      for (const m of u.members.values()) {
        const st = m.status || "idle", ch = m.ch, tt = t + m.t0;
        const working = st === "thinking" || st === "tool";
        anyWorking ||= working; anyTool ||= st === "tool";
        const since = (now - (m.statusAt || 0)) / 1000;
        let goal, sit = false, face = Math.PI / 4, sitY = 0.32;
        if (working) { goal = m.seat; sit = true; face = m.face; }
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
        if (dist > 0.05) {
          m.cur.addScaledVector(dV.normalize(), Math.min(dist, m.speed * dt));
          m.yaw = angLerp(m.yaw, Math.atan2(dV.x, dV.z), Math.min(1, dt * 10));
          play(ch, "walk"); sit = false;
        } else if (working) { m.yaw = angLerp(m.yaw, m.face, Math.min(1, dt * 10)); play(ch, "sit"); }
        else if (st === "done" && since < 4) { m.yaw = angLerp(m.yaw, Math.PI / 4, dt * 8); play(ch, "emote-yes"); }
        else if (st === "error" && since < 4) { m.yaw = angLerp(m.yaw, Math.PI / 4, dt * 8); play(ch, "emote-no"); }
        else if (sit) { m.yaw = angLerp(m.yaw, face, dt * 8); play(ch, "sit"); }
        else { m.yaw = angLerp(m.yaw, face, dt * 4); play(ch, "idle"); }
        ch.wrap.position.set(m.cur.x, sit ? sitY : 0, m.cur.z);
        ch.wrap.rotation.y = m.yaw;
        ch.mixer?.update(dt);
        m.plumb.position.set(m.cur.x, 3.9 + Math.sin(tt * 2) * 0.12, m.cur.z); m.plumb.rotation.y = tt * 1.5;
        m.pbMat.emissiveIntensity = working ? 1.1 + Math.sin(tt * 6) * 0.5 : 0.8;
        m.bubble.sprite.position.set(m.cur.x, 4.7 + (k % 2) * 1.1, m.cur.z); // just above the head; stays below the room name
        for (const s of u.screens[m.role] || []) s.color.setScalar(st === "tool" ? 1 : working ? 0.85 : 0.35);
        if (m.id === selectedId && u.members.size > 1) u.ring.position.set(m.cur.x, 0.06, m.cur.z);
        k++;
      }
      if (Math.random() < (anyTool ? 0.5 : anyWorking ? 0.2 : 0.04)) {
        u.leds.setColorAt((Math.random() * 20) | 0, Math.random() < 0.5 ? LED_OFF : LED_ON[Math.random() < 0.6 ? 0 : 1]);
        u.leds.instanceColor.needsUpdate = true;
      }
    }
    renderer.render(scene, cam);
  }
  resize(); requestAnimationFrame(frame);
  // once the fonts load only the canvas texts are redrawn (the scene is not rebuilt)
  document.fonts?.ready.then(() => { for (const g of modules.values()) { g.userData.label.userData.redraw(); for (const m of g.userData.members.values()) m.bubble.redraw(); } });

  return {
    pickAt: (x, y) => pick({ clientX: x, clientY: y }),
    setAgents, setStatus: applyStatus,
    setActivity(id, text) { activities.set(id, text); moduleOf(id)?.userData.members.get(id)?.bubble.set(text); },
    select(id) { selectedId = id; updateSelection(); },
    // stop drawing while a full-screen view (document library) covers the scene
    pause(on) { if (on === paused) return; paused = on; if (!on) { timer.update(); requestAnimationFrame(frame); } },
    focus: focusAgent, fit: () => fitAll(true),
    zoomIn: () => { camGoal.zoom = clampZoom((camGoal.zoom || zoom) / 1.3); }, zoomOut: () => { camGoal.zoom = clampZoom((camGoal.zoom || zoom) * 1.3); },
    stats: () => ({ dpr, ...renderer.info.render, programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  };
}
