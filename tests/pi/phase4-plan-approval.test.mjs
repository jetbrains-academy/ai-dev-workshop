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
