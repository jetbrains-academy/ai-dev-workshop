## Working in this repo
- Run checks with `uv run --frozen python -m pytest tests`. Verify HTTP behavior in process with `TestClient` and `follow_redirects=False`; do not start a server.
- Save designs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/`.
- Superpowers skills are listed in the system prompt's skill catalog; read a skill from the `<location>` path shown there rather than searching for `SKILL.md`.
- Do not search `node_modules` or `.venv`.
