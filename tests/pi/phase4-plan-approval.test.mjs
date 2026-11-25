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

test("datedName puts today's date in front, replacing a wrong one", async () => {
  const { datedName } = await import("../../pi-extensions/phase4-plan-approval.ts");
  assert.equal(datedName("phase-4-design.md", "2026-11-25"), "2026-11-25-phase-4-design.md");
  assert.equal(datedName("2026-11-10-phase-4-design.md", "2026-11-25"), "2026-11-25-phase-4-design.md");
  assert.equal(datedName("2026-11-25-phase-4-design.md", "2026-11-25"), "2026-11-25-phase-4-design.md");
});

test("planTasks reads the plan's task headings", async () => {
  const { planTasks } = await import("../../pi-extensions/phase4-plan-approval.ts");
  assert.deepEqual(planTasks("# P\n### Task 1: Model\n...\n### Task 2: Routes\n## Task 9: not a task\n"),
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
  assert.ok(fresh.includes(`${s}/task-done ${plan} <N> <base> -- uv run --frozen python -m pytest`));
  assert.match(fresh, /separate words after --/);
  assert.match(fresh, /Next: Task 1/);
  assert.match(fresh, /commit as each task's steps say/i);
  assert.match(fresh, /until task-done records/i);
  const mid = planNote("p.md", tasks, { started: { 2: { brief: "/b/task-2-brief.md", base: "abc1234" } }, recorded: [1] }, s);
  assert.match(mid, /Recorded: Task 1\b/);
  assert.match(mid, /Continue Task 2/);
  assert.match(mid, /abc1234/);
  assert.match(mid, /\/b\/task-2-brief\.md/);
  assert.match(mid, /do not run task-start again/i);
  assert.equal(planNote("p.md", tasks, { started: {}, recorded: [1, 2] }, s), undefined);
});
