// Star map: the projects of the station as a small galaxy you can turn in your hand (professional view → Map).
// A star is a project; its arc is the share of requirements verified with evidence; the four small cubes in orbit
// are the roles (they run when one is at work, amber when one waits for you); a line joins linked projects and a
// pulse travels along it while either end is working. Everything shown is data the station already has.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const COL = { idle: 0x9fb0d8, busy: 0x6f95ff, wait: 0xffb020, fin: 0x2fd27f, link: 0x2c3855, linkOn: 0x4d7bff, ring: 0x2fd27f, ringBad: 0x4d7bff, ringBg: 0x222a3c, sat: 0x56607a };
const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.18, "rgba(255,255,255,.55)"); grd.addColorStop(0.45, "rgba(255,255,255,.12)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Where the stars are: a short, seeded simulation in 3D (linked projects pull together, all push apart), flattened
// into a disc. The same projects and links always give the same sky.
function layout(nodes, links) {
  const n = nodes.length, P = nodes.map((nd, i) => { const r = rnd(hash(nd.tk)), y = 1 - ((i + 0.5) / n) * 2, rad = Math.sqrt(1 - y * y), a = i * 2.39996 + r() * 0.5; return new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad).multiplyScalar(6 + Math.cbrt(n) * 3); });
  const at = new Map(nodes.map((nd, i) => [nd.tk, i])), L = links.map(([a, b]) => [at.get(a), at.get(b)]).filter(([a, b]) => a != null && b != null), k = 7.5, d = new THREE.Vector3();
  for (let it = 0; it < 320; it++) {
    const F = P.map(() => new THREE.Vector3()), cool = 1 - it / 320;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { d.subVectors(P[i], P[j]); const len = Math.max(d.length(), 0.05); d.multiplyScalar((k * k) / (len * len * len)); F[i].add(d); F[j].sub(d); }
    for (const [i, j] of L) { d.subVectors(P[j], P[i]); const len = Math.max(d.length(), 0.05); d.multiplyScalar(((len - k * 1.3) / len) * 0.45); F[i].add(d); F[j].sub(d); }
    for (let i = 0; i < n; i++) { F[i].addScaledVector(P[i], -0.06); const m = F[i].length() || 1; P[i].addScaledVector(F[i], Math.min(m, 1.4 * cool + 0.03) / m); }
  }
  const c = new THREE.Vector3(); for (const p of P) c.add(p); c.multiplyScalar(1 / Math.max(n, 1));
  let max = 1; for (const p of P) { p.sub(c); p.y *= 0.5; max = Math.max(max, p.length()); }
  const R = 9 + Math.sqrt(n) * 4.2; for (const p of P) p.multiplyScalar(R / max);
  return { P, R };
}

