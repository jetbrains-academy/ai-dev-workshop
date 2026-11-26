import assert from "node:assert/strict";
import { test } from "node:test";
import extension, { freezePython } from "../../pi-extensions/frozen-python.ts";

test("bare python commands run through the project's frozen environment", () => {
  assert.equal(freezePython("python -c 'import app'"), "uv run --frozen python -c 'import app'");
  assert.equal(freezePython("python3 -m py_compile tests/test_board.py"), "uv run --frozen python -m py_compile tests/test_board.py");
  assert.equal(freezePython("cd tests && python3.14 x.py"), "cd tests && uv run --frozen python x.py");
  assert.equal(freezePython("ls; python -V | cat"), "ls; uv run --frozen python -V | cat");
  assert.equal(freezePython("python - <<EOF\nprint(1)\nEOF"), "uv run --frozen python - <<EOF\nprint(1)\nEOF");
});

test("commands that already pick an interpreter, or only mention python, are left alone", () => {
  for (const command of ["uv run python -c 'x'", "uv run --frozen python -m pytest", ".venv/bin/python x.py", "which python",
    "grep -n python README.md", "pythonic --help", "echo python"]) {
    assert.equal(freezePython(command), command);
  }
});

test("the tool_call handler rewrites bash input in place and blocks nothing", async () => {
  const handlers = new Map();
  extension({ on: (name, handler) => handlers.set(name, handler) });
  const event = { type: "tool_call", toolName: "bash", input: { command: "python3 -c 'print(1)'" } };
  assert.equal(await handlers.get("tool_call")(event), undefined);
  assert.equal(event.input.command, "uv run --frozen python -c 'print(1)'");
  const read = { type: "tool_call", toolName: "read", input: Object.freeze({ path: "python" }) };
  assert.equal(await handlers.get("tool_call")(read), undefined);
});
