# Tech Stack

| Layer | Choice | Version | Notes |
|-------|--------|---------|-------|
| Language | Python 3 | — | Run through the project environment with `uv run` |
| Package manager | uv | — | Dependencies in `pyproject.toml`, locked in `uv.lock`; use `--frozen` for checks |
| Web framework | fastapi[standard] | 0.115.10 | ASGI, type-driven |
| Server | Uvicorn | — | `app.py` starts the app with reload via `uv run python app.py` |
| Templates | Jinja2 | | Bundled with FastAPI/Starlette |
| CSS | Bootstrap 5 | | CDN link, no npm/build step |
| Data model | `dataclasses.dataclass` | — | `models.py` defines `Complaint` with `agent_name`, `text`, `timestamp`, then `id` and `status` in Phase 4 |
| Storage | In-memory `list` | — | `models.complaints` is module-level; no database |
| Testing | pytest + `TestClient` | pytest 8.3.4 | Tests in `tests/` use `starlette.testclient.TestClient`; run `uv run --frozen python -m pytest tests` without a server |

Run Python through `uv run` so it uses the project virtual environment.
