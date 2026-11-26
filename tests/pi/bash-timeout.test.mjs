import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../../pi-extensions/bash-timeout.ts";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../../", import.meta.url));

function handlers() {
  const registered = new Map();
  extension({ on: (name, handler) => registered.set(name, handler) });
  return registered;
}

async function call(toolName, input, cwd = repo) {
  const event = { type: "tool_call", toolName, input };
  const decision = await handlers().get("tool_call")(event, { cwd });
  assert.equal(decision, undefined, "the call is never blocked");
  return event.input;
}

async function result(toolName, text, isError) {
  const event = Object.freeze({ type: "tool_result", toolName, content: Object.freeze([{ type: "text", text }]), isError });
  return (await handlers().get("tool_result")(event, { cwd: repo }))?.content ?? event.content;
}

test("gives a bash call without a timeout thirty seconds", async () => {
  for (const command of ["uv run --frozen python -m pytest tests", ". .venv/bin/activate && .venv/bin/uvicorn app:app --host 0.0.0.0"]) {
    assert.deepEqual(await call("bash", { command }), { command, timeout: 30 });
  }
});

test("keeps a shorter timeout the model chose and caps a longer one at thirty seconds", async () => {
  assert.equal((await call("bash", { command: "sleep 1", timeout: 10 })).timeout, 10);
  assert.equal((await call("bash", { command: "find / -name task-done", timeout: 600 })).timeout, 30);
  for (const timeout of [0, -5, "30", null]) {
    assert.equal((await call("bash", { command: "ls", timeout })).timeout, 30);
  }
});

test("leaves other tools alone", async () => {
  const input = Object.freeze({ path: "app.py" });
  assert.strictEqual(await call("read", input), input);
});

test("explains a timed-out command: search inside the project, scripts from the plan note, app through its tests", async () => {
  const text = "/System/Volumes/Data/private/tmp/x/task-done\n\nCommand timed out after 30 seconds";
  const content = await result("bash", text, true);
  assert.equal(content[0].text, text);
  assert.match(content[1].text, /30 seconds/);
  assert.match(content[1].text, /inside the project/);
  assert.match(content[1].text, /installed outside the project on purpose/);
  assert.match(content[1].text, /plan note is correct, run it as written/);
  assert.match(content[1].text, /does not exist yet: create it/);
  assert.match(content[1].text, /tests/);
  assert.doesNotMatch(content[1].text, /`[^`]*\/[^`]*`/, "no path the model could copy into another search");
});

test("adds nothing to other results", async () => {
  for (const [tool, text, isError] of [
    ["bash", "2 failed, 3 passed\n\nCommand exited with code 1", true],
    ["bash", "Command timed out after 30 seconds", false],
    ["read", "Command timed out after 30 seconds", true],
  ]) {
    assert.deepEqual(await result(tool, text, isError), [{ type: "text", text }]);
  }
});

test("without a shell limit in the project config, bash calls are left alone", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const empty = await mkdtemp(path.join(tmpdir(), "pi-no-config-"));
  try {
    assert.deepEqual(await call("bash", { command: "ls" }, empty), { command: "ls" });
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
