import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import extension, { setupWarnings } from "../../pi-extensions/project-check.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const expected = { contextWindow: 60000, thinkingLevel: "high" };

test("a matching model and thinking level give no warning", () => {
  assert.deepEqual(setupWarnings(expected, { contextWindow: 60000, thinkingLevel: "high" }), []);
  assert.deepEqual(setupWarnings(undefined, { contextWindow: 128000, thinkingLevel: "off" }), []);
});

test("a larger context window than the project's is explained with its fix", () => {
  const [warning] = setupWarnings(expected, { contextWindow: 128000, thinkingLevel: "high" });
  assert.match(warning, /128000/);
  assert.match(warning, /60000/);
  assert.match(warning, /drops? context/);
  assert.match(warning, /"contextWindow": 60000/);
  assert.match(warning, /models\.json/);
});

test("thinking off is explained, including the reasoning flag that makes higher levels available", () => {
  const [warning] = setupWarnings(expected, { contextWindow: 60000, thinkingLevel: "off" });
  assert.match(warning, /"off"/);
  assert.match(warning, /"high"/);
  assert.match(warning, /\/thinking/);
  assert.match(warning, /"reasoning": true/);
});

function load(thinking = "high") {
  const handlers = new Map();
  extension({ on: (name, handler) => handlers.set(name, handler), getThinkingLevel: () => thinking });
  const notes = [];
  const ctx = (model) => ({ cwd: repo, model, ui: { notify: (message, type) => notes.push({ message, type }) } });
  return { handlers, notes, ctx };
}

test("the project's settings are checked at session start, on a model change and on a thinking change", async () => {
  const { handlers, notes, ctx } = load("off");
  await handlers.get("session_start")({ type: "session_start" }, ctx({ contextWindow: 128000 }));
  assert.equal(notes.length, 2);
  assert.ok(notes.every((note) => note.type === "warning"));

  await handlers.get("model_select")({ type: "model_select", model: { contextWindow: 60000 } }, ctx({ contextWindow: 60000 }));
  assert.equal(notes.length, 3, "thinking is still off");

  await handlers.get("thinking_level_select")({ type: "thinking_level_select", level: "high", previousLevel: "off" },
    ctx({ contextWindow: 60000 }));
  assert.equal(notes.length, 3, "nothing left to warn about");
});
