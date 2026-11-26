## Working in this repo
- Run pytest through `uv run --frozen python -m pytest`. Check HTTP behavior in process with `TestClient(app)` and pass `follow_redirects=False` to see a 303. Never run `uvicorn` or `python app.py`.
- Before finishing a phase or marking it done, run the project test suite and any additional checks listed for that phase in [the roadmap](specs/roadmap.md). Fix failures, rerun the checks, and report the results.
- Save designs under `docs/superpowers/specs/` and plans under `docs/superpowers/plans/`.
- In an implementation plan, give each Acceptance bullet of the phase in the roadmap its own test.
- A person reads every reply. When a skill says to ask a question, ask it and stop.
