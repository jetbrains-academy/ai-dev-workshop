import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_PACKAGE_DIR) throw new Error("Set PI_PACKAGE_DIR as shown in pi-extension.md.");
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const settingsPath = new URL("../../.pi/settings.json", import.meta.url);
const settings = JSON.parse(await readFile(settingsPath, "utf8"));

const FIX_FIRST = "Fix these in the plan with `save_plan` and reread it before asking for approval:";

test("Pi saves frozen pytest commands before returning a plan write or edit", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-plan-commands-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await writeFile(path.join(cwd, ".pi/project.json"), await readFile(new URL("../../.pi/project.json", import.meta.url)));
  const extensions = settings.extensions.map((entry) => fileURLToPath(new URL(entry, settingsPath)));
  const loaded = await sdk.discoverAndLoadExtensions(extensions, cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
  const tools = { write: sdk.createWriteTool(cwd), edit: sdk.createEditTool(cwd), bash: sdk.createBashTool(cwd) };
  async function run(toolName, input) {
    const toolCallId = toolName;
    const decision = await runner.emitToolCall({ type: "tool_call", toolCallId, toolName, input });
    assert.equal(decision?.block, undefined);
    const result = await tools[toolName].execute(toolCallId, input, undefined, undefined);
    return runner.emitToolResult({ type: "tool_result", toolCallId, toolName, input, ...result, isError: false });
  }
  const plan = "docs/superpowers/plans/phase4.md";
  const frozen = "uv run --frozen python -m pytest";
  const draft = [
    "# Phase 4", "",
    "Run: `pytest tests/test_resolve.py -v`",
    "- Run `pytest tests/test_reopen.py -v`",
    "Run: python -m pytest tests/test_board.py",
    "Use the `pytest` fixture API.",
    "Run: `uv run python app.py` and visit /complaints", "",
    "```bash", "$ pytest tests::test_resolve", "uv run pytest tests/test_board.py", frozen + " tests", "```", "",
    "```python", "import pytest", 'command = "pytest tests"', "```", "",
  ].join("\n");
  const expected = draft
    .replace("`pytest tests/test_resolve.py", "`" + frozen + " tests/test_resolve.py")
    .replace("`pytest tests/test_reopen.py", "`" + frozen + " tests/test_reopen.py")
    .replace("Run: python -m pytest", "Run: " + frozen)
    .replace("$ pytest", "$ " + frozen)
    .replace("uv run pytest", frozen)
    .replace("`uv run python app.py`", "`" + frozen + " tests`");

  const write = await run("write", { path: plan, content: draft });
  assert.equal(await readFile(path.join(cwd, plan), "utf8"), expected);
  assert.match(write.content.at(-1).text, /project's test and Python commands/);
  assert.match(write.content.at(-1).text, /Replaced 1 server start with/);
  await run("edit", { path: path.join(cwd, plan), edits: [
    { oldText: "Run: `" + frozen + " tests/test_resolve.py -v`", newText: "Run: `pytest -q`" },
  ] });
  assert.match(await readFile(path.join(cwd, plan), "utf8"), /Run: `uv run --frozen python -m pytest -q`/);
  await run("bash", { command: "printf 'Run: `pytest tests`\\n' > docs/superpowers/plans/shell.md" });
  assert.equal(await readFile(path.join(cwd, "docs/superpowers/plans/shell.md"), "utf8"), "Run: `" + frozen + " tests`\n");

  await run("write", { path: "docs/design.md", content: draft });
  assert.equal(await readFile(path.join(cwd, "docs/design.md"), "utf8"), draft);
});

test("Pi warns with the plan line for a pass-only test and leaves the draft intact", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-plan-stubs-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  const extension = fileURLToPath(new URL("../../pi-extensions/frozen-pytest-plans.ts", import.meta.url));
  const loaded = await sdk.discoverAndLoadExtensions([extension], cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
  const plan = "docs/superpowers/plans/phase4.md";
  const draft = [
    "# Phase 4", "", "```python", "def test_route():", "    # Add request", "    pass", "",
    "def test_board():", "    pass", "    assert True", "",
    "def helper():", "    pass", "```", "",
    "```text", "def test_example():", "    pass", "```", "",
  ].join("\n");
  const input = { path: plan, content: draft };
  const result = await sdk.createWriteTool(cwd).execute("write", input, undefined, undefined);
  const response = await runner.emitToolResult({
    type: "tool_result", toolCallId: "write", toolName: "write", input, ...result, isError: false,
  });

  // The warning leads the result, ahead of the tool's own "reread, then ask for approval" text.
  assert.deepEqual(response?.content, [
    { type: "text", text: `${FIX_FIRST}\nWarning: \`test_route\` in ${plan}:6 contains only \`pass\`. Replace it with a complete test.` },
    ...result.content,
  ]);
  assert.equal(await readFile(path.join(cwd, plan), "utf8"), draft);
});

test("a saved plan loses a last task that only reruns the tests, and the result says so", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-plan-verify-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, ".pi"));
  await writeFile(path.join(cwd, ".pi/project.json"), await readFile(new URL("../../.pi/project.json", import.meta.url)));
  const extension = fileURLToPath(new URL("../../pi-extensions/frozen-pytest-plans.ts", import.meta.url));
  const loaded = await sdk.discoverAndLoadExtensions([extension], cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
  const plan = "docs/superpowers/plans/phase4.md";
  const kept = ["# Phase 4", "", "### Task 1: Route", "", "- Modify: `app.py`", "", "```python", "def test_route():",
    "    assert True", "```", ""].join("\n");
  const draft = kept + ["### Task 2: Verify all phases still pass", "", "Run: `pytest tests -v`", "",
    "```bash", "git commit -m \"test: verify\"", "```", ""].join("\n");
  const input = { path: plan, content: draft };
  const result = await sdk.createWriteTool(cwd).execute("write", input, undefined, undefined);
  const response = await runner.emitToolResult({
    type: "tool_result", toolCallId: "write", toolName: "write", input, ...result, isError: false,
  });
  assert.equal(await readFile(path.join(cwd, plan), "utf8"), kept);
  assert.match(response.content.at(-1).text,
    /Removed Task 2 \("Verify all phases still pass"\) from docs\/superpowers\/plans\/phase4\.md: it only reran the tests/);
});