export function createStarMap(host, { onPick, labels = {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor(0x0a0c11, 1);
  const canvas = renderer.domElement; canvas.className = "sm-canvas"; host.append(canvas);
  const labelBox = document.createElement("div"); labelBox.className = "sm-labels"; host.append(labelBox);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0c11); scene.fog = new THREE.FogExp2(0x0a0c11, 0.006);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
  const controls = new OrbitControls(cam, canvas); controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.7;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches; controls.autoRotate = !still; controls.autoRotateSpeed = 0.32;
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.42, 0.55, 0.62); composer.addPass(bloom); composer.addPass(new OutputPass());

  // far dust, so that turning the map has something to turn against
  { const r = rnd(7), N = 1400, pos = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = 70 + r() * 150, s = Math.sqrt(1 - u * u); pos[i * 3] = Math.cos(a) * s * rad; pos[i * 3 + 1] = u * rad * 0.7; pos[i * 3 + 2] = Math.sin(a) * s * rad; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x3d465c, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.8, fog: false }))); }

  const glow = glowTexture(), GEO = { core: new THREE.SphereGeometry(1, 28, 18), sat: new THREE.BoxGeometry(0.4, 0.4, 0.4), pick: new THREE.SphereGeometry(3.3, 10, 8), satPick: new THREE.SphereGeometry(0.7, 8, 6) };
  const orbitGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2) * 3.1, 0, Math.sin((i / 96) * Math.PI * 2) * 3.1)));
  const root = new THREE.Group(); scene.add(root);
  let stars = new Map(), lines = [], picks = [], shape = "", R = 20, hover = null, active = false, raf = 0, framed = false;

  function build(data) {
    for (const s of stars.values()) s.label.remove(); root.clear(); stars = new Map(); lines = []; picks = [];
    const { P, R: rad } = layout(data.nodes, data.links); R = rad;
    data.nodes.forEach((nd, i) => {
      const g = new THREE.Group(); g.position.copy(P[i]); root.add(g);
      const core = new THREE.Mesh(GEO.core, new THREE.MeshBasicMaterial({ color: COL.idle })); g.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: COL.idle, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(halo);
      const face = new THREE.Group(); g.add(face); // always turned to the viewer: the evidence arc
      const ringBg = new THREE.Mesh(new THREE.RingGeometry(1.95, 2.1, 72), new THREE.MeshBasicMaterial({ color: COL.ringBg, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })); face.add(ringBg);
      const ring = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: COL.ring, side: THREE.DoubleSide })); face.add(ring);
      const r = rnd(hash(nd.tk) ^ 0x9e3779b9), orbit = new THREE.Group(); orbit.rotation.set((r() - 0.5) * 1.1, r() * Math.PI, (r() - 0.5) * 1.1); g.add(orbit);
      orbit.add(new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({ color: 0x2a3348, transparent: true, opacity: 0.9 })));
      const spin = new THREE.Group(); orbit.add(spin);
      const sats = nd.sats.map((q, k) => {
        const m = new THREE.Mesh(GEO.sat, new THREE.MeshBasicMaterial({ color: COL.sat })), a = (k / nd.sats.length) * Math.PI * 2; m.position.set(Math.cos(a) * 3.1, 0, Math.sin(a) * 3.1); m.rotation.set(0.5, a, 0.3); spin.add(m);
        const hit = new THREE.Mesh(GEO.satPick, new THREE.MeshBasicMaterial({ visible: false })); hit.userData = { id: q.id, tk: nd.tk }; m.add(hit); picks.push(hit); return m;
      });
      const hit = new THREE.Mesh(GEO.pick, new THREE.MeshBasicMaterial({ visible: false })); hit.userData = { id: nd.id, tk: nd.tk }; g.add(hit); picks.push(hit);
      const label = document.createElement("button"); label.type = "button"; label.className = "sm-label"; label.innerHTML = "<b></b><span></span>"; label.onclick = () => onPick?.(nd.id); labelBox.append(label);
      stars.set(nd.tk, { g, core, halo, face, ring, ringBg, spin, sats, label, speed: 0.04, phase: r() * 6.28, frac: -1, size: 1 });
    });
    for (const [a, b] of data.links) {
      const A = stars.get(a), B = stars.get(b); if (!A || !B) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A.g.position, B.g.position]), new THREE.LineBasicMaterial({ color: COL.link, transparent: true, opacity: 0.9 })); root.add(line);
      const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: COL.linkOn, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); pulse.scale.setScalar(1.5); pulse.visible = false; root.add(pulse);
      lines.push({ a, b, line, pulse, from: A.g.position, to: B.g.position, on: false });
    }
    if (!framed) { framed = true; cam.position.set(R * 0.25, R * 1.0, R * 2.3); controls.target.set(0, 0, 0); }
    controls.minDistance = R * 0.7; controls.maxDistance = R * 5; controls.update();
  }

  function update(data) {
    const s = data.nodes.map((n) => n.tk + ":" + n.sats.map((q) => q.id).join(",")).join("|") + "#" + data.links.map((l) => l.join(">")).join("|");
    if (s !== shape) { shape = s; build(data); }
    for (const nd of data.nodes) {
      const st = stars.get(nd.tk); if (!st) continue;
      const tone = nd.wait ? COL.wait : nd.busy ? COL.busy : COL.idle, lively = nd.busy || nd.wait;
      st.size = 0.55 + Math.min(0.5, nd.weight * 0.5); st.core.scale.setScalar(st.size);
      st.core.material.color.setHex(tone).multiplyScalar(lively ? 1.25 : nd.total ? 0.8 : 0.5);
      st.halo.material.color.setHex(tone); st.halo.material.opacity = lively ? 0.5 : 0.14; st.halo.scale.setScalar(lively ? 7.5 : 4.2); st.lively = lively;
      st.speed = nd.busy ? 0.9 : nd.wait ? 0 : 0.045;
      st.ringBg.visible = st.ring.visible = nd.total > 0;
      if (nd.total > 0 && st.frac !== nd.frac) { st.frac = nd.frac; st.ring.geometry.dispose(); st.ring.geometry = new THREE.RingGeometry(1.92, 2.13, 72, 1, Math.PI / 2, -Math.PI * 2 * Math.max(nd.frac, 0.004)); }
      st.ring.material.color.setHex(nd.bad ? COL.ringBad : COL.ring);
      nd.sats.forEach((q, k) => { const m = st.sats[k]; if (!m) return; m.material.color.setHex(q.st === "busy" ? COL.busy : q.st === "wait" ? COL.wait : q.st === "fin" ? COL.fin : COL.sat); if (q.st === "busy" || q.st === "wait") m.material.color.multiplyScalar(1.3); m.scale.setScalar(q.st ? 1.45 : 1); });
      st.label.querySelector("b").textContent = nd.name; st.label.querySelector("span").textContent = nd.sub; st.label.className = "sm-label" + (nd.wait ? " wait" : nd.busy ? " busy" : "") + (nd.sel ? " sel" : ""); st.label.title = nd.title || "";
    }
    const busy = new Set(data.nodes.filter((n) => n.busy).map((n) => n.tk));
    for (const l of lines) { l.on = busy.has(l.a) || busy.has(l.b); l.line.material.color.setHex(l.on ? COL.linkOn : COL.link); l.pulse.visible = l.on; }
    host.classList.toggle("empty", !data.nodes.length);
  }

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), v = new THREE.Vector3(); let down = null;
  const pickAt = (e) => { const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, cam); const hits = ray.intersectObjects(picks, false); if (!hits.length) return null; return (hits.find((h) => h.object.geometry === GEO.satPick) || hits[0]).object.userData; };
  canvas.addEventListener("pointermove", (e) => { if (down) return; hover = pickAt(e); canvas.style.cursor = hover ? "pointer" : "grab"; });
  canvas.addEventListener("pointerleave", () => { hover = null; });
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointerup", (e) => { const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99; down = null; canvas.style.cursor = "grab"; if (moved < 5) { const h = pickAt(e); if (h) onPick?.(h.id); } });

  function resize() { const w = Math.max(2, host.clientWidth), h = Math.max(2, host.clientHeight); renderer.setSize(w, h, false); composer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  const timer = new THREE.Timer();
  function frame() {
    raf = 0; if (!active || document.hidden) return; raf = requestAnimationFrame(frame);
    timer.update(); const dt = Math.min(timer.getDelta(), 0.1), t = timer.getElapsed();
    controls.autoRotate = !still && !hover && !down; controls.update();
    const w = host.clientWidth, h = host.clientHeight;
    for (const [tk, st] of stars) {
      st.spin.rotation.y += st.speed * dt; st.face.quaternion.copy(cam.quaternion);
      const pulse = st.lively ? 1 + Math.sin(t * 2.4 + st.phase) * 0.07 : 1, hot = hover?.tk === tk ? 1.18 : 1; st.core.scale.setScalar(st.size * pulse * hot);
      v.copy(st.g.position).project(cam); const dist = cam.position.distanceTo(st.g.position);
      const px = (v.x * 0.5 + 0.5) * w, py = (-v.y * 0.5 + 0.5) * h, drop = (2.5 / (dist * Math.tan((cam.fov * Math.PI) / 360))) * (h / 2); // just under the orbit, whatever the zoom
      const vis = v.z < 1 && px > -80 && px < w + 80 && py > -40 && py < h + 60;
      st.label.style.display = vis ? "" : "none";
      if (vis) { st.label.style.transform = `translate(-50%, 0) translate(${px.toFixed(1)}px, ${(py + drop + 4).toFixed(1)}px)`; st.label.style.opacity = String(Math.max(0.6, Math.min(1, 1.9 - dist / (R * 3.2)))); st.label.style.zIndex = String(1000 - Math.round(dist)); }
    }
    for (const l of lines) if (l.on) l.pulse.position.lerpVectors(l.from, l.to, (t * 0.35 + (hash(l.a) % 100) / 100) % 1);
    composer.render();
  }
  const kick = () => { if (active && !raf && !document.hidden) { timer.update(); raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", kick);

  return {
    update,
    setActive(on) { active = !!on; if (active) { resize(); kick(); } },
    reset() { framed = false; cam.position.set(R * 0.25, R * 1.0, R * 2.3); controls.target.set(0, 0, 0); controls.update(); framed = true; },
    labels,
    dispose() { active = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", kick); controls.dispose(); renderer.dispose(); canvas.remove(); labelBox.remove(); },
  };
}
