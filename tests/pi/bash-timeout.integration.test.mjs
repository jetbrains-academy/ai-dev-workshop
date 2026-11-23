import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_PACKAGE_DIR) throw new Error("Set PI_PACKAGE_DIR to the installed package directory; see pi-extension.md.");
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const local = (name) => fileURLToPath(new URL(`../../pi-extensions/${name}`, import.meta.url));

const sandbox = await mkdtemp(path.join(tmpdir(), "pi-bash-timeout-test-"));
after(() => rm(sandbox, { recursive: true, force: true }));
const cwd = path.join(sandbox, "project");
const agentDir = path.join(sandbox, "agent");
await mkdir(cwd);
await mkdir(agentDir);

test("Pi's bash tool stops a command that never returns and the result explains why", async () => {
  const loaded = await sdk.discoverAndLoadExtensions([local("lean-prompt.ts"), local("no-live-server.ts"), local("bash-timeout.ts")], cwd, agentDir);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));

  // What Mellum sent in rehearsal 4, with no timeout.
  const input = { command: "echo started; sleep 300" };
  const decision = await runner.emitToolCall({ type: "tool_call", toolCallId: "call-1", toolName: "bash", input });
  assert.equal(decision?.block, undefined);
  assert.equal(input.timeout, 60);

  // A server start is refused before it runs, whichever extension loads first.
  const start = { command: ". .venv/bin/activate && .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000" };
  const refused = await runner.emitToolCall({ type: "tool_call", toolCallId: "call-0", toolName: "bash", input: start });
  assert.equal(refused.block, true);
  assert.match(refused.reason, /follow_redirects=False/);

  // Run the real tool with a one-second limit so the test stays fast.
  const bash = sdk.createBashTool(cwd);
  const started = Date.now();
  let message;
  try {
    await bash.execute("call-1", { ...input, timeout: 1 }, undefined, undefined);
  } catch (error) {
    message = error.message;
  }
  assert.ok(Date.now() - started < 10_000, "the command was stopped");
  assert.match(message, /started/);

  const result = await runner.emitToolResult({
    type: "tool_result",
    toolCallId: "call-1",
    toolName: "bash",
    input,
    content: [{ type: "text", text: message }],
    isError: true,
  });
  const text = result.content.map((part) => part.text).join("");
  assert.match(text, /Command timed out after 1 seconds/);
  assert.match(text, /never returns.*tests/s);
  assert.deepEqual(errors, []);
});
