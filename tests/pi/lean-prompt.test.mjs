import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../../pi-extensions/lean-prompt.ts";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const skill = (dir, name, disableModelInvocation = false) => ({
  name,
  description: `${name} description`,
  filePath: `${dir}/${name}/SKILL.md`,
  baseDir: `${dir}/${name}`,
  disableModelInvocation,
});

async function run(systemPromptOptions) {
  const registered = new Map();
  extension({ on: (name, handler) => registered.set(name, handler) });
  const event = { systemPromptOptions };
  await registered.get("before_agent_start")?.(event);
  return event.systemPromptOptions;
}

const visible = (options) => options.skills.filter((s) => !s.disableModelInvocation).map((s) => s.name);

test("advertises only the skills installed beside using-superpowers", async () => {
  const skills = freeze([
    skill("/home/me/.agents/skills", "hf-cli"),
    skill("/pkg/superpowers/skills", "using-superpowers", true),
    skill("/pkg/superpowers/skills", "brainstorming"),
    skill("/pkg/superpowers/skills", "writing-plans"),
    skill("/pkg/subagents/skills", "pi-subagents"),
  ]);
  const options = await run({ skills, selectedTools: ["read"] });
  assert.deepEqual(visible(options), ["brainstorming", "writing-plans"]);
  assert.deepEqual(options.skills.map((s) => s.name), skills.map((s) => s.name), "the registry keeps every skill");
  assert.strictEqual(options.skills[2], skills[2]);
  assert.equal(skills[0].disableModelInvocation, false);
});

test("keeps a project-local Superpowers install and its neighbours", async () => {
  const skills = freeze([
    skill("/repo/.agents/skills", "using-superpowers"),
    skill("/repo/.agents/skills", "brainstorming"),
    skill("/repo/.agents/skills", "team-skill"),
    skill("/home/me/.agents/skills", "hf-cli"),
  ]);
  assert.deepEqual(visible(await run({ skills, selectedTools: [] })), ["using-superpowers", "brainstorming", "team-skill"]);
});

test("leaves the catalog alone when Superpowers is not installed", async () => {
  const skills = freeze([skill("/home/me/.agents/skills", "hf-cli"), skill("/pkg/docs/skills", "context7-docs")]);
  const options = await run({ skills, selectedTools: [] });
  assert.strictEqual(options.skills, skills);
});

test("declares only Pi's file and shell tools, in their original order", async () => {
  const selectedTools = freeze(["read", "bash", "edit", "write", "resolve_library_id", "query_docs", "subagent", "bg_wait", "grep"]);
  const options = await run({ skills: [], selectedTools });
  assert.deepEqual(options.selectedTools, ["read", "bash", "edit", "write", "grep"]);
});

test("does not replace a tool selection that is already lean", async () => {
  const selectedTools = freeze(["read", "bash", "edit", "write"]);
  const options = await run({ skills: [], selectedTools });
  assert.strictEqual(options.selectedTools, selectedTools);
});

async function result(toolName, text, extra = []) {
  const registered = new Map();
  extension({ on: (name, handler) => registered.set(name, handler) });
  const event = freeze({ type: "tool_result", toolName, content: [{ type: "text", text }, ...extra], isError: false });
  return (await registered.get("tool_result")?.(event))?.content ?? event.content;
}

test("trims an oversized shell result to its head and tail with a note", async () => {
  const listing = Array.from({ length: 4000 }, (_, i) => `./.venv/lib/site-packages/pkg/module_${i}.py`).join("\n");
  const image = { type: "image", data: "AA==", mimeType: "image/png" };
  const content = await result("bash", `${listing}\n8 passed in 0.37s`, [image]);
  const text = content[0].text;
  assert.ok(text.length < 8500, `kept ${text.length} characters`);
  assert.ok(text.startsWith("./.venv/lib/site-packages/pkg/module_0.py\n"));
  assert.ok(text.endsWith("8 passed in 0.37s"));
  assert.match(text, /\[trimmed [\d,]+ of [\d,]+ characters.*git ls-files/s);
  assert.deepEqual(content.slice(1), [image]);
});

test("leaves ordinary results and whole file reads alone", async () => {
  const skill = "x".repeat(20000);
  for (const [tool, text] of [["bash", "y".repeat(8000)], ["read", skill], ["edit", skill]]) {
    const content = await result(tool, text);
    assert.equal(content[0].text, text);
  }
});
