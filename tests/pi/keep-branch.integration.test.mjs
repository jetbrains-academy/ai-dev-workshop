import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_PACKAGE_DIR) throw new Error("Set PI_PACKAGE_DIR as shown in pi-extension.md.");
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const settingsPath = new URL("../../.pi/settings.json", import.meta.url);
const settings = JSON.parse(await readFile(settingsPath, "utf8"));
const cwd = fileURLToPath(new URL("../../", import.meta.url));

test("workshop Pi keeps its branch while allowing ordinary Git work", async (context) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-keep-branch-"));
  context.after(() => rm(agentDir, { recursive: true, force: true }));
  const extensions = settings.extensions.map((entry) => fileURLToPath(new URL(entry, settingsPath)));
  const loaded = await sdk.discoverAndLoadExtensions(extensions, cwd, agentDir);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
  const call = (command) => runner.emitToolCall({ type: "tool_call", toolCallId: "git", toolName: "bash", input: { command } });

  for (const command of [
    "git checkout main", "git merge phase-4-rehearsal", "git branch -d phase-4-rehearsal",
    "git pull --ff-only", "git push origin HEAD", "git switch main", "git branch -D old",
    "git branch --delete old", 'git -C "$PWD" merge main', "command /usr/bin/git merge main",
    "git status && git merge main", "git -c color.ui=never push origin HEAD",
  ]) {
    const decision = await call(command);
    assert.equal(decision?.block, true, command);
    assert.match(decision.reason, /keep the current branch/i);
  }

  for (const command of [
    "git status", "git branch --show-current", "git log --oneline", "git add app.py",
    'git commit -m "docs: mention git merge and git push"', "git branch --list",
    "git checkout -- app.py", "git restore app.py", 'echo "git merge main"',
  ]) {
    assert.equal((await call(command))?.block, undefined, command);
  }
});
