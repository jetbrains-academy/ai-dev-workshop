import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const name of ["PI_PACKAGE_DIR", "SUPERPOWERS_DIR"]) {
  if (!process.env[name]) throw new Error(`Set ${name} as shown in pi-extension.md.`);
}
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const extension = fileURLToPath(new URL("../../pi-extensions/plan-approval.ts", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
// Temporary projects get the repo's own .pi/project.json, so the tests exercise the shipped values.
const withConfig = async (cwd) => {
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await writeFile(path.join(cwd, ".pi/project.json"), await readFile(path.join(repo, ".pi/project.json")));
};
const NOTE_CONTEXT = { phase: 4, pytest: "uv run --frozen python -m pytest" };
const skills = sdk.loadSkillsFromDir({ dir: path.join(process.env.SUPERPOWERS_DIR, "skills"), source: "user" }).skills;
const brainstormingSkill = skills.find((skill) => skill.name === "brainstorming");
const writingPlans = skills.find((skill) => skill.name === "writing-plans").filePath;
const executingSkill = skills.find((skill) => skill.name === "executing-plans");
const normalTools = ["read", "ls", "find", "grep", "write", "edit", "bash", "tool_search"];

function bindActiveTools(runtime, active = normalTools) {
  runtime.getActiveTools = () => active;
  runtime.setActiveTools = (tools) => { active = tools; };
  return runtime.getActiveTools;
}

async function setup(context, reuse) {
  const cwd = reuse?.cwd ?? await mkdtemp(path.join(tmpdir(), "pi-phase4-approval-"));
  if (!reuse?.cwd) {
    context.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
    if (!reuse?.noConfig) await withConfig(cwd);
  }
  const loaded = await sdk.discoverAndLoadExtensions([extension], cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const session = reuse?.session ?? sdk.SessionManager.inMemory(cwd);
  // Pi binds appendEntry and sendMessage to the session at startup; do the same here.
  loaded.runtime.appendEntry = (customType, data) => session.appendCustomEntry(customType, data);
  const activeTools = bindActiveTools(loaded.runtime, reuse?.activeTools);
  const sent = [];
  loaded.runtime.sendMessage = (message, options) => sent.push({ message, options });
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, session, undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const say = (text) => runner.emitInput(text, undefined, "rpc");
  const start = (prompt, availableSkills = skills) => runner.emitBeforeAgentStart(
    { messageType: "user", prompt }, { cwd, skills: availableSkills },
  );
  const call = (toolName, input) => runner.emitToolCall({ type: "tool_call", toolCallId: "call", toolName, input });
  const compact = () => runner.emit({
    type: "session_compact", fromExtension: false, reason: "threshold", willRetry: false,
    compactionEntry: { type: "compaction", id: "c", parentId: null, timestamp: new Date().toISOString(),
      summary: "s", firstKeptEntryId: "x", tokensBefore: 45000 },
  });
  const result = (command, text, isError = false) => runner.emitToolResult({ type: "tool_result", toolCallId: "b",
    toolName: "bash", input: { command }, content: [{ type: "text", text }], isError });
  const emit = (event) => runner.emit(event);
  return { cwd, session, errors, say, start, call, sent, compact, result, emit, runner, activeTools };
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
  assert.match(shell.reason, /save_design/);
  assert.equal((await call("bash", { command: "date" }))?.block, true);
  assert.equal((await call("write", { path: "docs/superpowers/specs/draft.md" }))?.block, true);
  assert.deepEqual(errors, []);
});

test("drafting exposes the stage's saver and restores the prior tools after plan approval", async (context) => {
  const run = await setup(context);
  await run.say(brainstorm);
  await run.start(brainstorm);
  assert.deepEqual(run.activeTools(), ["read", "ls", "find", "grep", "save_design"]);
  await run.start("Refine the draft.");
  const resumed = await setup(context, { cwd: run.cwd, session: run.session, activeTools: run.activeTools() });
  await resumed.say(planning);
  await resumed.start(planning);
  assert.deepEqual(resumed.activeTools(), ["read", "ls", "find", "grep", "save_plan"]);
  await writeFile(path.join(run.cwd, "docs/superpowers/plans/current.md"), "# Plan\n");
  await resumed.say(APPROVAL);
  await resumed.start(APPROVAL);
  assert.deepEqual(resumed.activeTools(), normalTools);
  assert.deepEqual([...run.errors, ...resumed.errors], []);
});

test("save_design writes or revises only a design draft in the design stage", async (context) => {
  const { cwd, errors, say, start, call, runner } = await setup(context);
  await say(brainstorm);
  await start(brainstorm);
  const draft = "docs/superpowers/specs/phase-4-design.md";
  const tool = runner.getToolDefinition("save_design");
  assert.equal(tool?.defaultActive, false);
  const save = (path, content = "# Draft\n") => tool.execute("save", { path, content }, undefined, undefined,
    runner.createToolContext("save", undefined));
  assert.equal((await call("save_design", { path: draft }))?.block, undefined);
  const result = await save(draft);
  assert.ok(result.content[0].text.includes(draft));
  assert.match(result.content[0].text, /approval/);
  assert.equal(await readFile(path.join(cwd, draft), "utf8"), "# Draft\n");
  await save(draft, "# Revised draft\n");
  const linked = path.join(cwd, "docs/superpowers/specs/alias.md");
  await symlink(path.join(cwd, draft), linked);
  for (const invalid of ["models.py", "docs/superpowers/plans/plan.md", "docs/superpowers/specs/../plans/plan.md", linked]) {
    await assert.rejects(() => save(invalid), /docs\/superpowers\/specs\//, invalid);
  }
  assert.equal(await readFile(path.join(cwd, draft), "utf8"), "# Revised draft\n");
  await say(planning);
  await start(planning);
  await assert.rejects(() => save(draft), /design stage/);
  assert.deepEqual(errors, []);
});

test("brainstorming saves a draft before approval on skill load and reread", async (context) => {
  const { cwd, errors, say, start, runner } = await setup(context);
  const prompt = "/skill:brainstorming " + brainstorm;
  await say(prompt);
  await start(prompt);
  const file = brainstormingSkill.filePath;
  const upstream = await readFile(file, "utf8");
  const suffix = `\n</skill>\n\n${brainstorm}`;
  const block = `<skill name="brainstorming" location="${file}">\n${upstream}${suffix}`;
  const messages = [{ role: "user", content: [{ type: "text", text: block }], timestamp: Date.now() }];
  const projected = await runner.emitContext(messages);
  const loaded = projected[0].content[0].text;
  assert.ok(loaded.endsWith(suffix));
  assert.equal(messages[0].content[0].text, block);
  const input = { path: path.relative(cwd, file) };
  const read = await sdk.createReadTool(cwd).execute("read-skill", input, undefined, undefined);
  const reread = await runner.emitToolResult({
    type: "tool_result", toolName: "read", toolCallId: "read-skill", input, ...read, isError: false,
  });
  for (const text of [loaded, reread?.content[0].text]) {
    assert.match(text, /save_design.*draft.*before asking for approval/i);
    assert.match(text, /^- constraints\n- the acceptance criteria, copied verbatim from the input\n/m);
    assert.match(text, /what's left to the builder/);
    assert.doesNotMatch(text, /they pick in the conversation|gate goes with it/i);
  }
  assert.equal(await readFile(file, "utf8"), upstream);
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
  assert.match(refused.reason, /save_plan/);
  assert.equal((await call("write", { path: "docs/superpowers/plans/phase-4.md", content: "# Plan\n" }))?.block, true);
  assert.equal((await call("read", { path: "models.py" }))?.block, undefined);
  assert.deepEqual(errors, []);
});

test("a saved plan stays editable for self-review while implementation remains locked", async (context) => {
  const { cwd, errors, say, start, call } = await setup(context);
  await writeFile(path.join(cwd, "docs/superpowers/plans/old.md"), "# Earlier phase\n");
  await say(planning);
  await start(planning);
  await writeFile(path.join(cwd, "docs/superpowers/plans/phase-4.md"), "# Plan\n");
  for (const [toolName, input] of [["edit", editModel], ["bash", { command: "uv run --frozen python -m pytest tests/test_board.py -v" }]]) {
    const refused = await call(toolName, input);
    assert.equal(refused?.block, true);
    assert.equal(refused.terminate, undefined);
    assert.match(refused.reason, /docs\/superpowers\/plans\/phase-4\.md/);
    assert.match(refused.reason, /self-review/);
  }
  assert.equal((await call("edit", { ...editModel, path: "docs/superpowers/plans/phase-4.md" }))?.block, true);
  assert.equal((await call("save_plan", { path: "docs/superpowers/plans/phase-4.md" }))?.block, undefined);
  assert.equal((await call("read", { path: "models.py" }))?.block, undefined);
  assert.deepEqual(errors, []);
});

test("planning exposes read-only tools and save_plan without a shell", async (context) => {
  const { errors, say, start, call, activeTools } = await setup(context);
  await say(planning);
  await start(planning);
  assert.deepEqual(activeTools(), ["read", "ls", "find", "grep", "save_plan"]);
  assert.equal((await call("find", { path: "docs", pattern: "*.md" }))?.block, undefined);
  assert.equal((await call("bash", { command: "date" }))?.block, true);
  assert.equal((await call("save_design", { path: "docs/superpowers/specs/phase-4.md" }))?.block, true);
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
  await withConfig(cwd);
  const loaded = await sdk.discoverAndLoadExtensions(allExtensions, cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const session = sdk.SessionManager.inMemory(cwd);
  loaded.runtime.appendEntry = (customType, data) => session.appendCustomEntry(customType, data);
  bindActiveTools(loaded.runtime);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, session, undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const say = (text) => runner.emitInput(text, undefined, "rpc");
  const start = (prompt) => runner.emitBeforeAgentStart({ messageType: "user", prompt }, { cwd, skills });
  async function run(toolName, input) {
    const decision = await runner.emitToolCall({ type: "tool_call", toolCallId: toolName, toolName, input });
    assert.equal(decision?.block, undefined);
    const tool = runner.getToolDefinition(toolName);
    const result = await tool.execute(toolName, input, undefined, undefined, runner.createToolContext(toolName, undefined));
    return runner.emitToolResult({ type: "tool_result", toolCallId: toolName, toolName, input, ...result, isError: false });
  }
  return { cwd, errors, say, start, run };
}

const exists = (file) => access(file).then(() => true, () => false);
const texts = (result) => result.content.map((item) => item.text ?? "");

test("the project skill is attached once when planning starts", async (context) => {
  const { cwd, errors, say, start } = await setupAll(context);
  const skillPath = ".pi/skills/fastapi-testing/SKILL.md";
  const skill = await readFile(path.join(repo, skillPath), "utf8");
  await mkdir(path.dirname(path.join(cwd, skillPath)), { recursive: true });
  await writeFile(path.join(cwd, skillPath), skill);
  const dated = (result) => result.messages.filter((m) => String(m.content).includes(today()));
  await say(brainstorm);
  const first = dated(await start(brainstorm));
  assert.equal(first.length, 1);
  assert.ok(first[0].content.includes(`docs/superpowers/specs/${today()}-`), first[0].content);
  // Naming the plans folder while brainstorming led Pi to write a plan too (4 of 4 runs on 2026-11-25).
  assert.doesNotMatch(first[0].content, /plans/);
  assert.equal(dated(await start("Skip the questions.")).length, 0);
  assert.ok(!first[0].content.includes(skill.trim()));
  const planningPrompt = "/skill:writing-plans " + planning;
  await say(planningPrompt);
  const second = dated(await start(planningPrompt));
  assert.equal(second.length, 1);
  assert.ok(second[0].content.includes(`docs/superpowers/plans/${today()}-`), second[0].content);
  assert.doesNotMatch(second[0].content, /specs/);
  assert.ok(second[0].content.includes(skill.trim()), "send the skill contents with the planning note");
  assert.equal(dated(await start("Continue.")).length, 0);
  await writeFile(path.join(cwd, "docs/superpowers/plans/workshop.md"), "# Plan\n\n### Task 1: Model\n");
  await say("/skill:executing-plans " + APPROVAL);
  const execution = await start("/skill:executing-plans " + APPROVAL);
  assert.equal(planMessages(execution).length, 1);
  assert.ok(execution.messages.every((message) => !String(message.content).includes(skill.trim())));
  assert.deepEqual(errors, []);
});

test("a missing or unreadable planning skill warns with its path and allows planning", async (context) => {
  const { cwd, errors, say, start, run } = await setupAll(context);
  const skill = ".pi/skills/fastapi-testing/SKILL.md";
  await say(planning);
  const missing = await start(planning);
  assert.match(missing.messages[0].content, /Warning:.*\.pi\/skills\/fastapi-testing\/SKILL\.md.*missing/);

  await mkdir(path.join(cwd, skill), { recursive: true });
  await say(planning);
  const unreadable = await start(planning);
  assert.match(unreadable.messages[0].content, /Warning:.*\.pi\/skills\/fastapi-testing\/SKILL\.md.*could not be read/);
  const plan = "docs/superpowers/plans/workshop.md";
  await run("save_plan", { path: plan, content: "# Plan\n" });
  assert.equal(await readFile(path.join(cwd, plan), "utf8"), "# Plan\n");
  assert.deepEqual(errors, []);
});

const APPROVAL = "The plan looks good. Proceed with native execution.";

test("save_plan runs existing plan checks and directs Pi to reread the saved plan", async (context) => {
  const { cwd, errors, say, start, run } = await setupAll(context);
  await say(planning);
  await start(planning);
  const plan = "docs/superpowers/plans/workshop.md";
  const content = ["# Plan", "", "### 1: Route", "", "~~~bash", "pytest tests/test_board.py", "~~~", "",
    "~~~python", "def test_placeholder():", "    pass", "~~~", "",
    "~~~python", "def test_broken():", "    assert (", "~~~", "", "### 2. Board", ""].join("\n");
  const saved = texts(await run("save_plan", { path: plan, content })).join("\n");
  assert.match(saved, /read.*docs\/superpowers\/plans\/workshop\.md.*next/i);
  assert.match(saved, /^Fix these in the plan with `save_plan`/);
  assert.match(saved, /`test_placeholder` in docs\/superpowers\/plans\/workshop\.md:\d+ contains only/);
  assert.match(saved, /`test_broken` in docs\/superpowers\/plans\/workshop\.md:\d+ does not parse/);
  const onDisk = await readFile(path.join(cwd, plan), "utf8");
  assert.match(onDisk, /^### Task 1: Route/m);
  assert.match(onDisk, /uv run --frozen python -m pytest tests\/test_board\.py/);
  for (const invalid of ["models.py", "docs/superpowers/specs/plan.md", "docs/superpowers/plans/../specs/plan.md"]) {
    await assert.rejects(() => run("save_plan", { path: invalid, content }), /docs\/superpowers\/plans\//);
  }
  assert.deepEqual(errors, []);
});

test("writing-plans directs saved-file self-review on skill load and reread", async (context) => {
  const { cwd, errors, say, start, runner } = await setup(context);
  const prompt = "/skill:writing-plans " + planning;
  await say(prompt);
  await start(prompt);
  const upstream = await readFile(writingPlans, "utf8");
  const suffix = "\n</skill>\n\n" + planning;
  const block = '<skill name="writing-plans" location="' + writingPlans + '">\n' + upstream + suffix;
  const messages = [{ role: "user", content: [{ type: "text", text: block }], timestamp: Date.now() }];
  const loaded = (await runner.emitContext(messages))[0].content[0].text;
  assert.ok(loaded.endsWith(suffix));
  assert.equal(messages[0].content[0].text, block);
  const input = { path: path.relative(cwd, writingPlans) };
  const read = await sdk.createReadTool(cwd).execute("read-skill", input, undefined, undefined);
  const reread = await runner.emitToolResult({
    type: "tool_result", toolName: "read", toolCallId: "read-skill", input, ...read, isError: false,
  });
  for (const text of [loaded, reread?.content[0].text]) {
    assert.match(text, /save_plan/);
    assert.match(text, /read.*saved plan.*next action/i);
    assert.match(text, /## Self-Review/);
    assert.match(text, /Spec coverage/);
    assert.doesNotMatch(text, /Which execution approach would you prefer/);
  }
  assert.equal(await readFile(writingPlans, "utf8"), upstream);
  assert.deepEqual(errors, []);
});

const scripts = path.join(executingSkill.baseDir, "scripts");
const twoTasks = "# Plan\n\n### Task 1: Model\n\n- [ ] step\n\n### Task 2: Routes\n\n- [ ] step\n";
const planMessages = (result) => result.messages.filter((m) => m.customType === "plan-note");

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
  assert.equal(notes[0].content, planNote(plan, planTasks(twoTasks), { started: {}, recorded: [] }, scripts, [], NOTE_CONTEXT));
  assert.equal(planMessages(await start("Continue.")).length, 0);
  assert.deepEqual(errors, []);
});

test("a repair prompt that leaves the saved plan unchanged keeps it approvable", async (context) => {
  const { cwd, errors, say, start, call } = await setup(context);
  await say(planning);
  await start(planning);
  const plan = "docs/superpowers/plans/2026-11-27-p.md";
  await writeFile(path.join(cwd, plan), twoTasks);
  const repair = "/skill:writing-plans Reread the saved Phase 4 plan against the roadmap. Edit only the plan and stop for approval.";
  await say(repair);
  await start(repair);
  assert.equal((await call("edit", editModel))?.block, true);
  await say("/skill:executing-plans " + APPROVAL);
  assert.equal((await call("edit", editModel))?.block, undefined);
  assert.deepEqual(errors, []);
});

const stubPlan = "# Plan\n\n### Task 1: Route\n\n```python\ndef test_route():\n    pass\n```\n";
const repairPrompt = "Reread the saved Phase 4 plan against the roadmap. Edit only the plan and stop for approval.";
const settle = (runner, outcome = "completed") => runner.emitBoundary({ type: "agent_before_settle", outcome },
  async () => ({ contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: true }));
const commit = (session, entries) => {
  for (const entry of entries) {
    if (entry.type === "custom") session.appendCustomEntry(entry.customType, entry.data);
  }
};

test("a repair prompt gets the saved plan's check results instead of a second guidance note", async (context) => {
  const { cwd, errors, say, start } = await setup(context);
  await say(planning);
  const first = await start(planning);
  assert.match(first.messages.map((m) => m.content).join("\n"), /^Today is .*\n\n.*Planning skill/s);
  const plan = "docs/superpowers/plans/2026-11-27-p.md";
  await writeFile(path.join(cwd, plan), stubPlan);
  await say(repairPrompt);
  const repair = await start(repairPrompt);
  const text = (repair?.messages ?? []).map((m) => m.content).join("\n");
  assert.doesNotMatch(text, /Planning skill|project guidance|Today is/);
  assert.match(text, /^Plan check for docs\/superpowers\/plans\/2026-11-27-p\.md\. Fix these in the plan/);
  assert.match(text, /`test_route` in docs\/superpowers\/plans\/2026-11-27-p\.md:\d+ contains only `pass`/);
  await writeFile(path.join(cwd, plan), twoTasks);
  await say(repairPrompt);
  assert.equal((await start(repairPrompt))?.messages?.length ?? 0, 0);
  assert.deepEqual(errors, []);
});

test("with findings left at the end of planning, Pi continues once with them, then the presenter is told", async (context) => {
  const { cwd, session, errors, say, start, call, runner } = await setup(context);
  const notes = [];
  runner.setUIContext({ notify: (message, level) => notes.push({ message, level }) });
  await say(planning);
  await start(planning);
  assert.equal((await settle(runner)).continue, false);
  const plan = "docs/superpowers/plans/2026-11-27-p.md";
  await writeFile(path.join(cwd, plan), stubPlan);
  assert.equal((await settle(runner, "aborted")).continue, false);
  const nudge = await settle(runner);
  assert.equal(nudge.continue, true);
  const message = nudge.entries.find((entry) => entry.type === "custom_message");
  assert.equal(message.customType, "plan-check");
  assert.match(message.content, /`test_route` in .*contains only `pass`/);
  commit(session, nudge.entries);
  const again = await settle(runner);
  assert.equal(again.continue, false);
  assert.match(notes.at(-1)?.message ?? "", /`test_route`/);
  // A repair prompt keeps the stage's single continuation spent.
  await say(repairPrompt);
  await start(repairPrompt);
  assert.equal((await settle(runner)).continue, false);
  await writeFile(path.join(cwd, plan), twoTasks);
  notes.length = 0;
  assert.equal((await settle(runner)).continue, false);
  assert.deepEqual(notes, []);
  await say("/skill:executing-plans " + APPROVAL);
  assert.equal((await call("edit", editModel))?.block, undefined);
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

async function approvedRun(context, { withGit = false } = {}) {
  const run = await setup(context);
  if (withGit) gitInit(run.cwd);
  await run.say(planning);
  await run.start(planning);
  await writeFile(path.join(run.cwd, plan), twoTasks);
  await run.say("/skill:executing-plans " + APPROVAL);
  await run.start("/skill:executing-plans " + APPROVAL);
  const { planNote, planTasks } = await import(pathToFileURL(extension).href);
  run.note = (progress) => planNote(plan, planTasks(twoTasks), progress, scripts, [], NOTE_CONTEXT);
  return run;
}

test("execution projects the pinned skill's human-review handoff on load and reread", async (context) => {
  const { cwd, errors, runner } = await approvedRun(context);
  const file = executingSkill.filePath;
  const upstream = await readFile(file, "utf8");
  const directive = "Use superpowers:finishing-a-development-branch";
  assert.equal(upstream.split(directive).length - 1, 3, "review the projection when the pinned skill changes");
  const suffix = `\n</skill>\n\n${APPROVAL}`;
  const block = `<skill name="executing-plans" location="${file}">\n${upstream}${suffix}`;
  const messages = [{ role: "user", content: [{ type: "text", text: block }], timestamp: Date.now() }];
  const projected = await runner.emitContext(messages);
  const loaded = projected[0].content[0].text;
  assert.ok(loaded.endsWith(suffix));
  assert.match(loaded, /## Final Review/);
  assert.match(loaded, /Report the final review and stop for human verification/);
  assert.doesNotMatch(loaded, /finishing-a-development-branch/);
  assert.equal(messages[0].content[0].text, block);

  const input = { path: path.relative(cwd, file) };
  const read = await sdk.createReadTool(cwd).execute("read-skill", input, undefined, undefined);
  const reread = await runner.emitToolResult({
    type: "tool_result", toolName: "read", toolCallId: "read-skill", input, ...read, isError: false,
  });
  const rereadText = reread.content.map((part) => part.text).join("\n");
  assert.match(rereadText, /## Final Review/);
  assert.match(rereadText, /Report the final review and stop for human verification/);
  assert.doesNotMatch(rereadText, /finishing-a-development-branch/);
  assert.equal(await readFile(file, "utf8"), upstream);
  assert.deepEqual(errors, []);
});

test("after a compaction mid-task, Pi is told to continue that task", async (context) => {
  const { errors, result, compact, sent, note } = await approvedRun(context);
  await result(taskStart(1), "brief: /w/task-1-brief.md\nbase: abc1234");
  await compact();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.deliverAs, "steer");
  assert.equal(sent[0].options.triggerTurn, undefined);
  assert.equal(sent[0].message.customType, "plan-note");
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

test("completion reports a green suite and gives Pi repo-relative final review paths", async (context) => {
  await fakeUv(context, 0);
  const { cwd, errors, result, call, emit, start } = await approvedRun(context, { withGit: true });
  const packageDir = ".pi/git/github.com/obra/superpowers";
  await mkdir(path.dirname(path.join(cwd, packageDir)), { recursive: true });
  await symlink(path.resolve(process.env.SUPERPOWERS_DIR), path.join(cwd, packageDir));
  const skillRoot = path.join(cwd, packageDir, "skills");
  const baseDir = path.join(skillRoot, "executing-plans");
  await start(APPROVAL, [{ ...executingSkill, baseDir, filePath: path.join(baseDir, "SKILL.md") }]);
  const base = git(cwd, "rev-parse", "HEAD");
  git(cwd, "-c", "user.email=t@localhost", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "implementation");
  await result(taskDone(1), ledgerLine(1));
  assert.equal((await call("read", { path: "app.py" }))?.block, undefined, "one task left: keep working");
  const completed = await result(taskDone(2), ledgerLine(2));
  assert.equal(completed?.content[0].text, ledgerLine(2));
  assert.match(completed.content[1].text, /Every task in the plan is recorded and the full test suite passes/);
  const compacted = await emit(compactEvent(cwd));
  const script = path.join(skillRoot, "subagent-driven-development/scripts/review-package");
  const reviewer = `${packageDir}/skills/requesting-code-review/code-reviewer.md`;
  const review = `'${script}' '${plan}' ${base} HEAD`;
  for (const text of [completed.content[1].text, compacted.compaction.summary]) {
    assert.ok(text.includes(review), text);
    assert.ok(text.includes(`\`${reviewer}\``), text);
    assert.match(text, /report.*stop for human verification/i);
    assert.doesNotMatch(text, /finishing-a-development-branch/);
  }
  const command = completed.content[1].text.match(/run `([^`]+)`/)?.[1];
  assert.equal(command, review);
  const existing = path.join(cwd, ".superpowers/sdd/2026-11-25-p");
  await mkdir(existing, { recursive: true });
  await writeFile(path.join(existing, "plan-path"), "docs/other/2026-11-25-p.md\n");
  const output = execFileSync("bash", ["-c", command], { cwd, encoding: "utf8" });
  assert.match(output, /wrote .*: 1 commit\(s\)/);
  const packageResult = await result(command, output);
  const diff = `.superpowers/sdd/2026-11-25-p-plans/review-${git(cwd, "rev-parse", "--short", base)}..${git(cwd, "rev-parse", "--short", "HEAD")}.diff`;
  assert.ok(packageResult?.content[0].text.includes(`\`${diff}\``), packageResult?.content[0].text ?? output);
  assert.match(await readFile(path.join(cwd, diff), "utf8"), /# Review package:/);
  assert.equal(await result(taskDone(2), ledgerLine(2)), undefined, "duplicate completion adds no reminder");
  assert.equal(await call("read", { path: "tests/test_phase4.py" }), undefined);
  assert.equal(await call("bash", { command: "uv run --frozen python -m pytest tests" }), undefined);
  assert.equal(await call("bash", { command: "git status" }), undefined);
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

test("the phase comes from the prompt: a Phase 5 design turn is guarded and named as Phase 5", async (context) => {
  const { errors, say, start, call } = await setup(context);
  const five = "Use Superpowers to brainstorm Phase 5 in specs/roadmap.md and save the design under docs/superpowers/specs/.";
  await say(five);
  await start(five);
  const refused = await call("edit", editModel);
  assert.equal(refused?.block, true);
  assert.match(refused.reason, /Phase 5 approval guard/);
  assert.doesNotMatch(refused.reason, /Phase 4/);
  assert.deepEqual(errors, []);
});

test("a reworded planning prompt still starts the planning stage", async (context) => {
  const { errors, say, start, call } = await setup(context);
  await say(brainstorm);
  await start(brainstorm);
  const reworded = "The Phase 4 design looks good. Please proceed with planning.";
  await say(reworded);
  await start(reworded);
  const refused = await call("edit", editModel);
  assert.match(refused.reason, /only writes the plan/);
  assert.deepEqual(errors, []);
});

test("without a project config the guard does nothing", async (context) => {
  const { errors, say, start, call } = await setup(context, { noConfig: true });
  await say(brainstorm);
  await start(brainstorm);
  assert.equal((await call("edit", editModel))?.block, undefined);
  assert.deepEqual(errors, []);
});
