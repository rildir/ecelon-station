// Ecelon Station desktop shell (Electron): a window of its own, with its own icon and taskbar identity, around
// the same local server the browser version uses. Nothing here talks to the internet.
//
//   npm run desktop            run from a clone (uses this folder's data, like `npm start`)
//   npm run dist               build the Windows installer and the portable exe (see package.json "build")
//
// What it does:
//   - starts the server if it is not already running (bundled Node when packaged, the system `node` otherwise)
//     and stops it on Quit — but only a server it started itself;
//   - one window, no browser menu, no developer tools (start with --dev to get them back);
//   - closing the window keeps the station in the tray so agents go on working; Quit is in the tray menu;
//   - links to other sites open in the default browser, never inside the window.
import { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage } from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 4777;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DEV = process.argv.includes("--dev");
const ICON = path.join(ROOT, "public", process.platform === "win32" ? "icon.ico" : "icon-256.png");
const TOKEN = randomBytes(24).toString("hex");
const APP_ID = "dev.ecelon.station";

const TR = app.getLocale().toLowerCase().startsWith("tr");
const L = TR
  ? { open: "Ecelon Station'ı aç", quit: "Çık", tip: "Ecelon Station", startFail: "Ecelon Station başlatılamadı", needNode: "Sunucu başlatılamadı. Node.js 20 veya üstü kurulu mu? (node -v)", log: "Ayrıntı", busyTitle: "Ajanlar çalışıyor", busy: (n) => `${n} ajan şu an çalışıyor. Çıkarsan işleri yarıda kalır.`, quitAnyway: "Yine de çık", cancel: "Vazgeç", tray: "Ecelon Station arka planda çalışmaya devam ediyor. Kapatmak için tepsideki simgeye sağ tıkla → Çık." }
  : { open: "Open Ecelon Station", quit: "Quit", tip: "Ecelon Station", startFail: "Ecelon Station could not be started", needNode: "The server could not be started. Is Node.js 20 or newer installed? (node -v)", log: "Details", busyTitle: "Agents are working", busy: (n) => `${n} ${n === 1 ? "agent is" : "agents are"} working right now. Quitting stops them mid-task.`, quitAnyway: "Quit anyway", cancel: "Cancel", tray: "Ecelon Station keeps running in the background. To close it, right-click the tray icon → Quit." };

let win = null, tray = null, ownServer = false, quitting = false, trayHintShown = false;

