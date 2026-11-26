# Local Pi extensions

Phase 4 uses Superpowers with the automatic bootstrap filter, a filter that
drops old thinking from requests, live-server guard, a shell time limit, frozen
pytest commands in plans and bare `python` in shell commands, plan approval
guard, and branch and finish guard.

## Superpowers skill over-triggering

Ordinary requests can trigger unnecessary Superpowers workflows. Its Pi
extension injects a synthetic user message containing `using-superpowers`,
including the “1% chance” rule. In Superpowers 7.0.0, injection runs during
initial requests and again after compaction, until `agent_end`.

[`superpowers-unbootstrap.ts`](pi-extensions/superpowers-unbootstrap.ts) keeps
automatic selection of task-specific skills, such as debugging and
brainstorming, without a Superpowers fork. It uses two Pi handlers:

- `before_agent_start` hides `using-superpowers` from the automatic skill
  catalog, preventing the model from immediately reloading those instructions.
  It also hides the skills this session cannot use: `subagent-driven-development`
  and `dispatching-parallel-agents` (no subagent tool), `using-git-worktrees`, and
  `finishing-a-development-branch` (the finish prompt is scripted). In the
  2026-11-23 trial Mellum read them anyway, about 5,000 tokens per run.
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

`writing-plans`' Execution Handoff may still offer or recommend
Subagent-driven execution. That only changes the reply's wording: the README's
approval prompt starts with `/skill:executing-plans` and asks for native
execution, and the plan rewrite in `frozen-pytest-plans.ts` points the plan
header at `executing-plans`. A line appended to the skill's read result, asking
Pi to offer only Native execution, was removed on 2026-11-25: 3 of 8 runs
offered Subagent-driven anyway, and the choice never changed what ran.

### Activate or roll back

The project configuration in `.pi/settings.json` uses portable relative paths.
The package filter disables a globally installed `pi-subagents` for this
checkout, so the demo offers no subagent tool. The trials ran without one, and
saved plans point at `executing-plans`.

```json
{
  "packages": [
    {
      "source": "https://github.com/nicobailon/pi-subagents",
      "autoload": false,
      "extensions": ["!**"],
      "skills": ["!**"],
      "prompts": ["!**"]
    }
  ],
  "extensions": [
    "../pi-extensions/superpowers-unbootstrap.ts",
    "../pi-extensions/drop-old-thinking.ts",
    "../pi-extensions/no-live-server.ts",
    "../pi-extensions/bash-timeout.ts",
    "../pi-extensions/frozen-python.ts",
    "../pi-extensions/frozen-pytest-plans.ts",
    "../pi-extensions/phase4-plan-approval.ts",
    "../pi-extensions/keep-branch.ts"
  ],
  "defaultTools": ["+find", "+grep"],
  "compaction": { "keepRecentTokens": 8000 }
}
```

Personal provider/model settings belong in `~/.pi/agent/`. Keep `.pi/` available
for shared project files; ignore individual machine-local files if needed.

Pi must trust the project to load local settings. Start a fresh session after
changing extensions so it starts with the current skill instructions. To restore
the automatic Superpowers bootstrap, remove its filter from `.pi/settings.json`.

