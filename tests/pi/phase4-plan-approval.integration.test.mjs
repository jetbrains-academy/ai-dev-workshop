import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const name of ["PI_PACKAGE_DIR", "SUPERPOWERS_DIR"]) {
  if (!process.env[name]) throw new Error(`Set ${name} as shown in pi-extension.md.`);
}
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const extension = fileURLToPath(new URL("../../pi-extensions/phase4-plan-approval.ts", import.meta.url));
const skills = sdk.loadSkillsFromDir({ dir: path.join(process.env.SUPERPOWERS_DIR, "skills"), source: "user" }).skills;
const writingPlans = skills.find((skill) => skill.name === "writing-plans").filePath;

async function setup(context, reuse) {
  const cwd = reuse?.cwd ?? await mkdtemp(path.join(tmpdir(), "pi-phase4-approval-"));
  if (!reuse) {
    context.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
  }
  const loaded = await sdk.discoverAndLoadExtensions([extension], cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const session = reuse?.session ?? sdk.SessionManager.inMemory(cwd);
  // Pi binds appendEntry and sendMessage to the session at startup; do the same here.
  loaded.runtime.appendEntry = (customType, data) => session.appendCustomEntry(customType, data);
  const sent = [];
  loaded.runtime.sendMessage = (message, options) => sent.push({ message, options });
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, session, undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const say = (text) => runner.emitInput(text, undefined, "rpc");
  const start = (prompt) => runner.emitBeforeAgentStart({ messageType: "user", prompt }, { cwd, skills });
  const call = (toolName, input) => runner.emitToolCall({ type: "tool_call", toolCallId: "call", toolName, input });
  const compact = () => runner.emit({
    type: "session_compact", fromExtension: false, reason: "threshold", willRetry: false,
    compactionEntry: { type: "compaction", id: "c", parentId: null, timestamp: new Date().toISOString(),
      summary: "s", firstKeptEntryId: "x", tokensBefore: 45000 },
  });
  const result = (command, text, isError = false) => runner.emitToolResult({ type: "tool_result", toolCallId: "b",
    toolName: "bash", input: { command }, content: [{ type: "text", text }], isError });
  const emit = (event) => runner.emit(event);
  return { cwd, session, errors, say, start, call, sent, compact, result, emit };
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
  assert.ok(first[0].content.includes(`docs/superpowers/specs/${today()}-`), first[0].content);
  // Naming the plans folder while brainstorming led Pi to write a plan too (4 of 4 runs on 2026-11-25).
  assert.doesNotMatch(first[0].content, /plans/);
  assert.equal(dated(await start("Skip the questions.")).length, 0);
  await say(planning);
  const second = dated(await start(planning));
  assert.equal(second.length, 1);
  assert.ok(second[0].content.includes(`docs/superpowers/plans/${today()}-`), second[0].content);
  assert.doesNotMatch(second[0].content, /specs/);
  assert.deepEqual(errors, []);
});

const APPROVAL = "The plan looks good. Proceed with native execution.";
const scripts = path.join(path.dirname(skills.find((skill) => skill.name === "executing-plans").filePath), "scripts");
const twoTasks = "# Plan\n\n### Task 1: Model\n\n- [ ] step\n\n### Task 2: Routes\n\n- [ ] step\n";
const planMessages = (result) => result.messages.filter((m) => m.customType === "workshop-phase4-plan");

test("the executing-plans approval prompt unlocks execution and brings one plan note", async (context) => {
  const { cwd, errors, say, start, call } = await setup(context);
  const { planNote, planTasks } = await import(pathToFileURL(extension).href);
  await say(planning);
  await start(planning);
  const plan = "docs/superpowers/plans/2026-11-25-p.md";
  await writeFile(path.join(cwd, plan), twoTasks);
  await say("/skill:executing-plans " + APPROVAL);
  assert.equal((await call("edit", editModel))?.block, undefined);
  const notes = planMessages(await start("/skill:executing-plans " + APPROVAL));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].content, planNote(plan, planTasks(twoTasks), { started: {}, recorded: [] }, scripts));
  assert.equal(planMessages(await start("Continue.")).length, 0);
  assert.deepEqual(errors, []);
});

