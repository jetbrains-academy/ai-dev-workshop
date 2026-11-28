# Local Pi extensions

Phase 4 uses Superpowers with the automatic bootstrap filter, a filter that
drops old thinking from requests, live-server guard, a shell time limit, the
project's test and Python commands in plans and shell commands, plan approval
guard, branch and finish guard, and a startup check of the model settings.

## Project config

No extension carries text written for this project, its stack or one phase. All of it is in
[`.pi/project.json`](.pi/project.json), read by [`project-config.ts`](pi-extensions/project-config.ts):

- `roadmap` and `phaseHeading` (`"## Phase {n}"`): where phases live and how their headings look.
- `prompts.design`, `plan`, `approve`, `finish`: case-insensitive patterns searched in what you type, after a
  leading `/skill:<name>`. `{n}` captures the phase number; a second `{n}` must name the same phase. The guards
  take the phase from these prompts, so their messages say "Phase 4" for Phase 4 and "Phase 5" for Phase 5.
  `tests/pi/project-config.test.mjs` checks that the README's Phase 4 prompts match.
- `planningSkill`: a project-relative skill file attached to the planning note at the start of the turn.
  The note shows the configured path in a warning if the file is missing or unreadable. The workshop's
  `fastapi-testing` skill was cut on 2026-11-27 to the facts about `tests/conftest.py`, which gives every test a
  `client` that does not follow redirects, a `form_targets(html)` helper and an in-memory data reset. Mellum
  never wrote the fixture or the form parser that the longer guidance described (0 of 11 plans), and a POST test
  that followed the redirect cost one execution about 100 seconds.
- `python`, `pytest`, `testSuite`, `implementation`: the commands the extensions run or write into plans, and the
  files whose change during the finish check stops it.
- `servers` and `inProcessHint`: what counts as starting a server, and what to do instead.
- `shellLimitSeconds`: the shell time limit.
- `model.contextWindow`, `model.thinkingLevel`: what [`project-check.ts`](pi-extensions/project-check.ts) compares
  with Pi's settings at session start and on every model or thinking change. A mismatch shows a warning with the
  fix. In a 2026-11-26 session on another machine, Pi believed the window was larger than LM Studio's 60K, never
  compacted, and lost the conversation when LM Studio dropped context; thinking was off because the model entry
  lacked `"reasoning": true`.

An extension whose key is missing does nothing. Superpowers' own conventions (`docs/superpowers/`, the
executing-plans scripts, `Task N` headings) stay built in. The Flask-to-FastAPI route rewrite was removed: it fixed
a mistake in the model's code for one stack, which the config cannot express without encoding the answer.

## Frozen for the demo (2026-11-26, second freeze)

The extensions are frozen as of commit `f71e606` (project config, no grader in the repo); the only later change is the
roadmap's card bullet, which now names the button for each status. No more extension changes, `AGENTS.md` lines or
headless batches are planned: over 51 graded runs about 1 in 4 broke the demo, each time for a different rare reason,
and batches of 4 to 8 runs cannot show a fix working.

The last check (4 runs at `f71e606`, grader added only after each run): median execution 163 s, 1 CLEAN, 2 FLAWED,
1 BREAK, 12/12 in 1 of 4. All three misses broke the card bullet (links instead of POST forms, lowercase status,
swapped buttons), and Phase 4 was marked done in all four, because the finish check runs only the model's own tests.
Evidence: `../ai-dev-workshop-mellum-evidence/config-n4/`; the grader is kept for scoring in `../grader/` there.

For the live demo:
- Start Phase 4 from the repo's own Phase 3, which every trial used. Phase 4 on an attendee's own Phase 2 and 3 code
  is best-effort.
- Read the saved plan aloud before approving it. If it has no `Task N` headings, send the planning prompt once more.
- After execution, open the board and click Resolve and Reopen yourself. If something is wrong, send one plain review
  note, such as "Resolve must be a POST form, not a link." The human review is the acceptance check.
- Keep a stopwatch on the execution turn. Good runs take 2 to 8 minutes; past 8 minutes, say so and switch to the
  recorded run.
- Rehearse twice interactively with these steps, record both, and keep the cleaner one as the fallback.

