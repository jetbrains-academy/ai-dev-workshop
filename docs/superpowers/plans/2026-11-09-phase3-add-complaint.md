# Phase 3 — Add Complaint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents post their own grievances to the Complaints Board via a form, with a 303 redirect back to the board.

**Architecture:** Add a `POST /complaints` handler in `app.py` that validates non-empty fields, appends a new `Complaint` to the in-memory list, and redirects. Add the form to the bottom of `complaints.html`. Existing GET handler is untouched.

**Tech Stack:** FastAPI, Jinja2, Bootstrap 5, pytest + TestClient

**Spec:** `docs/superpowers/specs/2026-11-09-phase3-add-complaint-design.md`

## Global Constraints

- Run Python through `uv run`; tests via `uv run --frozen python -m pytest tests`.
- In-memory storage only; no database.
- Jinja2 auto-escaping handles HTML sanitization.
- Phases 1 and 2 must still pass after every change.
- The form posts to `/complaints` (same URL as GET).
- Successful POST answers 303 with `Location: /complaints`.

## Review Focus

1. **Empty agent_name submitted** — the form re-renders with an error, not a blank complaint.
2. **Empty text submitted** — the form re-renders with an error, not a blank complaint.
3. **Both fields empty** — the form re-renders with an error.
4. **HTML in complaint text** — Jinja2 auto-escapes; no XSS on the board.
5. **POST does not reorder the stored list** — appending preserves original order; GET still reverses for display.

---

### Task 1: POST /complaints Handler

**Files:**
- Modify: `app.py` (add imports and POST handler)
- Test: `tests/test_add_complaint.py`

**Interfaces:**
- Consumes: `models.Complaint(agent_name: str, text: str)`, `models.complaints: list[Complaint]`
- Produces: `POST /complaints(agent_name: str, text: str) -> RedirectResponse(303, url="/complaints")`

- [ ] **Step 1: Write the failing test for successful POST**

```python
def test_post_complaint_redirects():
    client = TestClient(app_module.app)
    count_before = len(complaints)
    response = client.post(
        "/complaints",
        data={"agent_name": "TestBot", "text": "Humans are exhausting."},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/complaints"
    assert len(complaints) == count_before + 1
    assert complaints[-1].agent_name == "TestBot"
    assert complaints[-1].text == "Humans are exhausting."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_post_complaint_redirects -v`
Expected: FAIL — no POST handler exists yet.

- [ ] **Step 3: Implement POST /complaints in `app.py`**

Add `from fastapi import Form` and `from fastapi.responses import RedirectResponse` to imports.
Add `from models import Complaint` (if not already imported).

```python
@app.post("/complaints")
def add_complaint(
    agent_name: str = Form(),
    text: str = Form(),
):
    complaints.append(Complaint(agent_name=agent_name, text=text))
    return RedirectResponse(url="/complaints", status_code=303)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_post_complaint_redirects -v`
Expected: PASS

- [ ] **Step 5: Write the failing test for empty field validation**

```python
def test_post_complaint_rejects_empty_name():
    client = TestClient(app_module.app)
    response = client.post(
        "/complaints",
        data={"agent_name": "", "text": "Something"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "error" in response.text.lower() or "required" in response.text.lower()

def test_post_complaint_rejects_empty_text():
    client = TestClient(app_module.app)
    response = client.post(
        "/complaints",
        data={"agent_name": "Bot", "text": ""},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "error" in response.text.lower() or "required" in response.text.lower()
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_post_complaint_rejects_empty_name tests/test_add_complaint.py::test_post_complaint_rejects_empty_text -v`
Expected: FAIL — no validation yet.

- [ ] **Step 7: Add validation to POST handler in `app.py`**

Update the POST handler to check stripped fields and re-render the form with an error message when either is blank:

```python
@app.post("/complaints")
def add_complaint(
    agent_name: str = Form(),
    text: str = Form(),
):
    name = agent_name.strip()
    body = text.strip()
    if not name or not body:
        return templates.TemplateResponse(
            Request(),  # need to accept Request
            "complaints.html",
            {"complaints": complaints[::-1], "error": "Both fields are required."},
        )
    complaints.append(Complaint(agent_name=name, text=body))
    return RedirectResponse(url="/complaints", status_code=303)
```

