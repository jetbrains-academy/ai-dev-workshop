## Working in this repo
- Run pytest through `uv run --frozen python -m pytest`. Check HTTP behavior in process with `TestClient(app)` and pass `follow_redirects=False` to see a 303. Never run `uvicorn` or `python app.py`.
- Before finishing a phase or marking it done, run the project test suite and any additional checks listed for that phase in [the roadmap](specs/roadmap.md). Fix failures, rerun the checks, and report the results.
- Save designs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/`.
- Before planning or changing FastAPI routes or their tests, read and apply `.pi/skills/fastapi/SKILL.md`.
- Superpowers skills are listed in the system prompt's skill catalog; read a skill from the `<location>` path shown there rather than searching for `SKILL.md`.
- List project files with `git ls-files`; never run `find .` or `grep -r` from the project root, because `.venv` is huge.
- A person reads every reply. When a skill says to ask a question, ask it and stop.
