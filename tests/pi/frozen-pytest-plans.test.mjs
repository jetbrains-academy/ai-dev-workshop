import assert from "node:assert/strict";
import { test } from "node:test";
import { fastapiPaths, freezePlanCommands, nativePlanHeader, redirectGraderEdits } from "../../pi-extensions/frozen-pytest-plans.ts";

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
      "- Test: `tests/test_phase4.py::test_unknown_id_returns_404`",
      "- [ ] **Step 1: Create test_phase4.py test file**",
      "- [ ] **Step 2: Run phase4_acceptance.py to verify it passes**",
      "Run: `uv run --frozen python -m pytest tests/phase4_acceptance.py`",
      "```bash", "git add tests/test_phase4.py app.py", "```",
    ),
    redirected: 6,
  });
  const once = redirectGraderEdits(plan).markdown;
  assert.deepEqual(redirectGraderEdits(once), { markdown: once, redirected: 0 });
});

test("numbered plan headings without Task become Task headings", async () => {
  const { taskHeadings } = await import("../../pi-extensions/frozen-pytest-plans.ts");
  const plan = lines("# Plan", "### 1. Update Complaint Model", "- [ ] step", "### 2) Routes", "```", "### 3. not a task", "```",
    "#### 3: Template");
  assert.deepEqual(taskHeadings(plan), {
    markdown: lines("# Plan", "### Task 1: Update Complaint Model", "- [ ] step", "### Task 2: Routes", "```", "### 3. not a task",
      "```", "#### Task 3: Template"),
    renamed: 3,
  });
  const tasks = lines("### Task 1: A", "### 2. Also a section");
  assert.deepEqual(taskHeadings(tasks), { markdown: tasks, renamed: 0 }, "a plan that has Task headings is left alone");
  const once = taskHeadings(plan).markdown;
  assert.deepEqual(taskHeadings(once), { markdown: once, renamed: 0 });
  assert.deepEqual(taskHeadings("### 1. Only one"), { markdown: "### 1. Only one", renamed: 0 }, "one numbered heading is not a task list");
});

test("points a task's own tests and single grader tests at the model's test file", () => {
  // Final n=8 run 7 (2026-11-25): "Run: `... pytest tests/phase4_acceptance.py::test_resolve_route` (to be created)"
  // named a grader test that does not exist; run 4's Task 2 had "- Test: `tests/phase4_acceptance.py`".
  const plan = lines(
    "- Test: `tests/phase4_acceptance.py`",
    "**Test:** tests/phase4_acceptance.py (or new test file)",
    "  - Run: `uv run --frozen python -m pytest tests/phase4_acceptance.py::test_resolve_route` (to be created)",
    "Run `pytest phase4_acceptance.py::test_x -v`",
    "Run: `uv run --frozen python -m pytest -v tests/phase4_acceptance.py`",
    "The grader `tests/phase4_acceptance.py` runs at the finish.",
  );
  assert.deepEqual(redirectGraderEdits(plan), {
    markdown: lines(
      "- Test: `tests/test_phase4.py`",
      "**Test:** tests/test_phase4.py (or new test file)",
      "  - Run: `uv run --frozen python -m pytest tests/test_phase4.py::test_resolve_route` (to be created)",
      "Run `pytest test_phase4.py::test_x -v`",
      "Run: `uv run --frozen python -m pytest -v tests/phase4_acceptance.py`",
      "The grader `tests/phase4_acceptance.py` runs at the finish.",
    ),
    redirected: 4,
  });
  const once = redirectGraderEdits(plan).markdown;
  assert.deepEqual(redirectGraderEdits(once), { markdown: once, redirected: 0 });
});

test("writes Flask-style path parameters the FastAPI way", () => {
  // Final n=8 run 1 (2026-11-25): the plan had "@app.route('/complaints/<int:id>/resolve', methods=['POST'])";
  // the route never matched, and Pi spent 30 minutes on probes.
  const plan = lines(
    "@app.route('/complaints/<int:id>/resolve', methods=['POST'])",
    '@app.post("/complaints/<int:complaint_id>/reopen")',
    "POST /complaints/<id>/resolve redirects to /complaints.",
    '@app.post("/complaints/{id}/resolve")',
    "<form method=\"post\" action=\"/complaints/{{ c.id }}/resolve\"><button>Resolve</button></form>",
    "if a < b and c > d: pass",
  );
  assert.deepEqual(fastapiPaths(plan), {
    markdown: lines(
      "@app.route('/complaints/{id}/resolve', methods=['POST'])",
      '@app.post("/complaints/{complaint_id}/reopen")',
      "POST /complaints/{id}/resolve redirects to /complaints.",
      '@app.post("/complaints/{id}/resolve")',
      "<form method=\"post\" action=\"/complaints/{{ c.id }}/resolve\"><button>Resolve</button></form>",
      "if a < b and c > d: pass",
    ),
    rewritten: 3,
  });
  const once = fastapiPaths(plan).markdown;
  assert.deepEqual(fastapiPaths(once), { markdown: once, rewritten: 0 });
});
