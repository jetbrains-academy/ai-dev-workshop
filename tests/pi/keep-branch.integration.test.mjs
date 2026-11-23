import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const suite = "uv run --frozen python -m pytest tests";
const grader = "uv run --frozen python -m pytest -v --tb=line --disable-warnings tests/phase4_acceptance.py";
const pending = "## Phase 4 — Resolve and Reopen";
const done = pending + " (Done)";

test("marking Phase 4 done requires both exact successful checks on the current implementation", async (context) => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-phase4-finish-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: project });
  await mkdir(path.join(project, "specs"));
  const roadmap = path.join(project, "specs/roadmap.md");
  await writeFile(roadmap, pending + "\n");
  const app = path.join(project, "app.py");
  await writeFile(app, "version = 1\n");

  const extensions = settings.extensions.map((entry) => fileURLToPath(new URL(entry, settingsPath)));
  const loaded = await sdk.discoverAndLoadExtensions(extensions, project, project);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, project, sdk.SessionManager.inMemory(project), undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const call = (toolName, input) => runner.emitToolCall({ type: "tool_call", toolCallId: "call", toolName, input });
  const result = (toolName, input, isError = false) => runner.emitToolResult({
    type: "tool_result", toolCallId: "call", toolName, input, isError, content: [],
  });
  const run = async (command, isError = false) => {
    const input = { command };
    assert.equal((await call("bash", input))?.block, undefined, command);
    await result("bash", input, isError);
  };
  const mark = () => call("edit", { path: "specs/roadmap.md", edits: [{ oldText: pending, newText: done }] });

  const denied = await mark();
  assert.equal(denied?.block, true);
  assert.ok(denied.reason.includes(suite) && denied.reason.includes(grader));
  assert.equal((await call("edit", { path: roadmap, edits: [{ oldText: pending, newText: pending + "\n\nDetails." }] }))?.block, undefined);
  assert.equal((await call("write", { path: roadmap, content: done + "\n" }))?.block, true);
  assert.equal((await call("bash", { command: "sed -i '' 's/Reopen/Reopen (Done)/' specs/roadmap.md" }))?.block, true);
  assert.equal((await call("bash", { command: "cat specs/roadmap.md" }))?.block, undefined);

  const indirect = { command: "sh mark.sh" };
  await writeFile(path.join(project, "mark.sh"), `printf '%s\\n' '${done}' 'Other edits stay.' > specs/roadmap.md\n`);
  assert.equal((await call("bash", indirect))?.block, undefined);
  await sdk.createBashTool(project).execute("call", indirect, undefined, undefined);
  assert.equal((await result("bash", indirect)).isError, true);
  assert.equal(await readFile(roadmap, "utf8"), pending + "\nOther edits stay.\n");

  await run("uv run --frozen python -m pytest");
  await run(grader);
  assert.equal((await mark())?.block, true);
  await run(suite, true);
  assert.equal((await mark())?.block, true);
  await run(suite);
  assert.equal((await mark())?.block, true, "both checks must pass again after a failed check");
  await run(grader);
  assert.equal((await mark())?.block, undefined);

  await writeFile(app, "version = 2\n");
  assert.equal((await mark())?.block, true);
  await run(suite);
  await run(grader);
  assert.equal((await mark())?.block, undefined);
  assert.deepEqual(errors, []);
});