test("with two plans saved while planning, the note names the newest", async (context) => {
  const { cwd, errors, say, start } = await setup(context);
  await say(planning);
  await start(planning);
  const older = path.join(cwd, "docs/superpowers/plans/2026-11-25-a.md");
  const newer = path.join(cwd, "docs/superpowers/plans/2026-11-25-b.md");
  await writeFile(older, twoTasks);
  await writeFile(newer, twoTasks);
  await utimes(older, new Date(2026, 10, 25, 9), new Date(2026, 10, 25, 9));
  await utimes(newer, new Date(2026, 10, 25, 10), new Date(2026, 10, 25, 10));
  await say(APPROVAL);
  const [note] = planMessages(await start(APPROVAL));
  assert.match(note.content, /2026-11-25-b\.md/);
  assert.doesNotMatch(note.content, /2026-11-25-a\.md/);
  assert.deepEqual(errors, []);
});

const FINISH = "Use Superpowers to finish Phase 4. Keep the current branch as-is and mark Phase 4 done in specs/roadmap.md.";
const plan = "docs/superpowers/plans/2026-11-25-p.md";
const taskStart = (n) => `${scripts}/task-start ${plan} ${n}`;
const taskDone = (n) => `${scripts}/task-done ${plan} ${n} abc1234 -- uv run --frozen python -m pytest tests/test_models.py`;
const ledgerLine = (n) => `ledger: Task ${n}: complete (commits abc1234..def5678, tests: pytest → 1 passed)`;

async function approvedRun(context) {
  const run = await setup(context);
  await run.say(planning);
  await run.start(planning);
  await writeFile(path.join(run.cwd, plan), twoTasks);
  await run.say("/skill:executing-plans " + APPROVAL);
  await run.start("/skill:executing-plans " + APPROVAL);
  const { planNote, planTasks } = await import(pathToFileURL(extension).href);
  run.note = (progress) => planNote(plan, planTasks(twoTasks), progress, scripts);
  return run;
}

test("after a compaction mid-task, Pi is told to continue that task", async (context) => {
  const { errors, result, compact, sent, note } = await approvedRun(context);
  await result(taskStart(1), "brief: /w/task-1-brief.md\nbase: abc1234");
  await compact();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.deliverAs, "steer");
  assert.equal(sent[0].options.triggerTurn, undefined);
  assert.equal(sent[0].message.customType, "workshop-phase4-plan");
  assert.equal(sent[0].message.content, note({ started: { 1: { brief: "/w/task-1-brief.md", base: "abc1234" } }, recorded: [] }));
  assert.deepEqual(errors, []);
});

test("failed task-start and task-done calls record nothing", async (context) => {
  const { errors, result, compact, sent, note } = await approvedRun(context);
  await result(taskStart(1), "brief: /w/task-1-brief.md\nbase: abc1234", true);
  await result(taskStart(1), "usage: task-start PLAN_FILE TASK_NUMBER");
  await result(taskDone(1), "task-done: test command exited 1; Task 1 NOT recorded", true);
  await compact();
  assert.equal(sent[0].message.content, note({ started: {}, recorded: [] }));
  assert.deepEqual(errors, []);
});

test("recorded tasks survive the ledger being deleted", async (context) => {
  const { cwd, errors, result, compact, sent, note } = await approvedRun(context);
  const ledger = path.join(cwd, ".superpowers/sdd/2026-11-25-p");
  await mkdir(ledger, { recursive: true });
  await writeFile(path.join(ledger, "progress.md"), `# SDD ledger — plan: ${plan}\nTask 1: complete (x)\n`);
  await result(taskDone(1), "1 passed\n" + ledgerLine(1));
  await rm(path.join(cwd, ".superpowers"), { recursive: true });
  await compact();
  assert.equal(sent[0].message.content, note({ started: {}, recorded: [1] }));
  assert.deepEqual(errors, []);
});

test("no note once every task is recorded, from results or the ledger", async (context) => {
  const { cwd, errors, result, compact, sent } = await approvedRun(context);
  await result(taskDone(1), ledgerLine(1));
  const ledger = path.join(cwd, ".superpowers/sdd/2026-11-25-p");
  await mkdir(ledger, { recursive: true });
  await writeFile(path.join(ledger, "progress.md"), `# SDD ledger — plan: ${plan}\nTask 2: complete (x)\n`);
  await compact();
  assert.equal(sent.length, 0);
  assert.deepEqual(errors, []);
});

