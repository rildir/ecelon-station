import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { cleanSteps, defaultPort, digest, facts, guessPlan, linksFor, planPrompt, portOpen } from "../server/launch.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launch-"));
const fe = path.join(tmp, "fe"), be = path.join(tmp, "be");
fs.mkdirSync(path.join(fe, "src/environments"), { recursive: true });
fs.mkdirSync(path.join(be, "Api/Properties"), { recursive: true });
fs.writeFileSync(path.join(fe, "package.json"), JSON.stringify({ scripts: { start: "ng serve", build: "ng build" }, dependencies: { "@angular/core": "1" } }));
fs.writeFileSync(path.join(fe, "src/environments/environment.ts"), `export const environment = { api: "http://localhost:5080/api", other: "https://prod.example.com" };`);
fs.writeFileSync(path.join(fe, ".env"), "SECRET_TOKEN=abc123");
fs.writeFileSync(path.join(be, "Api/Properties/launchSettings.json"), JSON.stringify({ profiles: { Api: { commandName: "Project", applicationUrl: "http://localhost:5080" } } }));
fs.writeFileSync(path.join(be, "Api/Api.csproj"), "<Project/>");
fs.writeFileSync(path.join(be, "appsettings.json"), JSON.stringify({ ConnectionStrings: { Db: "Server=x;Password=hunter2" } }));
fs.writeFileSync(path.join(be, "server.js"), "const PORT = process.env.PORT || 5090; app.listen(PORT);");
const projects = [{ team: "t1", name: "ERP Frontend", cwd: fe }, { team: "t2", name: "ERP Backend", cwd: be }];

test("digest names scripts and local addresses, never secrets or remote hosts", () => {
  const all = digest(fe) + "\n" + digest(be);
  assert.match(all, /start = ng serve/);
  assert.match(all, /localhost:5080/);
  assert.match(all, /Api\.csproj/);
  assert.match(all, /server\.js: listens on port 5090/);
  assert.doesNotMatch(all, /abc123|SECRET|hunter2|Password|prod\.example/);
  assert.doesNotMatch(all, /build = ng build/);
});

test("the prompt carries both projects", () => {
  const p = planPrompt(projects[0], projects);
  assert.match(p, /ERP Frontend/); assert.match(p, /ERP Backend/);
});

test("cleanSteps keeps only sound steps of known projects", () => {
  const s = cleanSteps([
    { project: "ERP Backend", cmd: "dotnet run", dir: "Api", port: 5080 },
    { team: "t2", cmd: "dotnet watch", port: 99999 },
    { project: "ERP Frontend", cmd: "npm start", dir: "./", port: 4200, label: "UI" },
    { project: "Unknown", cmd: "x" },
    { project: "ERP Frontend", cmd: "a\nb" },
    { project: "ERP Frontend", cmd: "npm start", dir: "../other" },
    { project: "ERP Frontend", cmd: "npm start", dir: "nope" },
  ], projects);
  assert.deepEqual(s.map((x) => [x.team, x.cmd, x.dir, x.port, x.label]), [
    ["t2", "dotnet run", "Api", 5080, "dotnet run"], ["t2", "dotnet watch", "", null, "dotnet watch"], ["t1", "npm start", "", 4200, "UI"],
  ]);
  assert.deepEqual(cleanSteps("junk", projects), []);
  assert.equal(cleanSteps(Array(9).fill({ project: "ERP Frontend", cmd: "npm start" }), projects).length, 5); // at most 5 steps
});

test("portOpen says no for a closed port", async () => {
  assert.equal(await portOpen(1, 300), false);
});

test("linksFor finds the address and an API's docs page, and does not mistake a single-page app for one", async () => {
  const api = http.createServer((q, r) => { if (q.url === "/swagger") { r.writeHead(301, { location: "/swagger/index.html" }); return r.end(); } if (q.url === "/swagger/index.html") return r.end("<div id=swagger-ui></div>"); r.writeHead(404); r.end(); }).listen(0);
  const spa = http.createServer((_q, r) => r.end("<app-root></app-root>")).listen(0);
  await new Promise((r) => setTimeout(r, 50));
  try {
    assert.deepEqual(await linksFor(api.address().port), { url: `http://localhost:${api.address().port}/swagger`, docs: `http://localhost:${api.address().port}/swagger` });
    assert.deepEqual(await linksFor(spa.address().port), { url: `http://localhost:${spa.address().port}/`, docs: null });
  } finally { api.close(); spa.close(); }
});

test("a plan without the model: the target's start script, and first the project whose port it calls", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guess-"));
  const api = path.join(root, "api"), shop = path.join(root, "shop"), lib = path.join(root, "lib");
  fs.mkdirSync(path.join(api, "src"), { recursive: true }); fs.mkdirSync(path.join(shop, "src"), { recursive: true }); fs.mkdirSync(lib);
  fs.writeFileSync(path.join(api, "package.json"), JSON.stringify({ scripts: { dev: "node --watch src/server.js", test: "node --test" } }));
  fs.writeFileSync(path.join(api, "src/server.js"), "const PORT = process.env.PORT || 3100; app.listen(PORT);");
  fs.writeFileSync(path.join(shop, "package.json"), JSON.stringify({ scripts: { dev: "vite", build: "vite build" }, devDependencies: { vite: "5" } }));
  fs.writeFileSync(path.join(shop, "src/api.js"), 'const BASE = import.meta.env.VITE_API_URL || "http://localhost:3100?token=SECRET";');
  fs.writeFileSync(path.join(lib, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
  const ps = [{ team: "a", name: "api", cwd: api }, { team: "s", name: "shop", cwd: shop }, { team: "l", name: "lib", cwd: lib }];
  assert.deepEqual(facts(api).serves, [3100]); assert.deepEqual(facts(shop).calls, [3100]);
  assert.doesNotMatch(facts(shop).text, /SECRET|token/); // a query string never leaves the file
  assert.deepEqual(guessPlan(ps[1], ps).map((x) => [x.project, x.cmd, x.port]), [["api", "npm run dev", 3100], ["shop", "npm run dev", 5173]]);
  assert.deepEqual(guessPlan(ps[0], ps).map((x) => [x.project, x.cmd, x.port]), [["api", "npm run dev", 3100]]);
  assert.equal(guessPlan(ps[2], ps), null); // a library with only a build script cannot be started
});

test("default ports of well-known dev servers, and a port named by the script itself", () => {
  assert.equal(defaultPort("vite"), 5173); assert.equal(defaultPort("ng serve"), 4200); assert.equal(defaultPort("next dev"), 3000); assert.equal(defaultPort("node x.js"), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "port-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { "start:dev": "nx serve app --port 4201", start: "nx serve app" } }));
  assert.deepEqual(facts(dir).start, { cmd: "npm run start:dev", dir: "", port: 4201 });
});
