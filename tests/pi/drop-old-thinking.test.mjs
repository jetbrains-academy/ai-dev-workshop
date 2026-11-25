import assert from "node:assert/strict";
import { test } from "node:test";
import { dropOldThinking } from "../../pi-extensions/drop-old-thinking.ts";

const think = (text) => ({ type: "thinking", thinking: text, thinkingSignature: "reasoning_content" });
const say = (text) => ({ type: "text", text });
const callTool = (id) => ({ type: "toolCall", id, name: "bash", arguments: { command: "ls" } });
const assistant = (...content) => ({ role: "assistant", content, api: "openai-completions", provider: "lmstudio",
  model: "m", usage: {}, stopReason: "toolUse", timestamp: 0 });
const user = (text) => ({ role: "user", content: text, timestamp: 0 });
const result = (id) => ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [say("ok")], isError: false, timestamp: 0 });

test("drops thinking from every assistant message but the latest", () => {
  const messages = [user("go"), assistant(think("a"), callTool("1")), result("1"),
    assistant(think("b"), say("x"), callTool("2")), result("2"), assistant(think("c"), callTool("3")), result("3")];
  const out = dropOldThinking(messages);
  assert.deepEqual(out[1].content, [callTool("1")]);
  assert.deepEqual(out[3].content, [say("x"), callTool("2")]);
  assert.deepEqual(out[5].content, [think("c"), callTool("3")], "the latest step keeps its thinking");
  assert.equal(out[0], messages[0]);
  assert.equal(out[2], messages[2]);
  assert.deepEqual(messages[1].content, [think("a"), callTool("1")], "the session's own messages are not changed");
});

test("keeps a message whose only content is thinking, so nothing becomes empty", () => {
  const messages = [user("go"), assistant(think("only")), user("Continue."), assistant(think("b"), callTool("1")), result("1")];
  assert.equal(dropOldThinking(messages), undefined, "nothing else to drop, so the request is unchanged");
  const more = [...messages, assistant(think("c"), callTool("2")), result("2")];
  const out = dropOldThinking(more);
  assert.deepEqual(out[1].content, [think("only")]);
  assert.deepEqual(out[3].content, [callTool("1")]);
});

test("returns undefined when there is nothing to drop", () => {
  assert.equal(dropOldThinking([user("go"), assistant(think("a"), callTool("1")), result("1")]), undefined);
  assert.equal(dropOldThinking([user("go"), assistant(say("x")), user("again"), assistant(say("y"))]), undefined);
  assert.equal(dropOldThinking([]), undefined);
});
