import assert from "node:assert/strict";
import { test } from "node:test";
import { freezePlanCommands, nativePlanHeader, redirectGraderEdits } from "../../pi-extensions/frozen-pytest-plans.ts";

const SUITE = "uv run --frozen python -m pytest tests";
const lines = (...parts) => parts.join("\n");

test("rewrites server steps to the test suite", () => {
  const plan = lines(
    "Run: `uv run python app.py` and navigate to /complaints",
    "Start app: `uvicorn app:app --reload`",
    "```bash", "python3 app.py &", "```",
  );
  assert.deepEqual(freezePlanCommands(plan), {
    markdown: lines(
      "Run: `" + SUITE + "` and navigate to /complaints",
      "Start app: `" + SUITE + "`",
      "```bash", SUITE, "```",
    ),
    serverStarts: 3,
  });
});

test("freezes python commands", () => {
  const plan = lines(
    'Run: `python -c "from models import complaints"`',
    "```sh", "uv run python -m py_compile models.py", "```",
    "Command: `python3.14 -m pytest tests`",
  );
  assert.deepEqual(freezePlanCommands(plan), {
    markdown: lines(
      'Run: `uv run --frozen python -c "from models import complaints"`',
      "```sh", "uv run --frozen python -m py_compile models.py", "```",
      "Command: `" + SUITE + "`",
    ),
    serverStarts: 0,
  });
});

test("leaves prose, prohibitions and Python code alone", () => {
  const plan = lines(
    "Use `python` 3.14 and never `uvicorn`.",
    "Never run `python app.py`; check routes with `TestClient`.",
    "```python", "import uvicorn", "uvicorn.run(app)", "```",
  );
  assert.deepEqual(freezePlanCommands(plan), {
    markdown: plan.replace("`python app.py`", "`uv run --frozen python app.py`"),
    serverStarts: 0,
  });
});

test("keeps commands a labeled line forbids", () => {
  const plan = lines(
    "Run: `uv run pytest tests -v`; do not start `uvicorn`",
    "Run: `pytest -q` (never `python app.py`)",
  );
  assert.deepEqual(freezePlanCommands(plan), {
    markdown: lines(
      "Run: `uv run --frozen python -m pytest tests -v`; do not start `uvicorn`",
      "Run: `uv run --frozen python -m pytest -q` (never `uv run --frozen python app.py`)",
    ),
    serverStarts: 0,
  });
});

test("is idempotent", () => {
  for (const plan of [
    lines("Run: `uv run python app.py` and navigate to /complaints", "```bash", "python3 app.py &", "```"),
    lines('Run: `python -c "import models"`', "Command: `python3.14 -m pytest tests`"),
    lines("Run: `pytest tests/test_board.py -v`", "Never run `python app.py`."),
  ]) {
    const once = freezePlanCommands(plan);
    assert.deepEqual(freezePlanCommands(once.markdown), { markdown: once.markdown, serverStarts: 0 });
  }
});

test("points the plan header at executing-plans only", () => {
  const header = "> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) " +
    "or superpowers:executing-plans to implement this plan task-by-task.";
  const native = "> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.";
  assert.equal(nativePlanHeader(header), native);
  assert.equal(nativePlanHeader(native), native);
  assert.equal(nativePlanHeader("- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development"),
    "- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans");
  assert.equal(nativePlanHeader("Mentions subagent-driven-development in prose."), "Mentions subagent-driven-development in prose.");
});

test("points plan steps that change the grader at a new test file", () => {
  const plan = lines(
    "### Task 4: Update phase4_acceptance.py tests",
    "**Files:**",
    "- Modify: `tests/phase4_acceptance.py`",
    "- Create: tests/phase4_acceptance.py",
    "- Test: `tests/phase4_acceptance.py::test_unknown_id_returns_404`",
    "- [ ] **Step 1: Create phase4_acceptance.py test file**",
    "- [ ] **Step 2: Run phase4_acceptance.py to verify it passes**",
    "Run: `uv run --frozen python -m pytest tests/phase4_acceptance.py`",
    "```bash", "git add tests/phase4_acceptance.py app.py", "```",
  );
  assert.deepEqual(redirectGraderEdits(plan), {
    markdown: lines(
      "### Task 4: Update test_phase4.py tests",
      "**Files:**",
      "- Modify: `tests/test_phase4.py`",
      "- Create: tests/test_phase4.py",
      "- Test: `tests/phase4_acceptance.py::test_unknown_id_returns_404`",
      "- [ ] **Step 1: Create test_phase4.py test file**",
      "- [ ] **Step 2: Run phase4_acceptance.py to verify it passes**",
      "Run: `uv run --frozen python -m pytest tests/phase4_acceptance.py`",
      "```bash", "git add tests/test_phase4.py app.py", "```",
    ),
    redirected: 5,
  });
  const once = redirectGraderEdits(plan).markdown;
  assert.deepEqual(redirectGraderEdits(once), { markdown: once, redirected: 0 });
});
