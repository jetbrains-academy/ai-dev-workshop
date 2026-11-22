## Working in this repo
- Run checks with `uv run --frozen python -m pytest tests`. Verify HTTP behavior in process with `TestClient` and `follow_redirects=False`; do not start a server.
- Save designs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/`.
- Superpowers skills are listed in the system prompt's skill catalog; read a skill from the `<location>` path shown there rather than searching for `SKILL.md`.
- List project files with `git ls-files`; never run `find .` or `grep -r` from the project root, because `.venv` is huge.
- A person reads every reply. When a skill says to ask a question, ask it and stop.