test("Pi warns with plan lines for invalid Python test snippets and leaves the draft intact", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-plan-syntax-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, ".pi"));
  await writeFile(path.join(cwd, ".pi/project.json"), await readFile(new URL("../../.pi/project.json", import.meta.url)));
  const extension = fileURLToPath(new URL("../../pi-extensions/frozen-pytest-plans.ts", import.meta.url));
  const loaded = await sdk.discoverAndLoadExtensions([extension], cwd, cwd);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
  const plan = "docs/superpowers/plans/phase4.md";
  const draft = [
    "# Phase 4", "", "```python", "def test_route():", "    # Check the route", "```", "",
    "~~~py", "def test_board():", "    assert (", "~~~", "",
    "```python", "def test_valid():", "    assert True", "```", "",
    "```python", "incomplete_helper(", "```", "",
    "```text", "def test_example():", "    # Not a Python snippet", "```", "",
  ].join("\n");
  const input = { path: plan, content: draft };
  const result = await sdk.createWriteTool(cwd).execute("write", input, undefined, undefined);
  const response = await runner.emitToolResult({
    type: "tool_result", toolCallId: "write", toolName: "write", input, ...result, isError: false,
  });

  assert.ok(response, "return a syntax warning with the successful write");
  assert.equal(response.isError, false);
  assert.deepEqual(response.content.slice(1), result.content);
  const [header, ...warnings] = response.content[0].text.split("\n");
  assert.equal(header, FIX_FIRST);
  assert.equal(warnings.length, 2);
  // Named by the test that holds the error, with plan lines rather than snippet lines.
  assert.equal(warnings[0], `Warning: \`test_route\` in ${plan}:5 does not parse: ` +
    "expected an indented block after function definition on line 4. Give it a complete body.");
  assert.ok(warnings[1].startsWith(`Warning: \`test_board\` in ${plan}:10 does not parse: `), warnings[1]);
  assert.equal(await readFile(path.join(cwd, plan), "utf8"), draft);
});
