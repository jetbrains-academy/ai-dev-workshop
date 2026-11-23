# Local Pi extensions

Phase 4 uses Superpowers with the automatic bootstrap filter, live-server
guard, frozen pytest commands in plans, a FastAPI note on the plan skills, plan
approval guard, and branch and finish guard.

## Superpowers skill over-triggering

Ordinary requests can trigger unnecessary Superpowers workflows. Its Pi
extension injects a synthetic user message containing `using-superpowers`,
including the “1% chance” rule. In Superpowers 7.0.0, injection runs during
initial requests and again after compaction, until `agent_end`.

[`superpowers-unbootstrap.ts`](pi-extensions/superpowers-unbootstrap.ts) keeps
automatic selection of task-specific skills, such as debugging and
brainstorming, without a Superpowers fork. It uses two Pi handlers:

- `before_agent_start` hides only `using-superpowers` from the automatic skill
  catalog, preventing the model from immediately reloading those instructions.
  The skill registry and optional `/skill:...` commands remain available. It
  also adds one prompt guideline in place of the bootstrap's “Pi tool mapping”
  note: read a skill's `SKILL.md`, use the listed tools, and do a plan's tasks
  in the session when no subagent tool is listed.
- `context_with_system` removes the narrowly recognized synthetic bootstrap
  after upstream injection. User-authored text in the session projection is
  protected, including an exact pasted bootstrap. Other messages and system/tool
  state remain intact. Unknown formats are retained; session lookup errors are
  reported by Pi without filtering the request.

This removes pressure to use skills; it cannot guarantee the model’s choices.
There is no skill-read gate or separate routing classifier.

### Activate or roll back

The project configuration in `.pi/settings.json` uses portable relative paths.

```json
{
  "extensions": [
    "../pi-extensions/superpowers-unbootstrap.ts",
    "../pi-extensions/no-live-server.ts",
    "../pi-extensions/frozen-pytest-plans.ts",
    "../pi-extensions/fastapi-plan-note.ts",
    "../pi-extensions/phase4-plan-approval.ts",
    "../pi-extensions/keep-branch.ts"
  ],
  "defaultTools": ["+find", "+grep"]
}
```

Personal provider/model settings belong in `~/.pi/agent/`. Keep `.pi/` available
for shared project files; ignore individual machine-local files if needed.

Pi must trust the project to load local settings. Start a fresh session after
changing extensions so it starts with the current skill instructions. To restore
the automatic Superpowers bootstrap, remove its filter from `.pi/settings.json`.

`defaultTools` enables Pi's built-in `find` and `grep` tools, which honour
`.gitignore` and so cannot walk `.venv`. In one rehearsal a shell `find .` walked
`.venv`, returned about 21,000 tokens and forced a compaction.

[`frozen-pytest-plans.ts`](pi-extensions/frozen-pytest-plans.ts) rewrites
commands in Markdown plans saved under `docs/superpowers/plans/`: in shell
fences, after `Run:` or `Command:` labels, and in inline code spans. Bare pytest
becomes `uv run --frozen python -m pytest`, and `python`, `python3` or
`uv run python` becomes `uv run --frozen python`, keeping their arguments. A
server start, as the live-server guard recognises it, becomes
`uv run --frozen python -m pytest tests`, unless the words just before it forbid
it ("Run: `pytest -q`; never `python app.py`"). Single-word code spans in prose and
Python code blocks stay as written.
The tool result reports each correction. In 7 of 17 saved plans Mellum wrote a
server step or a bare `python` command, and in 3 of those it started that server
during execution.

[`fastapi-plan-note.ts`](pi-extensions/fastapi-plan-note.ts) appends a short
FastAPI note (about 230 tokens) to the tool result whenever the model reads the
Superpowers `writing-plans` or `executing-plans` skill: typed `{id}` routes,
303 and 404, POST forms, `follow_redirects=False`, pairing each unknown-id test
with a successful request, fixtures that restore shared state, and checking in
process. The project's FastAPI skill was read in about half the runs, with no
measurable effect. The note is on trial: 8 runs with it against 8 without decide
whether it stays.

### Phase 4 approval and finish

