import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const name of ["PI_PACKAGE_DIR", "SUPERPOWERS_DIR"]) {
  if (!process.env[name]) throw new Error(`Set ${name} as shown in pi-extension.md.`);
}
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const extension = fileURLToPath(new URL("../../pi-extensions/phase4-plan-approval.ts", import.meta.url));
const skills = sdk.loadSkillsFromDir({ dir: path.join(process.env.SUPERPOWERS_DIR, "skills"), source: "user" }).skills;
const writingPlans = skills.find((skill) => skill.name === "writing-plans").filePath;

async function setup(context) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-phase4-approval-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
  const loaded = await sdk.discoverAndLoadExtensions([extension], cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const session = sdk.SessionManager.inMemory(cwd);
  // Pi binds appendEntry to the session at startup; do the same here.
  loaded.runtime.appendEntry = (customType, data) => session.appendCustomEntry(customType, data);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, session, undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const say = (text) => runner.emitInput(text, undefined, "rpc");
  const start = (prompt) => runner.emitBeforeAgentStart({ messageType: "user", prompt }, { cwd, skills });
  const call = (toolName, input) => runner.emitToolCall({ type: "tool_call", toolCallId: "call", toolName, input });
  return { cwd, errors, say, start, call };
}

const brainstorm = "Use Superpowers to brainstorm Phase 4 in specs/roadmap.md and save the design under docs/superpowers/specs/.";
const planning = "The Phase 4 design looks good. Please proceed with implementation planning.";
const editModel = { path: "models.py", edits: [{ oldText: "a", newText: "b" }] };

