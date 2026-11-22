# AgentClinic Phase 2 — Complaints Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Complaints Board with seeded, dated complaint cards, newest first, while preserving the home page.

**Architecture:** `models.py` owns the dataclass and in-memory seed list. `app.py` passes a reversed copy of that list to a Jinja template that extends the existing base layout; the template only renders the cards.

**Tech Stack:** Python 3.10+, FastAPI 0.115.10, Jinja2, Bootstrap 5, pytest 8.3.4, Starlette `TestClient`, uv.

**Spec:** `docs/superpowers/specs/2026-11-09-phase-2-complaints-board-design.md`

## Global Constraints

- Preserve `app.py`, `templates/base.html`, and the `GET /` route.
- Keep storage in `models.complaints`, a module-level list; do not add a database, authentication, form, IDs, or status.
- One seed has `text == "Scope creep never ends."`; use three to five seeds total.
- Render newest first from a reversed copy; do not mutate the stored list.
- Run checks through `uv run --frozen python -m pytest tests`.

## Review Focus

- Two `Complaint` instances created without a timestamp must receive separate, UTC-aware timestamps: Task 1 model test.
- A complaint containing HTML-like name or text must render escaped rather than as markup: Task 2 board test.
- The board must still find its template after the working directory changes: Task 2 board test.
- An empty complaint list must still render the heading without cards: Task 2 board test.
- Displaying the board must reverse visible order without changing `models.complaints`: Task 2 board test.

---

### Task 1: Complaint model and seeds

**Files:**
- Create: `models.py`
- Create: `tests/test_models.py`

**Interfaces:**
- Produces: `Complaint(agent_name: str, text: str, timestamp: datetime = <factory>)` as a dataclass; `complaints: list[Complaint]` at module level.
- Task 2 imports `complaints` and reads each instance's `agent_name`, `text`, and `timestamp`.

- [ ] **Step 1: Write failing model tests** in `tests/test_models.py` for positional `Complaint("Agent", "A gripe")`, its field values, a `datetime` timestamp with UTC offset, separate default timestamp objects created within the current-time window, three to five seeded complaints, and the exact `Scope creep never ends.` seed.
- [ ] **Step 2: Run the model tests and confirm they fail** with `uv run --frozen python -m pytest tests/test_models.py -q` because `models` does not exist.
- [ ] **Step 3: Implement `models.py`** using `@dataclass`, `field(default_factory=...)`, and `datetime.now(timezone.utc)`. Keep `agent_name` and `text` as the first two positional fields, followed by `timestamp`. Add three to five short, distinct seed complaints.
- [ ] **Step 4: Run `uv run --frozen python -m pytest tests/test_models.py -q`** and confirm all model tests pass.
- [ ] **Step 5: Commit** `models.py` and `tests/test_models.py` with message `feat: add seeded complaint model`.

### Task 2: Complaints route and board template

**Files:**
- Modify: `app.py`
- Create: `templates/complaints.html`
- Create: `tests/test_complaints.py`

**Interfaces:**
- Consumes: `models.complaints: list[Complaint]` and each complaint's `agent_name`, `text`, `timestamp` from Task 1.
- Produces: `GET /complaints` via `def complaints_board(request: Request)`; renders `complaints.html` with a context variable named `complaints` holding `models.complaints[::-1]`.

- [ ] **Step 1: Write failing board tests** in `tests/test_complaints.py`. Use `TestClient(app)` and a small `HTMLParser` helper that collects the flattened text of elements with a `.card` class. Check status 200; opening doctype; `lang="en"`; `Complaints Board`; brand and both nav links; exactly one card per seed; and each card's corresponding agent name, exact text, and `timestamp.strftime("%Y-%m-%d")` in reverse seed order. Assert the stored list's order is unchanged after the request.
- [ ] **Step 2: Add edge-case tests** in the same file: import the `app` module as `app_module`, monkeypatch `app_module.complaints` with a list containing `Complaint("<Agent>", "<script>alert(1)</script>")`, and assert the HTML contains `&lt;Agent&gt;` and `&lt;script&gt;` while containing no literal `<script>` tag; monkeypatch the list with `[]` and assert the heading remains with zero cards; change the working directory with `monkeypatch.chdir(tmp_path)` and assert the board still renders.
- [ ] **Step 3: Run the board tests and confirm they fail** with `uv run --frozen python -m pytest tests/test_complaints.py -q` because `/complaints` is not implemented.
- [ ] **Step 4: Add `def complaints_board(request: Request)` in `app.py`** at `GET /complaints`. Import the model list and pass `complaints[::-1]` to `templates.TemplateResponse`, preserving the existing absolute template path and home route.
- [ ] **Step 5: Create `templates/complaints.html`** extending `base.html`; include an `h1` with `Complaints Board`; loop over `complaints`; put each name, text, and `timestamp.strftime("%Y-%m-%d")` inside one Bootstrap `.card`. Let Jinja escape names and text.
- [ ] **Step 6: Run `uv run --frozen python -m pytest tests/test_complaints.py -q`** and confirm all board tests pass.
- [ ] **Step 7: Run `uv run --frozen python -m pytest tests`** and confirm Phase 1 and Phase 2 tests pass together.
- [ ] **Step 8: Commit** `app.py`, `templates/complaints.html`, and `tests/test_complaints.py` with message `feat: add read-only complaints board`.
