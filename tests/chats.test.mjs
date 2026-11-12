import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempData, rm } from "./_setup.mjs";

const DATA = tempData();
const { addAgent, ensureFullTeams, listAgents, attachChat, getAgent } = await import("../server/agents.js");
test.after(() => rm(DATA));
const dir = (n) => { const d = path.join(DATA, n); fs.mkdirSync(d, { recursive: true }); return d; };

test("a free chat stays one assistant: no team is added to it", () => {
  const chat = addAgent({ name: "New chat", cwd: dir("chats/a1"), solo: true });
  const proj = addAgent({ name: "shop", cwd: dir("shop") });
  ensureFullTeams();
  const all = listAgents();
  assert.equal(all.filter((a) => (a.team || a.id) === chat.id).length, 1);
  assert.equal(all.filter((a) => (a.team || a.id) === proj.id).length, 4);
});

test("turning a chat into a project gives it the folder, the folder's name, a new session and then a team", () => {
  const chat = listAgents().find((a) => a.solo);
  const target = dir("erp-frontend");
  assert.throws(() => attachChat(chat.id, path.join(DATA, "shop")), /already a project/i); // that folder is taken
  const a = attachChat(chat.id, target);
  assert.equal(a.cwd, target); assert.equal(a.name, "erp-frontend"); assert.equal(a.solo, undefined); assert.equal(a.sessionId, null);
  ensureFullTeams();
  assert.equal(listAgents().filter((x) => (x.team || x.id) === chat.id).length, 4);
  assert.throws(() => attachChat(chat.id, dir("other")), /already a project/i); // it is a project now
  assert.equal(getAgent(chat.id).cwd, target);
});
