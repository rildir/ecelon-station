// Shared test helpers: every test file gets its own empty data folder so tests never touch real data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempData(prefix = "ecelon-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.ECELON_DATA = dir;
  return dir;
}
export const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