Known and accepted:
- plans with no `Task N` heading at all;
- failed-edit loops, often from a backslash that Pi cannot write back into an edit's old text;
- the done signal often ending the turn without a written report;
- runs with no commits, or with design and plan files left uncommitted.

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
It pins Superpowers 7.0.2 as a project package, which Pi installs under
`.pi/git/github.com/obra/superpowers/` for this checkout.
The demo uses Superpowers' `executing-plans` skill to run tasks in the current
Pi session. Saved plans point at that skill.

```json
{
  "packages": [
    "git:github.com/obra/superpowers@22f0b463e7a5e579904dd6211a520321035526f7"
  ],
  "extensions": [
    "../pi-extensions/project-check.ts",
    "../pi-extensions/superpowers-unbootstrap.ts",
    "../pi-extensions/drop-old-thinking.ts",
    "../pi-extensions/no-live-server.ts",
    "../pi-extensions/bash-timeout.ts",
    "../pi-extensions/frozen-python.ts",
    "../pi-extensions/frozen-pytest-plans.ts",
    "../pi-extensions/plan-approval.ts",
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

[`.rgignore`](.rgignore) excludes `.git` from Pi's default recursive `grep`.
After a reset, a search once surfaced reflog entries from a previous Phase 4
run and led Pi to treat those commits as current work. Keep `.git` as the only
entry until a search shows another specific source of noise. `.gitignore`
already covers virtual environments, caches, Superpowers scratch files, and
Pi's package checkout. An explicit glob such as `*` can override the rule.

[`frozen-pytest-plans.ts`](pi-extensions/frozen-pytest-plans.ts) rewrites
commands in Markdown plans saved under `docs/superpowers/plans/`: in shell
fences, after `Run:` or `Command:` labels, and in inline code spans. Bare pytest
becomes `uv run --frozen python -m pytest`, and `python`, `python3` or
`uv run python` becomes `uv run --frozen python`, keeping their arguments. A
server start, as the live-server guard recognises it, becomes
`uv run --frozen python -m pytest tests`, unless the words just before it forbid
it ("Run: `pytest -q`; never `python app.py`"). Single-word code spans in prose and
Python code blocks stay as written.
The save result warns about a `pass`-only test or a fenced Python test snippet that fails to parse. Each warning
names the test and its plan line, and the warnings come first, under "Fix these in the plan with `save_plan`
before asking for approval". In a 2026-11-27 headless run the older warning came after a reread
instruction and gave a snippet line; `read` shows no line numbers, so Mellum looked in the wrong place, decided the
warning was "harmless", and asked for approval. The warnings never block a save.

A last task that only reruns the tests, and maybe commits, is removed from the saved plan: no non-shell code
block, no `Create:` or `Modify:` file, and every command is the project's `pytest` or `git`. The result says
"Removed Task N (…): it only reran the tests, and the finish step runs the test suite." On 2026-11-27, 3 of 7
headless plans ended in such a task ("Verify Phase 1-3 still pass", sometimes with manual steps such as
"Visit /complaints"). No reread and neither repair prompt folded it in, so the save does it.
Until 2026-11-26 a route path written the Flask way, `/<int:id>`, was also rewritten to `{id}` (two runs had
copied such a path into `app.py` and spent 10 and 30 minutes on probes); that rewrite was removed with the move to
the project config. A plan with no `Task N` headings but two or more numbered
ones (`### 1. Update Complaint Model`) gets "Task" added, because
`executing-plans`' `task-start` finds tasks by "Task N": in 3 of 11 runs on
2026-11-25 such a plan cost 200 to 470 seconds or was skipped. It also points the plan header's "REQUIRED SUB-SKILL" at `executing-plans`
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

### Phase approval and finish

