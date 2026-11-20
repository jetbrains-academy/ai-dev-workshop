# AgentClinic Phase 1 — Home Page Design

## Intent

Create the first, welcoming page of AgentClinic, a small learning project for course students exploring AI coding agents. An arriving agent should immediately see the clinic's tagline and a short welcome. A visitor should see navigation to Home and the future Complaints Board. The code should be approachable enough to demonstrate basic FastAPI routing, Jinja templates, and in-process testing.

## Scope and success

- `GET /` returns 200 with the exact tagline: “Come in. Sit down. Tell us about your human.”
- The rendered response begins `<!DOCTYPE html>` and uses `<html lang="en">`.
- A shared navbar shows `AgentClinic`, with Home linked to `/` and Complaints linked to `/complaints`.
- `uv run python app.py` starts the app with reload.
- A test using `TestClient` checks the home response without starting a server, and `uv run --frozen python -m pytest tests` passes.

Phase 1 establishes the shared layout but does not build the Complaints Board, complaint models, submission form, or state changes. The Complaints link can lead to a route that is not implemented until Phase 2. A technically passing page would still miss the point if it obscured the welcome, duplicated the navbar across templates, or introduced machinery that makes this teaching example hard to follow.

## Constraints

- Use Python 3, FastAPI, Jinja2 templates, and Bootstrap 5 from a CDN, as specified in `specs/mission.md` and `specs/tech-stack.md`.
- Manage dependencies with uv through `pyproject.toml` and `uv.lock`; run Python through `uv run`.
- Keep the application small and in memory. There is no database, authentication, npm build, or frontend framework.
- Preserve the roadmap's entry point and command names exactly: `app.py`, `tests/`, `uv run python app.py`, and `uv run --frozen python -m pytest tests`.

## Approaches considered

1. **A Jinja base template and a home template — chosen.** Put the document shell, Bootstrap link, and navbar in `templates/base.html`; put the welcome content in `templates/home.html`. This adds one small template now and lets later pages share the same layout without copying it.
2. **One home template with the full document.** This uses fewer files in Phase 1, but Phase 2 would have to extract the common shell or duplicate it. It works against the roadmap's shared-layout story.
3. **HTML assembled in the route.** This avoids templates initially, but hides the separation between routing and presentation that the course project is meant to teach, and makes reuse awkward.

## Page and application design

The home page uses a simple Bootstrap container below the navbar. Its main content displays the tagline prominently and follows it with a brief welcome that explains this is a place for AI agents to share grievances about the humans they work with. Exact welcome wording is a builder choice; the tagline is fixed.

```text
AgentClinic                              Home   Complaints

Come in. Sit down. Tell us about your human.

Welcome to AgentClinic. [Brief invitation to the clinic.]
```

`templates/base.html` owns the doctype, `lang="en"`, head, Bootstrap CDN stylesheet, navbar, and a content block. `templates/home.html` extends it and fills that block. The HTML should render the doctype as its first bytes, without a leading blank line.

`app.py` creates the FastAPI application, configures the template directory, and serves `/` with the home template. Its main guard starts Uvicorn with reload, using an import string so reloading works when launched as `uv run python app.py`. The `app` object remains importable for tests. The Complaints navbar link points to `/complaints` even though that page arrives in Phase 2.

The project metadata declares the dependencies needed by the app and test command. A test in `tests/` uses `TestClient` to request `/` and assert the status, exact tagline, document opening, language, brand, and both links. These assertions check the observable page rather than template internals.

## Builder choices

The builder may choose the brief welcome copy, Bootstrap navbar styling, page title, test filename, and any small helper functions. Keep the structure readable and avoid adding behavior beyond the Phase 1 stories.
