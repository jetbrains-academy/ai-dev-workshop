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