`compaction.keepRecentTokens` keeps 8,000 recent tokens after a compaction
instead of Pi's default 20,000, merging with the user's own compaction settings.
In a 6-versus-6 Phase 4 trial on 2026-11-23 it cut median execution from 580 s
to 229 s (compactions 15 to 6, with fewer re-reads and failed edits) and failed
one run in each arm.

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
Plan steps that would create, modify or `git add` the grader,
`tests/phase4_acceptance.py`, are pointed at `tests/test_phase4.py`, and so are
task and step headings that ask to create, update, write or add to the grader by
its bare name ("Step 1: Create phase4_acceptance.py test file"); steps that only
run the grader keep it. A plan with no `Task N` headings but two or more numbered
ones (`### 1. Update Complaint Model`) gets "Task" added, because
`executing-plans`' `task-start` finds tasks by "Task N": in 3 of 11 runs on
2026-11-25 such a plan cost 200 to 470 seconds or was skipped. In 6 of 20 plans saved on 2026-11-25 such a heading
survived, and in one run Pi took the grader as its own deliverable and tried to
edit it instead of fixing its code. It also points the plan header's "REQUIRED SUB-SKILL" at `executing-plans`
alone, because the `subagent-driven-development` skill it recommends is about
7,000 tokens and this session has no subagent tool. The tool result reports each
correction. In 7 of 17 saved plans Mellum wrote a
server step or a bare `python` command, and in 3 of those it started that server
during execution.

A FastAPI note appended to the Superpowers plan skills was trialled on
2026-11-23 (8 Phase 4 runs with it, 8 without) and removed: both 404 checks
passed in 8 runs against 7, and runs were about 25% slower. The project skill
`.pi/skills/fastapi/SKILL.md`, which `AGENTS.md` told Pi to read after approval,
was removed on 2026-11-25 for the same reason: Pi read it in 15 of 27 headless
runs, about 700 tokens each time, and those runs drew GET links or a broken
route no less often than the 12 that did not.

### Phase 4 approval and finish