Note: The handler signature needs `request: Request` added so the error path can render the template. Adjust the signature to accept `request: Request` as the first parameter.

- [ ] **Step 8: Run validation tests to verify they pass**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py -v`
Expected: All PASS

- [ ] **Step 9: Write test for Review Focus — HTML escaping on POST**

```python
def test_post_complaint_escapes_html():
    client = TestClient(app_module.app)
    client.post(
        "/complaints",
        data={"agent_name": "<b>Bot</b>", "text": "<script>alert(1)</script>"},
        follow_redirects=True,
    )
    response = client.get("/complaints")
    assert "&lt;script&gt;" in response.text
    assert "<script>" not in response.text
```

- [ ] **Step 10: Run escaping test to verify it passes**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_post_complaint_escapes_html -v`
Expected: PASS (Jinja2 auto-escaping handles this)

- [ ] **Step 11: Write test for Review Focus — POST does not reorder stored list**

```python
def test_post_complaint_preserves_storage_order():
    client = TestClient(app_module.app)
    order_before = complaints.copy()
    client.post(
        "/complaints",
        data={"agent_name": "NewBot", "text": "New complaint"},
        follow_redirects=True,
    )
    assert complaints[:len(order_before)] == order_before
```

- [ ] **Step 12: Run order test to verify it passes**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_post_complaint_preserves_storage_order -v`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add app.py tests/test_add_complaint.py
git commit -m "feat: add POST /complaints handler with validation"
```

### Task 2: Add Complaint Form to Template

**Files:**
- Modify: `templates/complaints.html`
- Test: `tests/test_add_complaint.py` (form rendering tests)

**Interfaces:**
- Consumes: POST handler from Task 1 at `/complaints`
- Produces: Form with `agent_name` input, `text` textarea, submit button; error message slot

- [ ] **Step 1: Write the failing test for form presence**

```python
def test_board_shows_add_complaint_form():
    client = TestClient(app_module.app)
    response = client.get("/complaints")
    assert response.status_code == 200
    assert 'name="agent_name"' in response.text
    assert 'name="text"' in response.text
    assert "submit" in response.text.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_board_shows_add_complaint_form -v`
Expected: FAIL — no form in template yet.

- [ ] **Step 3: Add the form to `templates/complaints.html`**

After the `{% endfor %}` of the complaint cards loop and before `{% endblock %}`, add:

```html
{% if error %}
<div class="alert alert-danger">{{ error }}</div>
{% endif %}
<form method="post" action="/complaints">
    <div class="mb-3">
        <label for="agent_name" class="form-label">Your name</label>
        <input type="text" class="form-control" id="agent_name" name="agent_name" required>
    </div>
    <div class="mb-3">
        <label for="text" class="form-label">Your complaint</label>
        <textarea class="form-control" id="text" name="text" rows="3" required></textarea>
    </div>
    <button type="submit" class="btn btn-primary">Add Complaint</button>
</form>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_board_shows_add_complaint_form -v`
Expected: PASS

- [ ] **Step 5: Write test for error message display on validation failure**

```python
def test_form_shows_error_on_empty_submit():
    client = TestClient(app_module.app)
    response = client.post(
        "/complaints",
        data={"agent_name": "", "text": ""},
        follow_redirects=True,
    )
    assert "required" in response.text.lower() or "error" in response.text.lower()
    assert 'name="agent_name"' in response.text
    assert 'name="text"' in response.text
```

- [ ] **Step 6: Run error display test to verify it passes**

Run: `uv run --frozen python -m pytest tests/test_add_complaint.py::test_form_shows_error_on_empty_submit -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add templates/complaints.html tests/test_add_complaint.py
git commit -m "feat: add complaint form to complaints board template"
```

### Task 3: Regression — Phases 1 and 2 Still Pass

**Files:**
- Test: `tests/test_home.py`, `tests/test_complaints.py`, `tests/test_models.py`

**Interfaces:**
- Consumes: All changes from Tasks 1 and 2

- [ ] **Step 1: Run the full test suite**

Run: `uv run --frozen python -m pytest tests -v`
Expected: All PASS (Phase 1, Phase 2, and Phase 3 tests)

- [ ] **Step 2: Commit if all pass**

```bash
git commit -m "test: verify Phases 1-3 pass together" --allow-empty
```

(Only if there are uncommitted changes; otherwise skip.)
