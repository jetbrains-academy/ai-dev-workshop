import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../../pi-extensions/bash-timeout.ts";

function handlers() {
  const registered = new Map();
  extension({ on: (name, handler) => registered.set(name, handler) });
  return registered;
}

async function call(toolName, input) {
  const event = { type: "tool_call", toolName, input };
  const decision = await handlers().get("tool_call")(event);
  assert.equal(decision, undefined, "the call is never blocked");
  return event.input;
}

async function result(toolName, text, isError) {
  const event = Object.freeze({ type: "tool_result", toolName, content: Object.freeze([{ type: "text", text }]), isError });
  return (await handlers().get("tool_result")(event))?.content ?? event.content;
}

test("gives a bash call without a timeout sixty seconds", async () => {
  for (const command of ["uv run --frozen python -m pytest tests", ". .venv/bin/activate && .venv/bin/uvicorn app:app --host 0.0.0.0"]) {
    assert.deepEqual(await call("bash", { command }), { command, timeout: 60 });
  }
});

test("keeps a shorter timeout the model chose and caps a longer one", async () => {
  assert.equal((await call("bash", { command: "sleep 1", timeout: 10 })).timeout, 10);
  assert.equal((await call("bash", { command: "sleep 999", timeout: 3600 })).timeout, 120);
  for (const timeout of [0, -5, "30", null]) {
    assert.equal((await call("bash", { command: "ls", timeout })).timeout, 60);
  }
});

test("leaves other tools alone", async () => {
  const input = Object.freeze({ path: "app.py" });
  assert.strictEqual(await call("read", input), input);
});

test("explains a timed-out command and points at the tests", async () => {
  const text = "INFO: Uvicorn running on http://127.0.0.1:8000\n\nCommand timed out after 60 seconds";
  const content = await result("bash", text, true);
  assert.equal(content[0].text, text);
  assert.match(content[1].text, /never returns.*tests/s);
});

test("adds nothing to other results", async () => {
  for (const [tool, text, isError] of [
    ["bash", "2 failed, 3 passed\n\nCommand exited with code 1", true],
    ["bash", "Command timed out after 60 seconds", false],
    ["read", "Command timed out after 60 seconds", true],
  ]) {
    assert.deepEqual(await result(tool, text, isError), [{ type: "text", text }]);
  }
});
