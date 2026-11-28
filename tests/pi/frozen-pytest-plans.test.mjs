import assert from "node:assert/strict";
import { test } from "node:test";
import { dropVerificationTask, freezePlanCommands, nativePlanHeader } from "../../pi-extensions/frozen-pytest-plans.ts";
import { fileURLToPath } from "node:url";
import { projectConfig } from "../../pi-extensions/project-config.ts";
const config = projectConfig(fileURLToPath(new URL("../../", import.meta.url)));

const SUITE = "uv run --frozen python -m pytest tests";
const lines = (...parts) => parts.join("\n");

test("rewrites server steps to the test suite", () => {
  const plan = lines(
    "Run: `uv run python app.py` and navigate to /complaints",
    "Start app: `uvicorn app:app --reload`",
    "```bash", "python3 app.py &", "```",
  );
  assert.deepEqual(freezePlanCommands(plan, config), {
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
  assert.deepEqual(freezePlanCommands(plan, config), {
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
  assert.deepEqual(freezePlanCommands(plan, config), {
    markdown: plan.replace("`python app.py`", "`uv run --frozen python app.py`"),
    serverStarts: 0,
  });
});

test("keeps commands a labeled line forbids", () => {
  const plan = lines(
    "Run: `uv run pytest tests -v`; do not start `uvicorn`",
    "Run: `pytest -q` (never `python app.py`)",
  );
  assert.deepEqual(freezePlanCommands(plan, config), {
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
    const once = freezePlanCommands(plan, config);
    assert.deepEqual(freezePlanCommands(once.markdown, config), { markdown: once.markdown, serverStarts: 0 });
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


test("with no commands in the project config a plan is left as written", () => {
  const plan = lines("Run: `pytest tests -v`", "```bash", "uvicorn app:app", "python -c 'x'", "```");
  assert.deepEqual(freezePlanCommands(plan, {}), { markdown: plan, serverStarts: 0 });
});

// A last task that only reruns the tests (and commits) came out of 3 of 7 headless plans on 2026-11-27;
// the finish step already runs the suite, and its manual steps ("Visit /complaints") cannot run headless.
const tasksBefore = lines(
  "# Plan", "", "### Task 1: Model", "", "- Modify: `models.py`", "", "```python", "def test_model():", "    assert True", "```", "",
  "### Task 2: Route", "", "- Modify: `app.py`", "", "Run: `" + SUITE + "`", "",
);

test("drops a last task that only runs the project's tests and git", () => {
  const plan = tasksBefore + lines(
    "### Task 3: Verify Phase 1-3 still pass", "", "**Files:**", "- Run existing tests", "",
    "- [ ] **Step 1: Run the suite**", "  Run: `uv run --frozen python -m pytest tests/test_home.py -v`", "  Expected: PASS", "",
    "- [ ] **Step 2: Commit**", "  ```bash", "  git add .  # everything", "  git commit -m \"test: verify\"", "  ```", "",
  );
  assert.deepEqual(dropVerificationTask(plan, config), {
    markdown: tasksBefore, dropped: { number: 3, title: "Verify Phase 1-3 still pass" },
  });
});

test("a dropped verification task with manual steps keeps the sections after it", () => {
  const after = lines("---", "", "## Self-Review", "", "- Spec coverage: done", "");
  const plan = tasksBefore + lines(
    "### Task 3: Verify all phases", "", "- Modify: None", "", "Run: `" + SUITE + "`", "",
    "- [ ] **Step 2: Manual verification**", "- Visit `/complaints`, click Resolve", "",
  ) + after;
  const result = dropVerificationTask(plan, config);
  assert.equal(result.markdown, tasksBefore + after);
  assert.equal(result.dropped?.number, 3);
});

test("keeps a last task with test code, a file change, or another command", () => {
  for (const body of [
    lines("```python", "def test_unknown_id_is_404():", "    assert True", "```"),
    lines("- Modify: `templates/complaints.html`", "", "Run: `" + SUITE + "`"),
    lines("Run: `uv run --frozen python scripts/check.py`"),
    lines("Check the page by hand."),
  ]) {
    const plan = tasksBefore + lines("### Task 3: Last", "", body, "");
    assert.deepEqual(dropVerificationTask(plan, config), { markdown: plan }, body);
  }
});

test("only the last task is a candidate, and a single task stays", () => {
  const verify = lines("### Task 2: Verify", "", "Run: `" + SUITE + "`", "");
  const middle = lines("# Plan", "", "### Task 1: Model", "", "- Modify: `models.py`", "", verify, "### Task 3: Route", "",
    "- Modify: `app.py`", "");
  assert.deepEqual(dropVerificationTask(middle, config), { markdown: middle });
  const single = lines("# Plan", "", verify.replace("Task 2", "Task 1"));
  assert.deepEqual(dropVerificationTask(single, config), { markdown: single });
});
