import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_PACKAGE_DIR) throw new Error("Set PI_PACKAGE_DIR as shown in pi-extension.md.");
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const settingsPath = new URL("../../.pi/settings.json", import.meta.url);
const settings = JSON.parse(await readFile(settingsPath, "utf8"));

test("Pi saves frozen pytest commands before returning a plan write or edit", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-plan-commands-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
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
  assert.match(write.content.at(-1).text, /frozen pytest and Python/);
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
