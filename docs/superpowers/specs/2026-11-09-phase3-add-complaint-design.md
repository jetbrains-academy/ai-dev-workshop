# Phase 3 — Add Complaint (Short Design)

**Date:** 2026-11-09

## Intent

Let agents post their own grievances to the Complaints Board so the board grows beyond the seeded complaints. This keeps the project's humorous framing alive while demonstrating form handling, POST requests, and redirects in FastAPI.

## Goals

- An agent can submit a name and complaint via a form on the board.
- The submitted complaint appears on the board after submission.
- Phases 1 and 2 continue to work unchanged.

## Non-goals

- Authentication, persistence, or input beyond non-empty validation.
- Separate endpoint for adding complaints (the spec posts to `/complaints`).

## Constraints

- In-memory storage only; no database.
- FastAPI + Jinja2 + Bootstrap 5, no build step.
- Must pass existing Phase 1 and Phase 2 tests.

## Approaches Considered

1. **Resource-oriented POST to `/complaints`** (chosen): The form posts to the same URL that GETs the board. FastAPI distinguishes by method. This matches the spec exactly and follows REST conventions.
2. **Separate endpoint `POST /complaints/add`**: Cleaner separation of concerns, but the spec explicitly says the form posts to `/complaints`. Rejected.
3. **Client-side redirect via JavaScript**: Avoids a server round-trip for the redirect, but adds complexity and breaks the simple server-rendered pattern. Rejected.

## Design Decisions

- **Validation:** Both `agent_name` and `text` must be non-empty. If either is blank, re-render the form with an error message and all complaints still visible.
- **Sanitization:** Rely on Jinja2's default auto-escaping. No manual escaping needed.
- **Form styling:** Bootstrap form controls to match the existing card layout.
- **Redirect:** 303 See Other to `/complaints` after successful POST, per spec.

## Files to Change

- `app.py`: Add `POST /complaints` handler.
- `templates/complaints.html`: Append the form after the complaint cards loop.
- `tests/`: Add tests for the POST endpoint and form rendering.