[`phase4-plan-approval.ts`](pi-extensions/phase4-plan-approval.ts) activates
when you ask Pi to brainstorm or plan Phase 4. Before approval, Pi can inspect
the repo and write design or plan Markdown under `docs/superpowers/`. To
enable implementation, wait for Pi to save a new or revised plan and stop,
then send the approval prompt from the [README](README.md#phase-4-pi--mellum--superpowers).
The guard records approval in the Pi session branch.

Its refusals depend on the stage. While brainstorming, it says the turn only
saves the design. While planning with no new plan yet, it names the
`writing-plans` skill's path and says to save the plan and end the turn. Both
say that only the user's approval unlocks code, because looping models tried
to unlock the guard by editing design files. Once a new plan is saved, a
refused call also sets `terminate`, so Pi ends the turn instead of letting the
model keep trying. In the 2026-11-23 trial, two of 16 planning turns looped
against the old refusal (42 and 75 refusals), and one hit the 20-minute limit.

Every refusal opens by naming the call it answers, for example "Blocked just
now: your `bash` call `find . -name "SKILL.md" 2>/dev/null || ls`." In a
2026-11-25 PyCharm run, Mellum read a bare refusal as an odd message from an
earlier interaction and ignored it. A refused shell command also lists the
read-only forms that are allowed: `ls`, `pwd`, `git status`, `date`, and plain
`find` with relative paths, without pipes, `||`, `;`, `&`, redirection or `$(`.

Superpowers names specs and plans `YYYY-MM-DD-<name>.md`, but Pi's prompt has
no date, so Mellum guessed: on 2026-11-25 it wrote `phase-4-design.md` and
`2026-11-10-phase-4-design.md`. The first turn of the brainstorming and
planning stages now carries today's date, with only that stage's folder: the
design file while brainstorming, the plan file while planning. A first version
named both folders while brainstorming, and in 4 of 4 headless runs Pi then
wrote a plan as well; that plan predated the planning prompt, so the approval
stayed locked in 3 of them. With the note, every spec and plan in 27 headless
runs carried today's date, so a backstop that renamed misnamed files never
fired and was removed.

The README's approval prompt starts with `/skill:executing-plans`, so the skill
is part of the execution prompt; the guard strips that prefix before matching
the approval text. When approval unlocks execution, the guard adds one note to
that turn: the plan's path, its tasks, the exact `task-start` and `task-done`
commands, and an instruction to work the tasks in order, commit as each task
says, and not move on until `task-done` records the task. If several plans
were saved while planning, the note names the newest. On 2026-11-25, one run
never opened its plan during execution and skipped every commit step, and
another passed `task-done` its test command as one quoted string.

During execution the guard follows `executing-plans`' own scripts. A
`task-start` that prints a brief and a base marks that task started, and a
`task-done` that prints its `ledger:` line marks it recorded. The guard keeps
this in the session, because the skill deletes its ledger after the final
review. After each compaction it sends the note again. During a run it goes
in as a steering message, so it reaches the next model call. After a run has
ended it waits for the next prompt; the guard never starts a turn itself. The
resent note says which tasks are recorded, and either which task to continue
(with its brief and base, without another `task-start`) or which task to start
next. It also lists the commits made since approval: for a task whose work is
already committed, Pi runs `task-start`, checks the brief's steps against the
commit, does any step that is missing, and then runs `task-done`. An earlier
wording, "record it rather than redoing it", let runs record tasks they never
worked. The note also says to run the scripts from the project folder exactly
as written, without `cd`: run from the Superpowers folder, `task-start`'s
workspace script cannot create its folder under the sandbox and loops forever. Ledger lines that were already
there at approval, for example from a rehearsal earlier the same day, do not
count. Task headings may use any level (`##`, `###`), and a plan file without
task headings is passed over when another new plan has them. No note is sent
before approval, after the finish prompt, or once every task is recorded. In the
2026-11-25 PyCharm run, a compaction summary said Pi was still waiting to
choose an execution approach. Pi then skipped the plan's last four tasks and
coded against the grader.

Headless checks on 2026-11-25 ran the README prompts at this setup 12 times (4,
then 8). Pi loaded `executing-plans` in all 12, recorded every task in 10, and
scored 12/12 with the grader unchanged in 11. Recorded is not the same as
worked: only 6 of the 12 ran `task-start` and then `task-done` for every task in
order, and one recorded three tasks in 13 seconds without editing anything.
Most runs that scored 12/12 had read the grader and fixed their code against it.
Following the plan costs time: median execution was 543 s, where one earlier
run that skipped the plan finished in about 90 s, and 3 of the 8 took over 15
minutes. The biggest losses came after approval, when the shell is open:
`find /` or `find /Users` for the scripts or a missing test file took 2 to 7
minutes each, in 2 of the 8 runs. The note gives the scripts' full path, but it
is outside the project, and in one run Pi's reasoning said it needed them in the
project instead. The shell time limit below now stops such searches. Others went on Pi's own new
tests, which the grader guard does not cover, and on compactions of about a
minute each. In the run that scored 8/12, Pi put the routes under `/reports/`,
its own tests used the same paths, and every `task-done` passed.

Three more parts of the guard act only during execution. When Pi compacts, the
guard writes the summary itself from what it tracks (the plan, its tasks and
progress, uncommitted changes, files read and changed), so a compaction makes no
model call; Mellum's summaries took a median 64 seconds, mostly thinking, and
two hit the output cap after about three minutes. Planning-stage tool results
longer than 200 characters, mostly skill text, are replaced by a short stub in
each request; the call and its result keep their place. And when `task-done`
records the plan's last task, the guard runs the full suite; if it passes, the
next tool call other than `git` is refused with a request to commit anything
left and write the final report, and a second such call ends the turn, so Pi
reports instead of polishing (four runs spent 135 to 322 seconds after that
point). Ending the turn on the first refusal left it without a report in 5 of
6 runs.

The tracking has known gaps. A shell command that chains `task-done` and
`task-start` records only the first. Pi sometimes skips `task-start` or passes
the wrong base, and the approval note can arrive twice.

[`keep-branch.ts`](pi-extensions/keep-branch.ts) blocks direct Git merge, pull,
push, branch switch, and branch deletion commands through Pi’s `bash` tool.
Pi can still inspect Git status and create commits on its current branch.
The guard refuses any model change that marks Phase 4 done: a `write` or
`edit` is blocked, and a shell command that changes the heading is rolled back.
Either way the response says the finish prompt does it. Read-only commands that
mention `roadmap.md` are not checked. An earlier version let the model mark the
phase done after both exact checks passed; in one run it refused seven attempts
over three minutes because the model had run the grader with `-v` added.

The guard also keeps the grader, `tests/phase4_acceptance.py`, as shipped: a
`write` or `edit` to it is refused, and a shell command that changes it is
rolled back. The refusal sends the model to a new file, `tests/test_phase4.py`,
for its own tests. In the 2026-11-23 trials models weakened the grader in 3 of 28
runs, and the finish prompt marked two of them done; in a later run a plan step
to "update" the grader led to 12 refusals over about four minutes. The extension pins the
grader's SHA-256; `tests/pi/grader-pin.test.mjs` fails if the file changes
without the pin.

When you send the README’s finish prompt, the extension first checks the
grader against that pin and refuses to finish if it differs. Then it runs both
commands itself. If both pass and the implementation stays the same during the checks,
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

## Bare python in shell commands

The sandboxed shell has no bare `python`, and `python3` is the system one
without the project's packages: in 27 headless runs `python: command not found`
came up 15 times, and one run went on to `pip install fastapi`.
[`frozen-python.ts`](pi-extensions/frozen-python.ts) rewrites a shell segment
whose command word is `python`, `python3` or `python3.N` to
`uv run --frozen python` before it runs. Commands that already name an
interpreter (`uv run python`, `.venv/bin/python`) or only mention python are
left alone.

## Old thinking

Mellum's chat template keeps an assistant message's reasoning only after the
latest user message, the way Qwen3's does, so in a chat earlier thinking falls
away with each new question. Executing a plan is one user prompt followed by 50
to 150 tool calls, and Pi sends every step's thinking back as
`reasoning_content`, so all of it stayed in the prompt. In 20 headless Phase 4
runs on 2026-11-25 it was 47% of what filled the context during execution,
which grew by about 62,000 tokens per run and compacted about twice, at about
65 seconds a compaction.

[`drop-old-thinking.ts`](pi-extensions/drop-old-thinking.ts) uses the `context`
event to remove thinking from every assistant message but the latest, in the
request only; the session keeps all of it. A reply that was nothing but
thinking keeps it, so no message becomes empty. Replayed over the 4 runs of the
search-scope check, it would have cut context growth by 28 to 45% and
compactions from 3 to 1 in three runs, saving about 2 to 2.7 minutes each. It
has not been tried with Mellum yet.

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
(bare `uvicorn`, `python3 app.py`, `uv run python app.py`).

## A time limit for shell commands

Pi's `bash` tool has no default timeout, so a command that never returns holds
the turn until it ends. [`bash-timeout.ts`](pi-extensions/bash-timeout.ts) uses
`tool_call` to give every `bash` call 30 seconds at most, keeping a shorter
limit the model chose. When a command times out, the result adds a hint: search
inside the project; the task scripts are installed outside it on purpose, so
run them from the plan note's path as written; a file the plan names that is not
in the project does not exist yet, so create it; and check the app through its
tests rather than a server. Those last points answer the beliefs behind both
slow searches: one run distrusted the scripts' path because it is outside the
project, and the other looked for a test file its plan named but never created.
Pi kills the command's whole process group, so pipes and child processes stop
too; a command started with `nohup … &` returns at once and keeps running.

A 60-second version was removed on 2026-11-23 because it never fired once the
live-server guard was in place. It came back after the headless checks of
2026-11-25: in 16 runs, 99% of shell commands took about a second and the
slowest ordinary one (`task-done`) 1.2 seconds, while three searches of the
whole disk took 2 to 7 minutes each. A limit bounds any spelling of such a
search, where a block would catch only the ones anticipated. In the first 4
runs with the limit no search left the project, so it never fired, and how
Mellum reacts to the hint has not been tried yet.

Reference: [Pi extension events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
