import assert from "node:assert/strict";
import { test } from "node:test";
import { blockedCall } from "../../pi-extensions/phase4-plan-approval.ts";

test("a refusal opens by naming the call it blocked", () => {
  assert.equal(blockedCall("write", { path: "app.py" }), "Blocked just now: your `write` call on `app.py`.");
  assert.equal(blockedCall("bash", { command: "ls -la" }), "Blocked just now: your `bash` call `ls -la`.");
  assert.equal(blockedCall("mystery", {}), "Blocked just now: your `mystery` call.");
});

test("long or multi-line commands are shortened to one line", () => {
  const long = blockedCall("bash", { command: "x".repeat(300) });
  assert.ok(long.length < 200, long);
  assert.match(long, /…`\.$/);
  assert.equal(blockedCall("bash", { command: "a\nb" }), "Blocked just now: your `bash` call `a b`.");
});

test("today is the local date as YYYY-MM-DD", async () => {
  const { today } = await import("../../pi-extensions/phase4-plan-approval.ts");
  assert.equal(today(new Date(2026, 10, 5)), "2026-11-05");
  assert.equal(today(new Date(2026, 0, 31, 23, 59)), "2026-01-31");
});

test("planTasks reads the plan's task headings", async () => {
  const { planTasks } = await import("../../pi-extensions/phase4-plan-approval.ts");
  assert.deepEqual(planTasks("# P\n### Task 1: Model\n...\n### Task 2: Routes\nTask 9: not a heading\n"),
    [{ number: 1, title: "Model" }, { number: 2, title: "Routes" }]);
});

test("planNote names the plan, its tasks, the scripts and where Pi is", async () => {
  const { planTasks, planNote } = await import("../../pi-extensions/phase4-plan-approval.ts");
  const tasks = planTasks("# P\n### Task 1: Model\n...\n### Task 2: Routes\n");
  const s = "/sp/skills/executing-plans/scripts";
  const plan = "docs/superpowers/plans/2026-11-25-p.md";
  const fresh = planNote(plan, tasks, { started: {}, recorded: [] }, s);
  assert.match(fresh, /docs\/superpowers\/plans\/2026-11-25-p\.md/);
  assert.match(fresh, /Task 1: Model/);
  assert.match(fresh, /Task 2: Routes/);
  assert.ok(fresh.includes(`${s}/task-start ${plan} 1`));
  assert.ok(fresh.includes(`${s}/task-done ${plan} N BASE -- uv run --frozen python -m pytest TEST_FILES`));
  assert.doesNotMatch(fresh, /</, "a copied placeholder must not become a shell redirect");
  assert.match(fresh, /separate words after --/);
  assert.match(fresh, /Next: Task 1/);
  assert.match(fresh, /commit as each task's steps say/i);
  assert.match(fresh, /until task-done records/i);
  assert.match(fresh, /from the project folder exactly as written, without cd/);
  assert.match(fresh, /installed outside the project on purpose/);
  const mid = planNote("p.md", tasks, { started: { 2: { brief: "/b/task-2-brief.md", base: "abc1234" } }, recorded: [1] }, s);
  assert.match(mid, /Recorded: Task 1\b/);
  assert.match(mid, /Continue Task 2/);
  assert.match(mid, /abc1234/);
  assert.match(mid, /\/b\/task-2-brief\.md/);
  assert.match(mid, /do not run task-start again/i);
  assert.equal(planNote("p.md", tasks, { started: {}, recorded: [1, 2] }, s), undefined);
});

test("readLedger reads this plan's ledger only", async (context) => {
  const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { readLedger } = await import("../../pi-extensions/phase4-plan-approval.ts");
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-ledger-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  const plan = "docs/superpowers/plans/p.md";
  assert.deepEqual(readLedger(cwd, plan), []);
  const write = async (dir, text) => {
    await mkdir(path.join(cwd, ".superpowers/sdd", dir), { recursive: true });
    await writeFile(path.join(cwd, ".superpowers/sdd", dir, "progress.md"), text);
  };
  await write("p", `# SDD ledger — plan: ${plan}\nTask 1: complete (commits a..b, tests: x → 1 passed)\nTask 3: complete (y)\n`);
  await write("other", "# SDD ledger — plan: docs/superpowers/plans/other.md\nTask 2: complete (z)\n");
  await write("abs", `# SDD ledger — plan: ${path.join(cwd, plan)}\nTask 4: complete (w)\n`);
  assert.deepEqual(readLedger(cwd, plan), [1, 3, 4]);
});

test("planTasks accepts any heading level and skips fenced code, as task-brief does", async () => {
  const { planTasks } = await import("../../pi-extensions/phase4-plan-approval.ts");
  assert.deepEqual(planTasks("## Task 1: A\n```\n### Task 9: fake\n```\n#### Task 2 — B\n### Task 3\n"),
    [{ number: 1, title: "A" }, { number: 2, title: "B" }, { number: 3, title: "" }]);
});

test("planNote still names the plan and scripts when it finds no task headings", async () => {
  const { planNote } = await import("../../pi-extensions/phase4-plan-approval.ts");
  const note = planNote("docs/superpowers/plans/p.md", [], { started: {}, recorded: [] }, "/s");
  assert.match(note, /docs\/superpowers\/plans\/p\.md/);
  assert.ok(note.includes("/s/task-start docs/superpowers/plans/p.md"));
});

test("planNote lists commits since approval, and finished work is checked against its brief before it is recorded", async () => {
  const { planTasks, planNote } = await import("../../pi-extensions/phase4-plan-approval.ts");
  const tasks = planTasks("### Task 1: Model\n### Task 2: Routes\n");
  const note = planNote("p.md", tasks, { started: {}, recorded: [] }, "/s", ["abc1234 feat: model"]);
  assert.match(note, /Commits since approval: abc1234 feat: model/);
  assert.match(note, /run task-start for it, check its brief's steps against that commit, do any step that is missing, then run task-done/);
  assert.doesNotMatch(note, /rather than redoing it/);
  assert.doesNotMatch(planNote("p.md", tasks, { started: {}, recorded: [] }, "/s", []), /Commits since approval/);
});
