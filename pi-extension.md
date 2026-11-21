# Local Pi extensions

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
  The skill registry and optional `/skill:...` commands remain available.
- `context_with_system` removes the narrowly recognized synthetic bootstrap
  after upstream injection. User-authored text in the session projection is
  protected, including an exact pasted bootstrap. Other messages and system/tool
  state remain intact. Unknown formats are retained; session lookup errors are
  reported by Pi without filtering the request.

This removes pressure to use skills; it cannot guarantee the model’s choices.
There is no skill-read gate or separate routing classifier.

### Activate or roll back

The repository tracks `.pi/settings.json` alongside the extension so every
checkout receives the same project configuration, using a portable relative path:

```json
{ "extensions": ["../pi-extensions/superpowers-unbootstrap.ts"] }
```

Personal provider/model settings belong in `~/.pi/agent/`. Keep `.pi/` available
for shared project files; ignore individual machine-local files if needed.

Pi must trust the project to load local settings. Start a fresh session after
activation: `/reload` loads the extension but does not erase previously loaded
skill instructions. Remove the entry and reload to roll back. For a one-off
trial, use `pi -e ./pi-extensions/superpowers-unbootstrap.ts`.

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
- **Empty final replies remain unreproduced:** Captured raw oMLX response text
  matched Pi’s provider events and transcript for completed conversation turns.
  No response-text loss was observed in Pi. The search loop does not establish
  the cause of the earlier completed-but-empty replies, which remains unknown.

Reference: [Pi extension events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
