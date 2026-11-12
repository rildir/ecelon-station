// Office sounds, synthesized in the browser: no audio files, nothing downloaded. Off by default (localStorage "sfx").
// Every cue is short and quiet; the keyboard ticks only for the room you are looking at.
let ctx = null, master = null, enabled = false;
const ensure = () => {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
  return ctx;
};
const now = () => ctx.currentTime;
// one note: sine/triangle with an attack and an exponential decay
function tone(freq, { t = 0, dur = 0.25, type = "sine", gain = 0.5, slide = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, now() + t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), now() + t + dur);
  g.gain.setValueAtTime(0, now() + t); g.gain.linearRampToValueAtTime(gain, now() + t + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, now() + t + dur);
  o.connect(g); g.connect(master); o.start(now() + t); o.stop(now() + t + dur + 0.05);
}
// filtered noise burst (keys, paper)
function noise({ t = 0, dur = 0.05, gain = 0.25, hp = 1200, lp = 6000 } = {}) {
  const n = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const h = ctx.createBiquadFilter(); h.type = "highpass"; h.frequency.value = hp;
  const l = ctx.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = lp;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(h); h.connect(l); l.connect(g); g.connect(master); src.start(now() + t);
}
const CUES = {
  done: () => { tone(880, { dur: 0.5, gain: 0.35 }); tone(1320, { t: 0.09, dur: 0.6, gain: 0.22 }); },                       // a soft bell
  error: () => { tone(220, { dur: 0.35, type: "triangle", gain: 0.35, slide: -60 }); tone(165, { t: 0.18, dur: 0.45, type: "triangle", gain: 0.3 }); },
  testFail: () => { for (let i = 0; i < 3; i++) tone(196, { t: i * 0.22, dur: 0.16, type: "square", gain: 0.12 }); },         // low buzzer ×3
  testPass: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, { t: i * 0.09, dur: 0.45, gain: 0.28 })); },              // rising arpeggio
  permission: () => { tone(1568, { dur: 0.18, gain: 0.3 }); tone(1568, { t: 0.26, dur: 0.18, gain: 0.3 }); },                 // ping ping
  handoff: () => { noise({ dur: 0.18, gain: 0.18, hp: 700, lp: 3500 }); noise({ t: 0.1, dur: 0.14, gain: 0.12, hp: 900, lp: 3000 }); }, // paper
  key: () => { noise({ dur: 0.025, gain: 0.08 + Math.random() * 0.06, hp: 1800, lp: 7000 }); },
  coffee: () => { tone(392, { dur: 0.3, type: "triangle", gain: 0.2 }); tone(330, { t: 0.16, dur: 0.4, type: "triangle", gain: 0.2 }); },
};
let lastKey = 0;
export const sfx = {
  get on() { return enabled; },
  set(on) { enabled = !!on; try { localStorage.setItem("sfx", enabled ? "1" : "0"); } catch {} if (enabled && ensure()?.state === "suspended") ctx.resume(); },
  init() { try { enabled = localStorage.getItem("sfx") === "1"; } catch {} return enabled; },
  muted: false, // the professional view is silent whatever the switch says
  play(name) {
    if (!enabled || this.muted || !CUES[name] || !ensure()) return;
    if (ctx.state === "suspended") { ctx.resume(); return; }
    if (name === "key") { const t = performance.now(); if (t - lastKey < 70) return; lastKey = t; }
    try { CUES[name](); } catch {}
  },
};