[`plan-approval.ts`](pi-extensions/plan-approval.ts) (named `phase4-plan-approval.ts` until 2026-11-26) activates
when you ask Pi to brainstorm or plan a phase, as the config's `design` and `plan` prompts recognise it. Brainstorming exposes read-only tools and
`save_design`, which writes Markdown under `docs/superpowers/specs/`. Pi sees
the workshop's draft-before-approval sequence on skill load and reread. During
planning, Pi gets read-only tools and `save_plan`, which writes Markdown under
`docs/superpowers/plans/` and runs the existing plan checks. The adapted
`writing-plans` skill and the save result ask Pi to give the plan path and a
short summary, then stop for approval. Until 2026-11-27 they asked Pi to reread
the saved plan first; none of 11 rereads revised a plan, and each cost 7 to 23
seconds. Every skill Pi has loaded keeps its adapted text in later stages'
requests: before, the brainstorming skill went back to its 15,530-character
upstream text during planning and execution. The README's repair prompt also matches
the planning prompt; it keeps the plans recorded when planning began, so a plan
saved earlier stays approvable when the repair saves nothing new. A repair turn no
longer gets the date and FastAPI guidance note again: in both 2026-11-27 repair
turns that note came last, and Mellum answered it instead of the request. The
README's repair prompt is a fill-in that names one change, since the canned
"reread against the roadmap" prompt left the plan unchanged or added broken
assertions in 4 of 4 runs. When planning ends with check findings (`pass`-only
tests and test snippets that do not parse) still in the saved plan,
the `agent_before_settle` hook has Pi make one more request with the findings as
its last message. That happens once per planning stage; after that the presenter
gets the findings as a notification. To enable implementation, wait for Pi
to save a new or revised plan and stop,
then send the approval prompt from the [README](README.md#phase-4-pi--mellum--superpowers).
The guard records approval in the Pi session branch and restores the prior tool set.

Its refusals depend on the stage. While brainstorming, it says the turn only
saves the design. While planning with no new plan yet, it names the
`writing-plans` skill's path and asks Pi to save and self-review the plan.
Once saved, a refusal names the plan and directs Pi back to self-review.
Blocking the call leaves the turn open for revisions and a handoff. Only
the user's approval unlocks implementation.

Every refusal opens by naming the call it answers, for example "Blocked just
now: your `bash` call `find . -name "SKILL.md" 2>/dev/null || ls`." In a
2026-11-25 PyCharm run, Mellum read a bare refusal as an odd message from an
earlier interaction and ignored it.

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
the approval text. The guard adapts the model's copy of the skill, including
direct rereads, so its diagram and Finish section end at a report for human
verification. When approval unlocks execution, the guard adds one note to
that turn: the plan's path, its tasks, the exact `task-start` command, and an
instruction to work the tasks in order, commit as each task says, and not move
on until `task-done` records the task. Each `task-start` result ends with that
task's whole `task-done` command: the task number, the base `task-start` just
printed, and the config's `testSuite`. Until 2026-11-27 the note gave
`task-done … N BASE -- … TEST_FILES` to fill in, and 14 of 36 `task-done` calls
in 5 full runs were malformed (run as written in 3 runs, or with the base left
out). Most cost one retry of a few seconds; once, `bad BASE: BASE` was followed
by four 30-second searches of the disk for the scripts. In two full runs with
the change, none of 9 `task-done` calls was malformed: one run ran the given
command as written in 4 of 5 calls, the other kept its number and base and put
its own narrower test after `--`. Superpowers'
`task-done` checks only that the base commit exists and the tests pass: in all
three full runs on 2026-11-27 it recorded tasks with an empty commit range, one
plan had a single commit step for four tasks, and one run reasoned "they were
committed via task-done" and never committed its route. A refusal of `task-done`
while implementation files were uncommitted was tried the same day in two full
runs and removed. It fired once in each, and Mellum committed within seconds,
but it added every listed file, so one commit held two or three tasks' work.
Those runs took 949 and 1150 seconds, against 301 and 357 for the two without
it; with two runs each that may be ordinary variation. The finish check below
still stops a phase from being marked done with implementation files
uncommitted. If several plans
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
tool result confirms both checks and supplies the local reviewer path and
`review-package` command with the commit recorded at approval. Pi reviews the
package and any uncommitted implementation changes, then reports and stops for
human verification. The compaction summary can give Pi the same review paths.

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

When you send the README’s finish prompt, the extension runs
`uv run --frozen python -m pytest tests` itself. If it passes and the implementation stays the same during the
check, Pi marks Phase 4 done in `specs/roadmap.md` and reports the result without starting a model turn. If a check fails, Pi reports the failure and leaves the
roadmap heading as it was. It also leaves the heading alone when the suite passes but implementation files are
uncommitted, and lists them: the suite runs on the working tree, so on 2026-11-27 a run was marked done while the
commit it ended on had a Resolve button posting to a route that only existed uncommitted.

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
