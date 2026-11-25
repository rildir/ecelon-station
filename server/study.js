// JS Study: where the module keeps its content (a pack) and the user's progress. One file, data/study.json, in the
// station's private data folder: it is on this computer only, and data/ is never committed. Nothing here talks to
// the internet. The rules (what a pack may contain, how packs merge) are the ones in public/study-core.js.
import express from "express";
import fs from "node:fs";
import { t } from "./i18n.js";
import { dataPath, mkdirPrivate, writePrivate } from "./paths.js";
import { validatePack, mergePack, emptyProgress } from "../public/study-core.js";

const FILE = dataPath("study.json");
const CAP = { answers: 20000, attempts: 5000, sessions: 5000, notes: 500, drafts: 300 };
const blank = () => ({ v: 1, content: { topics: [], hints: [], questions: [], tasks: [] }, progress: emptyProgress() });

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8")), b = blank();
    return { v: 1, content: { ...b.content, ...(d.content || {}) }, progress: { ...b.progress, ...(d.progress || {}) } };
  } catch { return blank(); } // no file yet, or one that cannot be read: start empty (the unreadable file is replaced at the next save)
}
function write(d) {
  mkdirPrivate(dataPath()); const tmp = FILE + ".tmp";
  writePrivate(tmp, JSON.stringify(d)); fs.renameSync(tmp, FILE); // never a half-written file
}

const ID = /^[A-Za-z0-9_.-]{1,80}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const when = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v.slice(0, 40) : null);
// what is kept of a record the page sent: known fields only, with their types
const clean = {
  answers: (r) => (r && ID.test(r.id || "") && ID.test(r.questionId || "") && when(r.tarih) && DAY.test(r.gun || "") && typeof r.dogruMu === "boolean"
    ? { id: r.id, questionId: r.questionId, topic: ID.test(r.topic || "") ? r.topic : "", tarih: when(r.tarih), gun: r.gun, dogruMu: r.dogruMu, secilen: text(r.secilen, 300) } : null),
  attempts: (r) => (r && ID.test(r.id || "") && ID.test(r.taskId || "") && when(r.tarih) && DAY.test(r.gun || "") && typeof r.eslesti === "boolean"
    ? { id: r.id, taskId: r.taskId, tarih: when(r.tarih), gun: r.gun, eslesti: r.eslesti, tahmin: text(r.tahmin, 2000), cikti: text(r.cikti, 4000), zamanAsimi: r.zamanAsimi === true } : null),
  sessions: (r) => (r && ID.test(r.id || "") && ["isinma", "konu", "karisik"].includes(r.tur) && when(r.tarih) && DAY.test(r.gun || "") && Number.isInteger(r.dogru) && Number.isInteger(r.toplam)
    ? { id: r.id, tur: r.tur, tarih: when(r.tarih), gun: r.gun, dogru: r.dogru, toplam: r.toplam } : null),
};

export function studyRouter() {
  const r = express.Router();
  r.get("/", (_req, res) => res.json(read()));

  // a content pack: checked as a whole, then merged; a pack with any error changes nothing
  r.post("/import", (req, res) => {
    const d = read(), v = validatePack(req.body?.pack, d.content, t);
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    const m = mergePack(d.content, v.pack); d.content = m.content; write(d);
    res.json({ ok: true, report: m.report, content: d.content });
  });

  // answers, task attempts and finished tests are only ever added (an id the file already has is ignored)
  r.post("/log", (req, res) => {
    const d = read(), b = req.body || {};
    for (const k of ["answers", "attempts", "sessions"]) {
      if (!Array.isArray(b[k])) continue;
      const have = new Set(d.progress[k].map((x) => x.id));
      for (const raw of b[k].slice(0, 200)) { const x = clean[k](raw); if (x && !have.has(x.id)) { d.progress[k].push(x); have.add(x.id); } }
      if (d.progress[k].length > CAP[k]) d.progress[k] = d.progress[k].slice(-CAP[k]);
    }
    write(d); res.json({ ok: true });
  });

  // the user's own notes and the code they were writing: replaced as a whole (they are small and edited in one place)
  r.put("/meta", (req, res) => {
    const d = read(), b = req.body || {};
    if (Array.isArray(b.notes)) d.progress.notes = b.notes.slice(0, CAP.notes).map((n) => ({ id: text(n?.id, 40), topic: ID.test(n?.topic || "") ? n.topic : "genel", text: text(n?.text, 1000).trim() })).filter((n) => n.id && n.text);
    if (b.drafts && typeof b.drafts === "object" && !Array.isArray(b.drafts)) {
      d.progress.drafts = Object.fromEntries(Object.entries(b.drafts).filter(([k]) => ID.test(k)).slice(0, CAP.drafts).map(([k, v]) => [k, { code: text(v?.code, 20000), tahmin: text(v?.tahmin, 2000) }]));
    }
    write(d); res.json({ ok: true });
  });

  // start the progress over (the content and the notes stay)
  r.delete("/progress", (_req, res) => {
    const d = read(), keep = d.progress; d.progress = { ...emptyProgress(), notes: keep.notes };
    write(d); res.json({ ok: true });
  });
  return r;
}