const up = async () => { try { const r = await fetch(`${ORIGIN}/api/meta`, { signal: AbortSignal.timeout(900) }); return r.ok; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where the data lives: from a clone, the clone's own data folder (an existing installation keeps its projects);
// installed, the user's app-data folder — the program folder is not writable. ECELON_DATA overrides both.
function dataDir() {
  if (process.env.ECELON_DATA) return process.env.ECELON_DATA;
  return app.isPackaged ? path.join(app.getPath("userData"), "data") : null;
}
function nodeBinary() {
  const bundled = path.join(process.resourcesPath || "", "node", process.platform === "win32" ? "node.exe" : "node");
  return app.isPackaged && fs.existsSync(bundled) ? bundled : "node";
}
async function startServer() {
  if (await up()) return true; // someone already runs it (the browser launcher, a terminal): use that one, leave it alone on Quit
  const data = dataDir(), logDir = data || path.join(ROOT, "data");
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, "server.log"), "a");
  const env = { ...process.env, PORT: String(PORT), ECELON_SHELL_TOKEN: TOKEN, ...(data ? { ECELON_DATA: data } : {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  let failed = false;
  const child = spawn(nodeBinary(), [path.join(ROOT, "server", "index.js")], { cwd: ROOT, env, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  child.on("error", () => { failed = true; });
  child.unref(); ownServer = true;
  for (let i = 0; i < 80 && !failed; i++) { await sleep(250); if (await up()) return true; }
  ownServer = false;
  dialog.showErrorBox(L.startFail, `${L.needNode}\n\n${L.log}: ${path.join(logDir, "server.log")}`);
  return false;
}
// Stop the server we started. It may have restarted itself since (new process, same token), so ask it over HTTP.
async function stopServer() {
  if (!ownServer) return;
  try { await fetch(`${ORIGIN}/api/quit`, { method: "POST", headers: { "x-ecelon-shell": TOKEN }, signal: AbortSignal.timeout(1500) }); } catch { /* already gone */ }
}
async function busyCount() {
  try { const list = await (await fetch(`${ORIGIN}/api/agents`, { signal: AbortSignal.timeout(900) })).json(); return list.filter((a) => a.status === "thinking" || a.status === "tool").length; } catch { return 0; }
}

const sameOrigin = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };
const webPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: DEV, spellcheck: false }; // spellcheck off: Electron would download its dictionaries from the internet

function harden(w) {
  w.setMenuBarVisibility(false);
  w.webContents.on("will-navigate", (e, url) => { if (!sameOrigin(url)) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) return { action: "allow", overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, backgroundColor: "#0b0d14", webPreferences } }; // proof report, previews
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("did-create-window", (child) => harden(child));
  // the page asks for notifications and the clipboard; nothing else (no camera, microphone, location)
  w.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(["notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen"].includes(permission)));
  w.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase(), mod = input.control || input.meta;
    if (key === "f5" || (mod && key === "r")) { e.preventDefault(); w.webContents.reload(); }
    else if (DEV && key === "f12") { e.preventDefault(); w.webContents.toggleDevTools(); }
  });
}
function createWindow() {
  win = new BrowserWindow({ width: 1600, height: 960, minWidth: 980, minHeight: 640, title: "Ecelon Station", icon: ICON, backgroundColor: "#0b0d14", autoHideMenuBar: true, show: false, webPreferences });
  harden(win);
  // Run from a clone, the process is the stock electron.exe: pinned to the taskbar as it is, the pin would start a
  // bare Electron with its logo. Tell Windows what this window is and how to start it again, so the pin carries
  // our name and icon and reopens the station. (The packaged exe needs none of this.)
  if (process.platform === "win32" && !app.isPackaged) {
    try { win.setAppDetails({ appId: APP_ID, appIconPath: ICON, appIconIndex: 0, relaunchCommand: `"${process.execPath}" "${path.join(ROOT, "desktop", "main.js")}"`, relaunchDisplayName: "Ecelon Station" }); } catch { /* older Windows */ }
  }
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    if (!tray) { quit(); return; } // no tray on this desktop: closing the window is quitting
    win.hide(); // agents keep working; the tray icon brings the window back
    if (!trayHintShown && tray && process.platform === "win32") { trayHintShown = true; try { tray.displayBalloon({ title: "Ecelon Station", content: L.tray, iconType: "info" }); } catch { /* no balloons on this system */ } }
  });
  win.on("closed", () => { win = null; });
  win.loadURL(`${ORIGIN}/?app=1`);
}
const showWindow = () => { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } };

async function quit() {
  if (ownServer) {
    const n = await busyCount();
    if (n) {
      const { response } = await dialog.showMessageBox({ type: "warning", title: L.busyTitle, message: L.busyTitle, detail: L.busy(n), buttons: [L.cancel, L.quitAnyway], defaultId: 0, cancelId: 0, noLink: true });
      if (response !== 1) return;
    }
  }
  quitting = true; await stopServer(); app.quit();
}
function createTray() {
  const img = nativeImage.createFromPath(ICON);
  tray = new Tray(process.platform === "win32" ? img : img.resize({ width: 22, height: 22 }));
  tray.setToolTip(L.tip);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: L.open, click: showWindow }, { type: "separator" }, { label: L.quit, click: quit }]));
  tray.on("click", showWindow);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId(APP_ID); // one taskbar button with our icon; the pinned shortcut starts this app
  Menu.setApplicationMenu(null);              // no browser menu, and with it no reload/devtools accelerators
  app.on("second-instance", showWindow);
  app.on("window-all-closed", () => { /* stay in the tray */ });
  app.on("before-quit", () => { quitting = true; });
  app.whenReady().then(async () => {
    if (!(await startServer())) { app.exit(1); return; }
    try { createTray(); } catch { /* no tray on this desktop: the window's close button then quits */ }
    createWindow();
  });
}