test("no note after the finish prompt or before approval", async (context) => {
  const early = await setup(context);
  await early.say(planning);
  await early.compact();
  assert.equal(early.sent.length, 0);
  const { say, compact, sent, call, errors } = await approvedRun(context);
  await say(FINISH);
  await compact();
  assert.equal(sent.length, 0);
  assert.equal((await call("edit", editModel))?.block, undefined);
  assert.deepEqual(errors, [...early.errors]);
});

test("progress is kept in the session, not in memory", async (context) => {
  const first = await approvedRun(context);
  await first.result(taskStart(2), "brief: /w/task-2-brief.md\nbase: abc1234");
  await first.result(taskDone(1), ledgerLine(1));
  const second = await setup(context, { cwd: first.cwd, session: first.session });
  await second.start("Continue.");
  await second.compact();
  assert.equal(second.sent[0].message.content,
    first.note({ started: { 2: { brief: "/w/task-2-brief.md", base: "abc1234" } }, recorded: [1] }));
  assert.deepEqual([...first.errors, ...second.errors], []);
});

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function gitInit(cwd) {
  git(cwd, "init", "-q");
  git(cwd, "-c", "user.email=t@localhost", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "seed");
}

test("a compaction after the run ended waits for the next prompt", async (context) => {
  const { errors, result, compact, sent, emit } = await approvedRun(context);
  await result(taskStart(1), "brief: /w/task-1-brief.md\nbase: abc1234");
  await emit({ type: "agent_end", messages: [] });
  await compact();
  assert.equal(sent.at(-1).options.deliverAs, "nextTurn");
  await emit({ type: "agent_start" });
  await compact();
  assert.equal(sent.at(-1).options.deliverAs, "steer");
  assert.deepEqual(errors, []);
});

test("the note after a compaction lists commits made since approval", async (context) => {
  const run = await setup(context);
  gitInit(run.cwd);
  await run.say(planning);
  await run.start(planning);
  await writeFile(path.join(run.cwd, plan), twoTasks);
  await run.say(APPROVAL);
  await run.start(APPROVAL);
  git(run.cwd, "-c", "user.email=t@localhost", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "feat: model status");
  await run.compact();
  assert.match(run.sent[0].message.content, /Commits since approval: [0-9a-f]+ feat: model status/);
  assert.deepEqual(run.errors, []);
});

test("the approval note skips a newer plan file that has no tasks", async (context) => {
  const { cwd, errors, say, start } = await setup(context);
  await say(planning);
  await start(planning);
  const real = path.join(cwd, "docs/superpowers/plans/2026-11-25-plan.md");
  const notes = path.join(cwd, "docs/superpowers/plans/2026-11-25-review.md");
  await writeFile(real, twoTasks);
  await writeFile(notes, "# Review notes\n\nLooks fine.\n");
  await utimes(real, new Date(2026, 10, 25, 9), new Date(2026, 10, 25, 9));
  await utimes(notes, new Date(2026, 10, 25, 10), new Date(2026, 10, 25, 10));
  await say(APPROVAL);
  const [note] = planMessages(await start(APPROVAL));
  assert.match(note.content, /2026-11-25-plan\.md/);
  assert.deepEqual(errors, []);
});

test("a ledger left before approval does not count as progress", async (context) => {
  const run = await setup(context);
  await run.say(planning);
  await run.start(planning);
  await writeFile(path.join(run.cwd, plan), twoTasks);
  const ledger = path.join(run.cwd, ".superpowers/sdd/2026-11-25-p");
  await mkdir(ledger, { recursive: true });
  await writeFile(path.join(ledger, "progress.md"), `# SDD ledger — plan: ${plan}\nTask 1: complete (rehearsal)\n`);
  await run.say(APPROVAL);
  await run.start(APPROVAL);
  await run.compact();
  assert.match(run.sent[0].message.content, /Recorded: none yet/);
  assert.match(run.sent[0].message.content, /Next: Task 1\b/);
  assert.deepEqual(run.errors, []);
});

const compactEvent = (cwd) => ({
  type: "session_before_compact", reason: "threshold", willRetry: false, branchEntries: [], signal: new AbortController().signal,
  preparation: { firstKeptEntryId: "keep-1", messagesToSummarize: [], turnPrefixMessages: [], isSplitTurn: false,
    tokensBefore: 44000, fileOps: { read: new Set(["models.py"]), written: new Set(["tests/test_phase4.py"]),
      edited: new Set(["app.py"]) }, settings: {} },
});