[`phase4-plan-approval.ts`](pi-extensions/phase4-plan-approval.ts) activates
when you ask Pi to brainstorm or plan Phase 4. Before approval, Pi can inspect
the repo and write design or plan Markdown under `docs/superpowers/`. To
enable implementation, wait for Pi to save a new or revised plan and stop,
then send the approval prompt from the [README](README.md#phase-4-pi--mellum--superpowers).
The guard records approval in the Pi session branch.

[`keep-branch.ts`](pi-extensions/keep-branch.ts) blocks direct Git merge, pull,
push, branch switch, and branch deletion commands through Pi’s `bash` tool.
Pi can still inspect Git status and create commits on its current branch.
The guard refuses any model change that marks Phase 4 done: a `write` or
`edit` is blocked, and a shell command that changes the heading is rolled back.
Either way the response says the finish prompt does it. Read-only commands that
mention `roadmap.md` are not checked. An earlier version let the model mark the
phase done after both exact checks passed; in one run it refused seven attempts
over three minutes because the model had run the grader with `-v` added.

When you send the README’s finish prompt, the extension runs both commands
itself. If both pass and the implementation stays the same during the checks,
Pi marks Phase 4 done in `specs/roadmap.md` and reports the results without
starting a model turn. If a check fails, Pi reports the failure and leaves the
roadmap heading as it was.

### Verification

Tested with Pi 1.4.0, Superpowers 7.0.0, and Node 25.8.1. Tests use Node’s native
TypeScript support and test runner; no npm project or extra dependencies:

```sh
node --test tests/pi/superpowers-unbootstrap.test.mjs
export PI_PACKAGE_DIR="$HOME/.local/lib/node_modules/@earendil-works/pi-coding-agent"
export SUPERPOWERS_DIR="$HOME/.pi/agent/git/github.com/obra/superpowers"
node --test tests/pi/*.test.mjs
```

Adjust the package paths for your installation. The integration tests load the
actual Pi runner and Superpowers injector, test both extension orders and
compaction, and verify message preservation without provider calls. Rerun after
upgrading either package.

Live smoke comparison on 2026-11-20 used fresh, isolated sessions with
`--provider omlx --model Mellum2.1-12B-A2.5B-Thinking-6bit` and read/search tools:

| Request | Superpowers alone | With this extension |
| --- | --- | --- |
| Arithmetic, inline function, repository fact | Process skills read in 3/3 runs | No skills read in 3/3 runs |
| Debugging scenario | Loaded `systematic-debugging`; timed out at 150s | Automatically loaded `systematic-debugging`; empty final text |
| Feature design | Loaded `brainstorming`; asked a relevant question | Missed the skill; empty final text |

The filtered arithmetic and repository answers were correct; the inline-code
answer was empty. Optional `/skill:systematic-debugging` expansion was preserved,
but that run also ended empty. Payload checks confirmed removal of the bootstrap
and its catalog entry while debugging/brainstorming stayed advertised. Marker
text legitimately read from source files remains in tool results.

These single trials demonstrate reduced over-triggering, with mixed automatic
selection and answer quality. They do not establish reliable workflow completion.
To repeat, use `--no-extensions -e "$SUPERPOWERS_DIR/.pi/extensions/superpowers.ts"`
for the baseline; add `-e ./pi-extensions/superpowers-unbootstrap.ts` for the
filtered run. Disable context files and unrelated skills/extensions in both arms
and explicitly load the Superpowers skills to keep the comparison controlled.

### Empty-reply follow-up (2026-11-21)

- **Repository-search loop:** The debugging scenario described an endpoint absent
  from this repository. Mellum kept searching and hit the 150-second limit both
  with the catalog/filter (39 tool calls) and without Superpowers (81). These
  were unfinished investigations, not completed empty replies.
- **Self-contained debugging:** Including the code, failing assertion, and a
  no-project-search instruction produced nonempty answers in all six trials:
  three with the catalog/filter and three without Superpowers. Each took
  6–10 seconds with no tool calls. All six proposed fixes passed five functional
  checks each.
- **Empty final replies were not reproduced under oMLX:** Captured raw oMLX
  response text matched Pi’s provider events and transcript for completed
  conversation turns. No response-text loss was observed in Pi. The LM Studio
  diagnosis below gives a cause for blank replies there; the oMLX runs were not
  re-examined.

### Tool-calling diagnosis under LM Studio (2026-11-21)

Later the same day the model was served from LM Studio instead of oMLX and its
raw input and output were logged for every request.

- **This extension is not the cause** of failed tool calls or blank replies.
- **The failures are single-token sampling slips** that LM Studio does not
  repair: an unclosed `<think>` (surfaces as blank content), a tool call emitted
  inside thinking, end-of-sequence mid-sentence, and a broken `"name"` key in the
  tool-call JSON (dropped with no call).
- **Rates:** at temperature 1, about 5 in 348 responses and 10 in 291 tool-call
  bodies; at 0.6, 0 in 119 and 0 in 111. Slips appeared at 1% to 61% context
  fill, so fill does not predict them.
- **Planning is the weak stage; execution is strong.** Six fresh “implement from
  a reviewed plan” trials passed 8/8 acceptance checks.
- **Full Phase 4 rehearsal** with the README prompts passed at a 56,000-token
  context: 95 responses, no blank replies, three threshold compactions, 8/8
  acceptance after one human review note (controls were GET links; they must be
  POST forms).
- **Settings:** temperature stays 1; 0.6 is a fallback if JSON errors appear.
  Context length is 60,000, so Pi compacts near 43,600 tokens.

## No live server

In the fourth Phase 4 rehearsal one of Mellum's own tests expected a 303 and saw
200, because `TestClient` follows redirects unless told otherwise. Instead of
fixing the test it started the app to look, in four spellings, and each
foreground start held the turn until it was killed by hand. In the sixth it ran
`uv run uvicorn app:app --port 8000 & echo $!` and then
`curl -X POST http://localhost:8000/complaints/2/resolve`, and the server kept
port 8000 after the turn ended. The `AGENTS.md` rule against starting a server
was in the prompt both times.

[`no-live-server.ts`](pi-extensions/no-live-server.ts) uses `tool_call` to block
a `bash` call that starts the app as a server, in the foreground or the
background, or that sends a request to a loopback address. The refusal tells
the model to call the route with `TestClient` and `follow_redirects=False`,
which is what it was missing when it reached for a server. It is adapted from
the live-server guard in mellum-worker.

The guard reads the command word of each shell segment (after `&&`, `;`, `|`,
`&`, wrappers such as `nohup` and `uv run`, and any directory prefix), so
`.venv/bin/uvicorn app:app` and `echo hi && python app.py` are starts, while
`pip show uvicorn`, `python -c "import uvicorn"` and `git add app.py` are not.
Replayed over the 332 shell commands recorded in the rehearsals it blocks the
five server starts and the one `curl`, and nothing else.

It recognises commands by their spelling, so a new spelling can get past it. In
the runs of 2026-11-22 and 2026-11-23 it blocked all 8 attempts to start the app
(bare `uvicorn`, `python3 app.py`, `uv run python app.py`). A 60-second shell
time limit added before it never fired once the guard was in place and has been
removed.

Reference: [Pi extension events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
