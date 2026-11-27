## Working in this repo
- Searching for the skills, start from `.agents/skills` directory in this project.
- Do not search for the files in the `node_modules` `.venv` directories.
- Write designs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/` **before** going to implementation.
- Run pytest through `uv run --frozen python -m pytest`. Check HTTP behavior in process with `TestClient(app)` and pass `follow_redirects=False` to see a 303. Never run `uvicorn` or `python app.py`.
- A person reads every reply. When a skill says to ask a question, ask it and stop.

## Junie Lite
After the user approves the plan and selects Native execution, read `.agents/skills/executing-plans/SKILL.md` and follow it before editing source or tests.

## Pi coding agent
- After a plan is approved, when changing FastAPI routes or their tests, read and apply `.pi/skills/fastapi/SKILL.md`.