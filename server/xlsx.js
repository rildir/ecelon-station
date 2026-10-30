// A small dependency-free (apart from JSZip) .xlsx reader: preview and text for agents.
// Understands formula results (cached values), shared strings and date formats.
import JSZip from "jszip";
import { t } from "./i18n.js";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unxml(m[1]) : null; };
const texts = (xml) => { let out = ""; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) out += unxml(m[1]); return out; };
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function excelDate(serial, withTime) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms); if (isNaN(d)) return String(serial);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return withTime && (d.getUTCHours() || d.getUTCMinutes()) ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}

const MAX_ZIP = 25 * 1024 * 1024, MAX_INFLATED = 200 * 1024 * 1024;
export async function readXlsx(buf, { maxRows = 1000, maxCols = 60 } = {}) {
  // zip-bomb guard: cap the compressed size up front, and the summed uncompressed size of what we read
  if (buf.length > MAX_ZIP) throw new Error(t("The spreadsheet is too large to preview ({mb} MB; the limit is {max} MB)", { mb: Math.round(buf.length / 1048576), max: MAX_ZIP / 1048576 }));
  const zip = await JSZip.loadAsync(buf);
  let inflated = 0;
  const read = async (p) => {
    const f = zip.file(p); if (!f) return "";
    const declared = f._data?.uncompressedSize; // from the zip directory, known before inflating
    if (declared > MAX_INFLATED || inflated + (declared || 0) > MAX_INFLATED) throw new Error(t("The spreadsheet expands to too much data and was not opened"));
    const out = await f.async("string");
    inflated += out.length;
    if (inflated > MAX_INFLATED) throw new Error(t("The spreadsheet expands to too much data and was not opened"));
    return out;
  };
  const wb = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) relMap[attr(m[0], "Id")] = attr(m[0], "Target");
  const shared = [];
  for (const m of (await read("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));

  // styles: which cell format is a date?
  const styles = await read("xl/styles.xml");
  const customDate = new Set();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const code = (attr(m[0], "formatCode") || "").replace(/\[[^\]]*\]|"[^"]*"|\\./g, "");
    if (/[dmyhs]/i.test(code) && !/^general$/i.test(code)) customDate.add(Number(attr(m[0], "numFmtId")));
  }
  const xfDate = [];
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || "";
  for (const m of cellXfs.matchAll(/<xf\b[^>]*\/?>/g)) { const id = Number(attr(m[0], "numFmtId") || 0); xfDate.push(BUILTIN_DATE.has(id) || customDate.has(id)); }

  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name"), rid = attr(m[0], "r:id");
    let target = relMap[rid]; if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    const xml = await read(target);
    const rows = []; let truncated = false, width = 0;
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const rIdx = Number(attr(rm[0], "r")) - 1;
      if (rIdx >= maxRows) { truncated = true; break; }
      const row = [];
      for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = "<c" + cm[1] + ">", body = cm[2] || "";
        const ref = attr(tag, "r"); const ci = ref ? colIndex(ref) : row.length;
        if (ci >= maxCols) continue;
        const ty = attr(tag, "t"), s = Number(attr(tag, "s") || 0);
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = "";
        if (ty === "s") val = shared[Number(v)] ?? "";
        else if (ty === "inlineStr") val = texts(body);
        else if (ty === "b") val = v === "1" ? t("TRUE") : t("FALSE");
        else if (ty === "str" || ty === "e") val = v != null ? unxml(v) : "";
        else if (v != null) { const n = Number(v); val = xfDate[s] && isFinite(n) ? excelDate(n, true) : (isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : unxml(v)); }
        row[ci] = val;
      }
      if (!isNaN(rIdx)) { while (rows.length < rIdx) rows.push([]); rows[rIdx] = row; } else rows.push(row);
      width = Math.max(width, row.length);
    }
    // drop trailing empty rows
    while (rows.length && !rows[rows.length - 1].some((x) => x !== undefined && x !== "")) rows.pop();
    sheets.push({ name, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")), truncated });
  }
  return sheets;
}

// Plain text for agents: every sheet is a separate markdown table
export function sheetsToMarkdown(sheets) {
  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return sheets.map((sh) => {
    if (!sh.rows.length) return `## ${sh.name}\n\n${t("(empty sheet)")}`;
    const [head, ...body] = sh.rows;
    const w = head.length || 1;
    const line = (r) => "| " + Array.from({ length: w }, (_, i) => esc(r[i] ?? "")).join(" | ") + " |";
    return `## ${sh.name}\n\n${line(head)}\n|${" --- |".repeat(w)}\n${body.map(line).join("\n")}${sh.truncated ? "\n\n" + t("(… sheet truncated)") : ""}`;
  }).join("\n\n");
}
