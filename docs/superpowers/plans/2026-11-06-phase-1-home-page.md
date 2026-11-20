# AgentClinic Phase 1 Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver AgentClinic's welcoming home page, reusable navbar, reloadable entry point, and in-process acceptance test.

**Architecture:** `app.py` owns the FastAPI app and `/` route. `templates/base.html` owns the document shell and navbar; `templates/home.html` extends it with the welcome. `tests/test_home.py` exercises the rendered page through `TestClient`.

**Tech Stack:** Python 3, uv, FastAPI 0.115.10, Uvicorn, Jinja2, Bootstrap 5 CDN, pytest 8.3.4, Starlette `TestClient`.

**Spec:** `docs/superpowers/specs/2026-11-06-phase-1-home-page-design.md` (read alongside `specs/roadmap.md` and `specs/tech-stack.md`).

## Global Constraints

- The tagline must appear exactly as `Come in. Sit down. Tell us about your human.`
- The response must begin `<!DOCTYPE html>` and include `<html lang="en">`.
- The navbar must show `AgentClinic`, link Home to `/`, and link Complaints to `/complaints`.
- `uv run python app.py` must start Uvicorn with reload; `app` must remain importable by the test.
- `uv run --frozen python -m pytest tests` must pass.
- Keep Phase 1 limited to the home page and shared layout. The Complaints Board begins in Phase 2.

## Review Focus

- A direct request to `/` without a running server returns 200: `test_home_page` uses `TestClient`.
- A query string on `/` still serves the same home page: `test_home_with_query_string`.
- The first response bytes contain the doctype with no leading whitespace: `test_home_page` checks `response.text.startswith`.
- Home and Complaints are actual links to the required paths, not just visible labels: `test_home_page` checks anchor destinations.
- Starting `app.py` launches a reload process without interfering with import from tests: the startup smoke check and frozen test command cover both modes.

---

### Task 1: Home page and shared layout

**Files:**
- Create: `pyproject.toml`
- Create: `uv.lock`
- Create: `app.py`
- Create: `templates/base.html`
- Create: `templates/home.html`
- Create: `tests/test_home.py`

**Interfaces:**
- Produces: importable `app: fastapi.FastAPI` in `app.py`.
- Produces: `GET /` returning the rendered home page; later routes can extend `templates/base.html`.

- [ ] **Step 1: Declare and lock dependencies.** Add a uv project in `pyproject.toml` with `fastapi[standard]==0.115.10`, `jinja2`, and a pytest dev dependency at `8.3.4`. Run `uv lock` and retain `uv.lock`. Use the project environment for every Python command.

- [ ] **Step 2: Write the failing `TestClient` tests in `tests/test_home.py`.** `test_home_page` imports `app` from `app.py`, requests `/`, and asserts status 200; the exact tagline; `response.text.startswith('<!DOCTYPE html>')`; `<html lang="en">`; `AgentClinic`; and Home and Complaints anchor destinations `/` and `/complaints`. `test_home_with_query_string` requests `/?source=course` and asserts 200 and the exact tagline. Use a standard-library HTML parser or precise anchor assertions so mere text labels do not pass for links.

- [ ] **Step 3: Verify the tests fail for the missing app.** Run `uv run --frozen python -m pytest tests -v`. Expect collection to fail because `app.py` does not yet exist.

- [ ] **Step 4: Implement the minimum app and templates.** In `app.py`, create `app: FastAPI`, configure `Jinja2Templates(directory="templates")`, and add a `GET /` handler that renders `home.html` with the request. Under `if __name__ == "__main__":`, start Uvicorn with the import string `"app:app"` and `reload=True`. Put `<!DOCTYPE html>` at the first bytes of `templates/base.html`, followed by `<html lang="en">`, a Bootstrap 5 CDN stylesheet, the `AgentClinic` navbar, both required links, and a content block. Make `templates/home.html` extend the base and show the exact tagline plus a brief welcome.

- [ ] **Step 5: Verify the page tests pass.** Run `uv run --frozen python -m pytest tests -v`. Expect both tests to pass, including the anchor and document assertions.

- [ ] **Step 6: Smoke-check the reload entry point.** Start `uv run python app.py`, confirm Uvicorn reports a running reloader, request `http://127.0.0.1:8000/` and confirm a 200 response with the tagline, then stop the process. If port 8000 is occupied, report that startup could not be verified; do not stop an unrelated service.

- [ ] **Step 7: Commit the Phase 1 deliverable.** Stage only the six files from this task and commit them with `feat: add AgentClinic home page`. If repository metadata is read-only in the execution environment, report that constraint and leave the verified files ready for the user's commit.