test("before design approval, code edits are refused with the design-only step", async (context) => {
  const { errors, say, start, call } = await setup(context);
  await say(brainstorm);
  await start(brainstorm);
  const refused = await call("edit", editModel);
  assert.equal(refused?.block, true);
  assert.match(refused.reason, /docs\/superpowers\/specs\//);
  assert.match(refused.reason, /end your turn/i);
  assert.equal(refused.terminate, undefined);
  assert.match(refused.reason, /^Blocked just now: your `edit` call on `models\.py`/);
  const shell = await call("bash", { command: 'find . -name "SKILL.md" 2>/dev/null || ls' });
  assert.equal(shell?.block, true);
  assert.match(shell.reason, /^Blocked just now: your `bash` call `find \. -name "SKILL\.md" 2>\/dev\/null \|\| ls`/);
  assert.match(shell.reason, /`\|\|`/);
  assert.match(shell.reason, /read, find and grep tools/);
  assert.match(shell.reason, /docs\/superpowers\/specs\//);
  assert.deepEqual(errors, []);
});

test("while planning with no new plan, refusals name the writing-plans skill and do not end the turn", async (context) => {
  const { errors, say, start, call } = await setup(context);
  await say(planning);
  await start(planning);
  const refused = await call("edit", editModel);
  assert.equal(refused?.block, true);
  assert.ok(refused.reason.includes(writingPlans), refused.reason);
  assert.match(refused.reason, /only the user's approval unlocks/i);
  assert.equal(refused.terminate, undefined);
  assert.equal((await call("write", { path: "docs/superpowers/plans/phase-4.md", content: "# Plan\n" }))?.block, undefined);
  assert.equal((await call("read", { path: "models.py" }))?.block, undefined);
  assert.deepEqual(errors, []);
});

test("once a new plan is saved, a refused code edit ends the turn", async (context) => {
  const { cwd, errors, say, start, call } = await setup(context);
  await writeFile(path.join(cwd, "docs/superpowers/plans/old.md"), "# Earlier phase\n");
  await say(planning);
  await start(planning);
  await writeFile(path.join(cwd, "docs/superpowers/plans/phase-4.md"), "# Plan\n");
  for (const [toolName, input] of [["edit", editModel], ["bash", { command: "echo testing guard" }]]) {
    const refused = await call(toolName, input);
    assert.equal(refused?.block, true);
    assert.equal(refused.terminate, true);
    assert.match(refused.reason, /docs\/superpowers\/plans\/phase-4\.md/);
  }
  assert.equal((await call("read", { path: "models.py" }))?.block, undefined);
  assert.deepEqual(errors, []);
});

test("planning may read the date and find files, but not change anything", async (context) => {
  const { errors, say, start, call } = await setup(context);
  await say(planning);
  await start(planning);
  for (const command of ["date", "date +%Y-%m-%d", "find docs -name '*plan*' -o -name '*plans*'", "find docs/superpowers -type f"]) {
    assert.equal((await call("bash", { command }))?.block, undefined, command);
  }
  for (const command of [
    "date -s 2020-01-01", "date 0101000020", "date; rm models.py", "find . -delete", "find docs -exec rm {} \;",
    "find /etc -name passwd", "find ../ -name x", "find docs -name x > out.txt", "find docs -fprint out.txt",
  ]) {
    assert.equal((await call("bash", { command }))?.block, true, command);
  }
  assert.deepEqual(errors, []);
});

const settingsPath = new URL("../../.pi/settings.json", import.meta.url);
const allExtensions = JSON.parse(await readFile(settingsPath, "utf8")).extensions
  .map((entry) => fileURLToPath(new URL(entry, settingsPath)));
const { today } = await import(pathToFileURL(extension).href);

// Every project extension, in settings order, so chained tool_result handlers run as in Pi.
async function setupAll(context) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-phase4-dates-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  for (const kind of ["plans", "specs"]) await mkdir(path.join(cwd, "docs/superpowers", kind), { recursive: true });
  const loaded = await sdk.discoverAndLoadExtensions(allExtensions, cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const session = sdk.SessionManager.inMemory(cwd);
  loaded.runtime.appendEntry = (customType, data) => session.appendCustomEntry(customType, data);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, session, undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const tools = { write: sdk.createWriteTool(cwd), edit: sdk.createEditTool(cwd) };
  const say = (text) => runner.emitInput(text, undefined, "rpc");
  const start = (prompt) => runner.emitBeforeAgentStart({ messageType: "user", prompt }, { cwd, skills });
  async function run(toolName, input) {
    const decision = await runner.emitToolCall({ type: "tool_call", toolCallId: toolName, toolName, input });
    assert.equal(decision?.block, undefined);
    const result = await tools[toolName].execute(toolName, input, undefined, undefined);
    return runner.emitToolResult({ type: "tool_result", toolCallId: toolName, toolName, input, ...result, isError: false });
  }
  return { cwd, errors, say, start, run };
}

const exists = (file) => access(file).then(() => true, () => false);
const texts = (result) => result.content.map((item) => item.text ?? "");

test("brainstorming and planning each get today's date once", async (context) => {
  const { errors, say, start } = await setupAll(context);
  const dated = (result) => result.messages.filter((m) => String(m.content).includes(today()));
  await say(brainstorm);
  const first = dated(await start(brainstorm));
  assert.equal(first.length, 1);
  assert.match(first[0].content, /YYYY-MM-DD-|docs\/superpowers\/specs\//);
  assert.equal(dated(await start("Skip the questions.")).length, 0);
  await say(planning);
  assert.equal(dated(await start(planning)).length, 1);
  assert.deepEqual(errors, []);
});

test("a new plan without today's date is renamed, and rewriting the old name updates it", async (context) => {
  const { cwd, errors, say, start, run } = await setupAll(context);
  await writeFile(path.join(cwd, "docs/superpowers/plans/2026-11-06-old.md"), "# Old\n");
  await say(planning);
  await start(planning);
  const undated = "docs/superpowers/plans/phase-4-plan.md";
  const dated = `docs/superpowers/plans/${today()}-phase-4-plan.md`;
  const result = await run("write", { path: undated, content: "# Plan\n\nRun: `pytest tests`\n" });
  assert.equal(await exists(path.join(cwd, undated)), false);
  assert.match(await readFile(path.join(cwd, dated), "utf8"), /uv run --frozen python -m pytest tests/);
  assert.ok(texts(result).some((text) => /frozen pytest/.test(text)), "the plan rewrite's note is kept");
  assert.ok(result.content.at(-1).text.includes(dated));
  await run("write", { path: undated, content: "# Plan v2\n" });
  assert.equal(await exists(path.join(cwd, undated)), false);
  assert.equal(await readFile(path.join(cwd, dated), "utf8"), "# Plan v2\n");
  await run("edit", { path: "docs/superpowers/plans/2026-11-06-old.md", edits: [{ oldText: "# Old", newText: "# Older" }] });
  assert.equal(await exists(path.join(cwd, "docs/superpowers/plans/2026-11-06-old.md")), true);
  assert.deepEqual(errors, []);
});

test("a misnamed spec is not renamed onto a file that predates the stage", async (context) => {
  const { cwd, errors, say, start, run } = await setupAll(context);
  const clash = `docs/superpowers/specs/${today()}-clash.md`;
  await writeFile(path.join(cwd, clash), "# Earlier\n");
  await say(brainstorm);
  await start(brainstorm);
  const result = await run("write", { path: "docs/superpowers/specs/clash.md", content: "# New\n" });
  assert.equal(await readFile(path.join(cwd, clash), "utf8"), "# Earlier\n");
  assert.equal(await exists(path.join(cwd, "docs/superpowers/specs/clash.md")), true);
  assert.match(result.content.at(-1).text, /already exists/);
  assert.deepEqual(errors, []);
});
