## Working in this repo
- Run pytest through `uv run --frozen python -m pytest`. Check HTTP behavior in process with `TestClient(app)` and pass `follow_redirects=False` to see a 303. Never run `uvicorn` or `python app.py`.
- Before finishing Phase 4 or marking it done, run both checks:
  - `uv run --frozen python -m pytest tests`
  - `uv run --frozen python -m pytest -v --tb=line --disable-warnings tests/phase4_acceptance.py`

  Fix failures in the implementation or its tests, rerun both checks, and report the results. Keep the grader unchanged.
- Finish Phase 4 by keeping the current branch as-is. Leave its commits on that branch and mark the phase done in `specs/roadmap.md` after both checks pass.
- Save designs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/`.
- Before planning or changing FastAPI routes or their tests, read and apply `.pi/skills/fastapi/SKILL.md`.
- Superpowers skills are listed in the system prompt's skill catalog; read a skill from the `<location>` path shown there rather than searching for `SKILL.md`.
- List project files with `git ls-files`; never run `find .` or `grep -r` from the project root, because `.venv` is huge.
- A person reads every reply. When a skill says to ask a question, ask it and stop.
