import assert from "node:assert/strict";
import { test } from "node:test";
import extension, { liveServerUse } from "../../pi-extensions/no-live-server.ts";
import { fileURLToPath } from "node:url";
import { projectConfig } from "../../pi-extensions/project-config.ts";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const config = projectConfig(repo);

async function call(toolName, input, cwd = repo) {
  const registered = new Map();
  extension({ on: (name, handler) => registered.set(name, handler) });
  return registered.get("tool_call")({ type: "tool_call", toolName, input }, { cwd });
}

// Every server start Mellum issued in rehearsals 4 and 6, as it spelled them.
const REHEARSAL_STARTS = [
  "echo 'Starting app in background...' && . .venv/bin/python -m uvicorn app:app --reload &",
  ". .venv/bin/activate && uvicorn app:app --reload",
  "uvicorn app:app --host 0.0.0.0 --port 8000",
  ". .venv/bin/activate && .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000",
  ". .venv/bin/activate && python app.py",
  "uv run uvicorn app:app --port 8000 & echo $!",
];

test("blocks every server start from the rehearsals", async () => {
  for (const command of REHEARSAL_STARTS) {
    assert.equal(liveServerUse(command, config.servers), "server", command);
    const decision = await call("bash", { command });
    assert.equal(decision.block, true, command);
    assert.match(decision.reason, /TestClient.*follow_redirects=False/s);
  }
});

test("blocks other spellings of a start", () => {
  for (const command of [
    "uv run --frozen python app.py",
    "uv run python -m uvicorn app:app",
    "nohup uvicorn app:app > server.log 2>&1 &",
    "PORT=9000 python3 -u ./app.py",
    "cd src; fastapi dev app.py",
    "(uvicorn app:app &)",
    "python -m http.server 8000",
  ]) {
    assert.equal(liveServerUse(command, config.servers), "server", command);
  }
});

test("blocks a request to a local server", async () => {
  for (const command of [
    "curl -X POST http://localhost:8000/complaints/2/resolve -v",
    "sleep 2 && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/",
    "wget -qO- http://0.0.0.0:8000/complaints",
    'curl -s "http://localhost:8000/complaints"',
  ]) {
    assert.equal(liveServerUse(command, config.servers), "probe", command);
  }
  const decision = await call("bash", { command: "curl -i localhost:8000/complaints" });
  assert.equal(decision.block, true);
  assert.match(decision.reason, /local server/);
});

test("lets commands that only name a server or the app through", async () => {
  for (const command of [
    "uv run --frozen python -m pytest tests",
    "uv run python -m pytest tests/test_board.py -v",
    "uv run python -m py_compile app.py",
    'uv run python -c "import app; print(app.app.routes)"',
    'python -c "import uvicorn; print(uvicorn.__version__)"',
    "pip show uvicorn",
    "uv run python -m uvicorn --version",
    "uvicorn --help",
    "uv pip list | grep uvicorn",
    "which uvicorn",
    "pkill -f uvicorn || true",
    "git log -p app.py",
    "git add app.py templates/complaints.html",
    'git commit -m "feat: run uvicorn; python app.py"',
    "cat app.py",
    "grep -n uvicorn app.py",
    "ls -la .venv/bin/uvicorn",
    "curl -s https://pypi.org/pypi/fastapi/json",
    "echo 'see http://localhost:8000'",
  ]) {
    assert.equal(liveServerUse(command, config.servers), undefined, command);
    assert.equal(await call("bash", { command }), undefined, command);
  }
});

test("ignores other tools and malformed input", async () => {
  assert.equal(await call("read", { path: "app.py" }), undefined);
  assert.equal(await call("write", { path: "run.sh", content: "uvicorn app:app" }), undefined);
  assert.equal(await call("bash", {}), undefined);
});

test("without servers in the project config nothing is blocked", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const empty = await mkdtemp(path.join(tmpdir(), "pi-no-config-"));
  try {
    assert.equal(await call("bash", { command: "uvicorn app:app --port 8000" }, empty), undefined);
    assert.equal(liveServerUse("uvicorn app:app", {}), undefined);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
