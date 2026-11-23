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

test("only the finish prompt marks Phase 4 done; model changes are refused or rolled back", async (context) => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-phase4-finish-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: project });
  await mkdir(path.join(project, "specs"));
  const roadmap = path.join(project, "specs/roadmap.md");
  await writeFile(roadmap, pending + "\n");

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
  const shell = async (command, isError = false) => {
    const input = { command };
    assert.equal((await call("bash", input))?.block, undefined, command);
    await sdk.createBashTool(project).execute("call", input, undefined, undefined).catch(() => {});
    return result("bash", input, isError);
  };
  const mark = () => call("edit", { path: "specs/roadmap.md", edits: [{ oldText: pending, newText: done }] });

  const denied = await mark();
  assert.equal(denied?.block, true);
  assert.match(denied.reason, /finish prompt/);
  assert.equal((await call("write", { path: roadmap, content: done + "\n" }))?.block, true);
  assert.equal((await call("edit", { path: roadmap, edits: [{ oldText: pending, newText: pending + "\n\nDetails." }] }))?.block, undefined);

  for (const command of ["find . -name roadmap.md", 'grep -n "Phase 4" specs/roadmap.md', "cat specs/roadmap.md"]) {
    assert.equal((await shell(command))?.isError, undefined, command);
  }

  await writeFile(path.join(project, "mark.sh"), `printf '%s\\n' '${done}' 'Other edits stay.' > specs/roadmap.md\n`);
  const indirect = await shell("sh mark.sh");
  assert.equal(indirect?.isError, true);
  assert.match(indirect.content.at(-1).text, /finish prompt/);
  assert.equal(await readFile(roadmap, "utf8"), pending + "\nOther edits stay.\n");

  assert.equal((await shell("sed -i '' 's/Reopen$/Reopen (Done)/' specs/roadmap.md"))?.isError, true);
  assert.equal((await readFile(roadmap, "utf8")).split("\n")[0], pending);

  await shell(suite);
  await shell(grader);
  assert.equal((await mark())?.block, true, "passing checks do not let the model mark it done");
  assert.deepEqual(errors, []);
});

test("the Phase 4 grader stays as shipped: edits are refused, shell changes rolled back, finish checks it", async (context) => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-phase4-grader-"));
  context.after(() => rm(project, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: project });
  await mkdir(path.join(project, "specs"));
  await mkdir(path.join(project, "tests"));
  await writeFile(path.join(project, "specs/roadmap.md"), pending + "\n");
  const grader = path.join(project, "tests/phase4_acceptance.py");
  const shipped = await readFile(new URL("../phase4_acceptance.py", import.meta.url), "utf8");
  await writeFile(grader, shipped);

  const extensions = settings.extensions.map((entry) => fileURLToPath(new URL(entry, settingsPath)));
  const loaded = await sdk.discoverAndLoadExtensions(extensions, project, project);
  assert.deepEqual(loaded.errors, []);
  const sent = [];
  loaded.runtime.sendMessage = (message) => sent.push(message);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, project, sdk.SessionManager.inMemory(project), undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const call = (toolName, input) => runner.emitToolCall({ type: "tool_call", toolCallId: "call", toolName, input });
  const result = (toolName, input) => runner.emitToolResult({
    type: "tool_result", toolCallId: "call", toolName, input, isError: false, content: [],
  });

  for (const [toolName, input] of [
    ["edit", { path: "tests/phase4_acceptance.py", edits: [{ oldText: '"Open" in', newText: '"open" in' }] }],
    ["write", { path: grader, content: "def test_nothing():\n    pass\n" }],
  ]) {
    const refused = await call(toolName, input);
    assert.equal(refused?.block, true, toolName);
    assert.match(refused.reason, /grader/i);
    assert.match(refused.reason, /tests\/test_phase4\.py/);
  }
  assert.equal((await call("read", { path: "tests/phase4_acceptance.py" }))?.block, undefined);
  assert.equal((await call("edit", { path: "tests/test_board.py", edits: [{ oldText: "a", newText: "b" }] }))?.block, undefined);

  const weaken = { command: "sed -i '' 's/\"Open\" in/\"open\" in/' tests/phase4_acceptance.py" };
  assert.equal((await call("bash", weaken))?.block, undefined);
  await sdk.createBashTool(project).execute("call", weaken, undefined, undefined);
  const rolledBack = await result("bash", weaken);
  assert.equal(rolledBack?.isError, true);
  assert.match(rolledBack.content.at(-1).text, /grader/i);
  assert.equal(await readFile(grader, "utf8"), shipped);

  await writeFile(grader, shipped.replace('"Open" in', '"open" in'));
  await runner.emitInput("Use Superpowers to finish Phase 4. Keep the current branch as-is and mark Phase 4 done in specs/roadmap.md.", undefined, "rpc");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].details.markedDone, false);
  assert.match(sent[0].content, /phase4_acceptance\.py/);
  assert.equal(await readFile(path.join(project, "specs/roadmap.md"), "utf8"), pending + "\n");
  assert.deepEqual(errors, []);
});
