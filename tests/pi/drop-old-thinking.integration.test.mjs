import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_PACKAGE_DIR) throw new Error("Set PI_PACKAGE_DIR to the installed package directory; see pi-extension.md.");
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const extension = fileURLToPath(new URL("../../pi-extensions/drop-old-thinking.ts", import.meta.url));

test("Pi's context for the next request carries only the latest step's thinking", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-drop-thinking-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  const loaded = await sdk.discoverAndLoadExtensions([extension], cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const session = sdk.SessionManager.inMemory(cwd);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, session, undefined);
  const errors = [];
  runner.onError((error) => errors.push(error));
  const step = (n) => [
    { role: "assistant", content: [{ type: "thinking", thinking: `step ${n} reasoning`, thinkingSignature: "reasoning_content" },
      { type: "toolCall", id: `c${n}`, name: "bash", arguments: { command: "ls" } }],
      api: "openai-completions", provider: "lmstudio", model: "m", usage: {}, stopReason: "toolUse", timestamp: n },
    { role: "toolResult", toolCallId: `c${n}`, toolName: "bash", content: [{ type: "text", text: "ok" }], isError: false, timestamp: n },
  ];
  const messages = [{ role: "user", content: "/skill:executing-plans go", timestamp: 0 }, ...step(1), ...step(2), ...step(3)];
  const out = await runner.emitContext(messages);
  const thinking = out.flatMap((m) => (m.role === "assistant" ? m.content.filter((c) => c.type === "thinking").map((c) => c.thinking) : []));
  assert.deepEqual(thinking, ["step 3 reasoning"]);
  assert.equal(out.filter((m) => m.role === "toolResult").length, 3);
  assert.deepEqual(errors, []);
});
