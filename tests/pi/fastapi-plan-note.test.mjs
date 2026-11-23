import assert from "node:assert/strict";
import { test } from "node:test";
import extension, { FASTAPI_NOTE, NOTE_MARKER } from "../../pi-extensions/fastapi-plan-note.ts";

function handler() {
  const registered = new Map();
  extension({ on: (name, fn) => registered.set(name, fn) });
  assert.deepEqual([...registered.keys()], ["tool_result"]);
  return registered.get("tool_result");
}

const read = (path, isError = false, toolName = "read") => ({
  type: "tool_result", toolName, input: { path }, content: [{ type: "text", text: "skill" }], isError,
});

for (const skill of ["writing-plans", "executing-plans"]) {
  test(`adds the note after the ${skill} skill`, () => {
    const result = handler()(read(`/x/superpowers/skills/${skill}/SKILL.md`));
    assert.equal(result.content.length, 2);
    assert.equal(result.content[0].text, "skill");
    assert.equal(result.content[1].text, FASTAPI_NOTE);
    assert.ok(FASTAPI_NOTE.includes(NOTE_MARKER));
    assert.match(FASTAPI_NOTE, /follow_redirects=False/);
    assert.match(FASTAPI_NOTE, /method="post"/);
  });
}

test("adds the note on every read", () => {
  const onResult = handler();
  const event = read("/x/superpowers/skills/writing-plans/SKILL.md");
  assert.equal(onResult(event).content.at(-1).text, FASTAPI_NOTE);
  assert.equal(onResult(event).content.at(-1).text, FASTAPI_NOTE);
});

test("skips failed reads and other files", () => {
  const onResult = handler();
  for (const event of [
    read("/x/superpowers/skills/writing-plans/SKILL.md", true),
    read("/x/superpowers/skills/brainstorming/SKILL.md"),
    read(".pi/skills/fastapi/SKILL.md"),
    read("docs/superpowers/plans/x.md"),
    read("/x/superpowers/skills/writing-plans/SKILL.md", false, "bash"),
  ]) {
    assert.equal(onResult(event), undefined, JSON.stringify(event.input) + event.toolName);
  }
});