test("during execution the guard writes the compaction summary itself, with no model call", async (context) => {
  const { cwd, errors, result, emit } = await approvedRun(context);
  gitInit(cwd);
  await result(taskStart(1), "brief: /w/task-1-brief.md\nbase: abc1234");
  const out = await emit(compactEvent(cwd));
  assert.equal(out?.compaction?.firstKeptEntryId, "keep-1");
  assert.equal(out.compaction.tokensBefore, 44000);
  const summary = out.compaction.summary;
  assert.match(summary, /written by the Phase 4 plan guard/);
  assert.ok(summary.includes(plan), summary);
  assert.match(summary, /Continue Task 1 from its brief \/w\/task-1-brief\.md/);
  assert.match(summary, /Uncommitted changes:/);
  assert.match(summary, /Files read: models\.py/);
  assert.match(summary, /Files changed: app\.py, tests\/test_phase4\.py/);
  assert.deepEqual(errors, []);
});

test("before approval, compaction is left to Pi", async (context) => {
  const { say, start, emit, errors, cwd } = await setup(context);
  await say(planning);
  await start(planning);
  assert.equal((await emit(compactEvent(cwd)))?.compaction, undefined);
  assert.deepEqual(errors, []);
});

test("after approval, planning-stage tool results leave the request but keep their place", async (context) => {
  const run = await setup(context);
  await run.say(planning);
  await run.start(planning);
  await writeFile(path.join(run.cwd, plan), twoTasks);
  const before = Date.now() - 1000;
  const planningCall = { role: "assistant", content: [{ type: "toolCall", id: "p1", name: "read", arguments: { path: "x" } }],
    api: "openai-completions", provider: "lmstudio", model: "m", usage: {}, stopReason: "toolUse", timestamp: before };
  const planningResult = { role: "toolResult", toolCallId: "p1", toolName: "read",
    content: [{ type: "text", text: "x".repeat(5000) }], isError: false, timestamp: before };
  await run.say("/skill:executing-plans " + APPROVAL);
  await run.start("/skill:executing-plans " + APPROVAL);
  const later = { ...planningResult, toolCallId: "e1", timestamp: Date.now() + 1000 };
  const loaded = await sdk.discoverAndLoadExtensions([extension], run.cwd, run.cwd);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, run.cwd, run.session, undefined);
  const out = await runner.emitContext([planningCall, planningResult, later]);
  assert.equal(out.length, 3);
  assert.equal(out[1].toolCallId, "p1");
  assert.match(out[1].content[0].text, /planning-stage result omitted/);
  assert.equal(out[2].content[0].text, "x".repeat(5000));
  assert.deepEqual(run.errors, []);
});

async function fakeUv(context, exitCode) {
  const bin = await mkdtemp(path.join(tmpdir(), "pi-fake-uv-"));
  context.after(() => rm(bin, { recursive: true, force: true }));
  await writeFile(path.join(bin, "uv"), `#!/bin/sh\necho "fake suite"\nexit ${exitCode}\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  context.after(() => { process.env.PATH = saved; });
}

test("once every task is recorded and the suite passes, the next call ends the turn; git still runs", async (context) => {
  await fakeUv(context, 0);
  const { errors, result, call } = await approvedRun(context);
  await result(taskDone(1), ledgerLine(1));
  assert.equal((await call("read", { path: "app.py" }))?.block, undefined, "one task left: keep working");
  await result(taskDone(2), ledgerLine(2));
  assert.equal((await call("bash", { command: "git add app.py && git commit -m done" }))?.block, undefined);
  assert.equal((await call("bash", { command: "git status" }))?.block, undefined);
  const decision = await call("read", { path: "tests/test_phase4.py" });
  assert.equal(decision?.block, true);
  assert.equal(decision.terminate, true);
  assert.match(decision.reason, /Every task in the plan is recorded and the full test suite passes/);
  assert.deepEqual(errors, []);
});

test("with every task recorded but a failing suite, Pi keeps working", async (context) => {
  await fakeUv(context, 1);
  const { errors, result, call } = await approvedRun(context);
  await result(taskDone(1), ledgerLine(1));
  await result(taskDone(2), ledgerLine(2));
  assert.equal((await call("edit", { path: "app.py", edits: [] }))?.block, undefined);
  assert.deepEqual(errors, []);
});
