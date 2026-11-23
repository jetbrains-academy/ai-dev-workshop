import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../../pi-extensions/superpowers-unbootstrap.ts";

const bootstrap = `<EXTREMELY_IMPORTANT>
superpowers:using-superpowers bootstrap for pi

You have superpowers.

The using-superpowers skill content is included below and is already loaded for this Pi session. Follow it now. Do not try to load using-superpowers again.

Follow the relevant workflow.

## Pi tool mapping

Load the relevant SKILL.md with read.
</EXTREMELY_IMPORTANT>`;

const user = (content) => ({ role: "user", content, timestamp: 100 });
const block = (text) => [{ type: "text", text }];
const system = {
  role: "system",
  content: "Keep the prompt and tools.",
  toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
  timestamp: 1,
};

function handlers() {
  const registered = new Map();
  extension({ on: (name, handler) => registered.set(name, handler) });
  return registered;
}

async function transform(messages, persisted = [], projectionError) {
  const handler = handlers().get("context_with_system");
  const ctx = {
    sessionManager: {
      buildSessionProjection() {
        if (projectionError) throw projectionError;
        return { messages: persisted };
      },
    },
  };
  return (await handler?.({ type: "context_with_system", messages }, ctx))?.messages ?? messages;
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("hides the bootstrap and the skills this session cannot use from automatic selection without changing the registry", async () => {
  const skills = freeze([
    { name: "using-superpowers", description: "Use before any response", disableModelInvocation: false },
    { name: "systematic-debugging", description: "Diagnose bugs", disableModelInvocation: false },
    { name: "brainstorming", description: "Design features", disableModelInvocation: false },
    { name: "subagent-driven-development", description: "Dispatch subagents", disableModelInvocation: false },
    { name: "dispatching-parallel-agents", description: "Parallel agents", disableModelInvocation: false },
    { name: "using-git-worktrees", description: "Isolate work", disableModelInvocation: false },
    { name: "finishing-a-development-branch", description: "Merge or PR", disableModelInvocation: false },
    { name: "private-skill", description: "Explicit only", disableModelInvocation: true },
  ]);
  const event = { systemPromptOptions: { skills, promptGuidelines: ["Preserve this guideline"] } };
  await handlers().get("before_agent_start")?.(event);
  assert.deepEqual(event.systemPromptOptions.skills.filter(s => !s.disableModelInvocation).map(s => s.name), [
    "systematic-debugging", "brainstorming",
  ]);
  assert.equal(skills[0].disableModelInvocation, false);
  assert.equal(event.systemPromptOptions.skills[0].description, skills[0].description);
  assert.strictEqual(event.systemPromptOptions.skills[1], skills[1]);
});

test("restores the removed Pi tool mapping as one guideline, added once", async () => {
  const promptGuidelines = freeze(["Preserve this guideline"]);
  const event = { systemPromptOptions: { skills: [], promptGuidelines } };
  const handler = handlers().get("before_agent_start");
  await handler?.(event);
  await handler?.(event);
  const added = event.systemPromptOptions.promptGuidelines.slice(1);
  assert.equal(event.systemPromptOptions.promptGuidelines[0], "Preserve this guideline");
  assert.equal(added.length, 1);
  assert.doesNotMatch(added[0], /\n/);
  assert.match(added[0], /SKILL\.md/);
  assert.match(added[0], /subagent-driven-development/);
  assert.match(added[0], /in this session/);
  assert.deepEqual(promptGuidelines, ["Preserve this guideline"]);
});

for (const content of [bootstrap, block(bootstrap)]) {
  test(`removes a synthetic bootstrap with ${typeof content === "string" ? "string" : "text-block"} content`, async () => {
    const request = user("What is 2 + 2?");
    const messages = freeze([system, user(content), request]);
    const result = await transform(messages, [request]);
    assert.deepEqual(result, [system, request]);
    assert.strictEqual(result[0], system);
    assert.strictEqual(result[1], request);
    assert.equal(messages.length, 3);
    assert.strictEqual(await transform(result, [request]), result);
  });
}

test("preserves quoted instructions and other conversation content", async () => {
  const messages = freeze([
    system,
    user(`Please review this example:\n\`\`\`\n${bootstrap}\n\`\`\``),
    user("What does using-superpowers mean? Is there a 1% chance a skill applies?"),
    { role: "assistant", content: block(bootstrap), timestamp: 101 },
    { role: "toolResult", toolCallId: "read-1", toolName: "read", content: block(bootstrap), isError: false, timestamp: 102 },
    user([{ type: "text", text: bootstrap }, { type: "image", data: "AA==", mimeType: "image/png" }]),
    user([...block(bootstrap), ...block("Keep this second part")]),
    user(bootstrap.replace("</EXTREMELY_IMPORTANT>", "")),
    user(`${bootstrap}\nPlease explain the above.`),
    user(bootstrap.replace("You have superpowers.", "A changed upstream format.")),
  ]);
  assert.strictEqual(await transform(messages), messages);
});

test("preserves an exact user-authored bootstrap across text representations", async () => {
  const original = user(bootstrap);
  const messages = freeze([system, user(block(bootstrap))]);
  assert.strictEqual(await transform(messages, [original]), messages);
});

test("removes repeated synthetic bootstraps around retained system and conversation messages", async () => {
  const request = user("Explain this function");
  const patch = { role: "system", content: "Retain this tool patch", timestamp: 2 };
  assert.deepEqual(
    await transform([system, user(bootstrap), patch, user(block(bootstrap)), request], [request]),
    [system, patch, request],
  );
});

test("does not alter input if the session projection cannot be read", async () => {
  const messages = freeze([system, user(bootstrap), user("Keep this request")]);
  const original = structuredClone(messages);
  await assert.rejects(() => transform(messages, [], new Error("session unavailable")), /session unavailable/);
  assert.deepEqual(messages, original);
});
