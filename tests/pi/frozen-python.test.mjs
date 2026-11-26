import assert from "node:assert/strict";
import { test } from "node:test";
import extension, { freezePython } from "../../pi-extensions/frozen-python.ts";
import { fileURLToPath } from "node:url";
import { projectConfig } from "../../pi-extensions/project-config.ts";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const config = projectConfig(repo);

test("bare python commands run through the project's frozen environment", () => {
  assert.equal(freezePython("python -c 'import app'", config.python), "uv run --frozen python -c 'import app'");
  assert.equal(freezePython("python3 -m py_compile tests/test_board.py", config.python), "uv run --frozen python -m py_compile tests/test_board.py");
  assert.equal(freezePython("cd tests && python3.14 x.py", config.python), "cd tests && uv run --frozen python x.py");
  assert.equal(freezePython("ls; python -V | cat", config.python), "ls; uv run --frozen python -V | cat");
  assert.equal(freezePython("python - <<EOF\nprint(1)\nEOF", config.python), "uv run --frozen python - <<EOF\nprint(1)\nEOF");
});

test("commands that already pick an interpreter, or only mention python, are left alone", () => {
  for (const command of ["uv run python -c 'x'", "uv run --frozen python -m pytest", ".venv/bin/python x.py", "which python",
    "grep -n python README.md", "pythonic --help", "echo python"]) {
    assert.equal(freezePython(command, config.python), command);
  }
});

test("the tool_call handler rewrites bash input in place and blocks nothing", async () => {
  const handlers = new Map();
  extension({ on: (name, handler) => handlers.set(name, handler) });
  const event = { type: "tool_call", toolName: "bash", input: { command: "python3 -c 'print(1)'" } };
  assert.equal(await handlers.get("tool_call")(event, { cwd: repo }), undefined);
  assert.equal(event.input.command, "uv run --frozen python -c 'print(1)'");
  const read = { type: "tool_call", toolName: "read", input: Object.freeze({ path: "python" }) };
  assert.equal(await handlers.get("tool_call")(read, { cwd: repo }), undefined);
});

test("with no python command in the project config, commands are left alone", () => {
  assert.equal(freezePython("python -c 'x'", undefined), "python -c 'x'");
});
