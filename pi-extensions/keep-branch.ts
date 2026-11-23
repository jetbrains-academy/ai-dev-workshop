import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ROADMAP = "specs/roadmap.md";
const PHASE_4 = /^## Phase 4\b[^\r\n]*/m;
const DONE = /\b(?:done|complete|completed)\b/i;
const FINISH_PROMPT = "Use Superpowers to finish Phase 4. Keep the current branch as-is and mark Phase 4 done in specs/roadmap.md.";
const CHECKS = [
  "uv run --frozen python -m pytest tests",
  "uv run --frozen python -m pytest -v --tb=line --disable-warnings tests/phase4_acceptance.py",
];
// The grader as shipped. Models weakened it in 3 of 28 trial runs, and the finish prompt then
// marked two of them done. grader-pin.test.mjs fails if the file changes without this hash.
export const GRADER = "tests/phase4_acceptance.py";
export const GRADER_SHA256 = "9dc24d589af769b88c23b6529d8f207af664afdbe3d58521a4823e670ee791ac";
const GRADER_LOCKED =
  `${GRADER} is the Phase 4 grader and stays unchanged. ` +
  "Put your own Phase 4 tests in a new file, tests/test_phase4.py, and fix the implementation, not the grader.";
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
function graderBytes(cwd: string): Buffer | undefined {
  const path = join(cwd, GRADER);
  if (existsSync(path)) return readFileSync(path);
}

const FINISH_ONLY =
  "The README finish prompt runs both checks and marks Phase 4 done. " +
  "Leave the roadmap heading as it is and report your results.";

const INTEGRATION_COMMANDS = new Set(["merge", "pull", "push", "switch"]);
const COMMAND_PREFIXES = new Set(["command", "env", "exec", "if", "then", "else", "do", "!"]);
const GIT_OPTION_VALUES = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);

function changesBranch(command: string): boolean {
  // Keep quoted shell words together and hide quoted shell syntax from the segment scan.
  const bare = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (quoted) => {
    const word = quoted.slice(1, -1);
    return /^[\w./-]+$/.test(word) ? word : "quoted";
  });

  for (const segment of bare.split(/[;&|()\n]/)) {
    const words = segment.trim().split(/\s+/);
    const commandIndex = words.findIndex((word) => !COMMAND_PREFIXES.has(word) && !/^\w+=/.test(word));
    if (words[commandIndex]?.split("/").at(-1) !== "git") continue;

    let verbIndex = commandIndex + 1;
    while (words[verbIndex]?.startsWith("-")) {
      verbIndex += GIT_OPTION_VALUES.has(words[verbIndex]) ? 2 : 1;
    }
    const verb = words[verbIndex];
    if (INTEGRATION_COMMANDS.has(verb)) return true;

    const args = words.slice(verbIndex + 1);
    if (verb === "checkout" && !args.includes("--")) return true;
    if (verb === "branch" && args.some((arg) => arg === "--delete" || /^-[^-]*[dD]/.test(arg))) return true;
  }
  return false;
}

function phaseHeading(cwd: string): string | undefined {
  const path = join(cwd, ROADMAP);
  if (existsSync(path)) return readFileSync(path, "utf8").match(PHASE_4)?.[0];
}

function implementation(cwd: string): string {
  const paths = execFileSync("git", [
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
    "*.py", "templates", "pyproject.toml", "uv.lock",
  ], { cwd, encoding: "utf8" }).split("\0").filter(Boolean);
  const hash = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) {
    const file = join(cwd, path);
    if (!existsSync(file)) continue;
    hash.update(path + "\0").update(createHash("sha256").update(readFileSync(file)).digest());
  }
  return hash.digest("hex");
}

export default function keepBranch(pi: ExtensionAPI) {
  const before = new Map<string, string | undefined>();
  let finishing = false;
  let shipped: Buffer | undefined;

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" || event.text.trim() !== FINISH_PROMPT) return;
    if (finishing || event.streamingBehavior || !ctx.isIdle()) {
      ctx.ui.notify("Wait for the current turn to end before finishing Phase 4.", "warning");
      return { action: "handled" };
    }

    finishing = true;
    const checks: { command: string; passed: boolean; output: string }[] = [];
    let markedDone = false;
    let summary: string;
    try {
      const grader = graderBytes(ctx.cwd);
      if (!grader || sha256(grader) !== GRADER_SHA256) {
        throw new Error(`${GRADER} differs from the workshop's grader. ` +
          `Restore it with \`git checkout -- ${GRADER}\` and send the finish prompt again.`);
      }
      const revision = implementation(ctx.cwd);
      let stable = true;
      for (const command of CHECKS) {
        const [program, ...args] = command.split(" ");
        try {
          const result = await pi.exec(program, args, { cwd: ctx.cwd, timeout: 60_000 });
          const passed = result.code === 0 && !result.killed;
          const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
          checks.push({ command, passed, output: output.slice(passed ? -1000 : -8000) });
        } catch (error) {
          checks.push({ command, passed: false, output: String(error) });
        }
        stable = stable && implementation(ctx.cwd) === revision;
      }

      if (stable && checks.every((check) => check.passed)) {
        const path = join(ctx.cwd, ROADMAP);
        const roadmap = readFileSync(path, "utf8");
        const heading = roadmap.match(PHASE_4)?.[0];
        if (!heading) throw new Error("Phase 4 heading is missing from specs/roadmap.md.");
        if (!DONE.test(heading)) writeFileSync(path, roadmap.replace(PHASE_4, () => heading + " (Done)"));
        markedDone = true;
        summary = "Phase 4 is marked done in specs/roadmap.md. The current branch was kept as-is.";
      } else {
        summary = stable
          ? "Phase 4 was not marked done because a verification check failed."
          : "Phase 4 was not marked done because implementation files changed during verification.";
      }
    } catch (error) {
      summary = "Phase 4 finish could not complete. " + (error instanceof Error ? error.message : String(error));
    } finally {
      finishing = false;
    }

    const report = checks.map(({ command, passed, output }) => {
      const result = passed ? output.split("\n").at(-1) : output;
      return `${passed ? "PASS" : "FAIL"} \`${command}\`${result ? "\n" + result : ""}`;
    });
    pi.sendMessage({
      customType: "workshop-phase4-finish",
      display: true,
      content: [summary, ...report].join("\n\n"),
      details: { markedDone, checks },
    });
    return { action: "handled" };
  });

  pi.on("tool_call", (event, ctx) => {
    if (!shipped) {
      const grader = graderBytes(ctx.cwd);
      if (grader && sha256(grader) === GRADER_SHA256) shipped = grader;
    }
    if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input.path === "string" &&
        resolve(ctx.cwd, event.input.path) === join(ctx.cwd, GRADER)) {
      return { block: true, reason: GRADER_LOCKED };
    }
    const heading = phaseHeading(ctx.cwd);
    const pending = heading && !DONE.test(heading);
    if (event.toolName === "bash" && typeof event.input.command === "string") {
      if (changesBranch(event.input.command.trim())) return {
        block: true,
        reason: "Keep the current branch as-is for the workshop. Leave its commits on this branch and report the verification results.",
      };
      before.set(event.toolCallId, heading);
    }

    if (
      (event.toolName === "write" || event.toolName === "edit") &&
      typeof event.input.path === "string" && resolve(ctx.cwd, event.input.path) === join(ctx.cwd, ROADMAP)
    ) {
      if (pending) {
        let next = event.toolName === "write" ? event.input.content : readFileSync(join(ctx.cwd, ROADMAP), "utf8");
        if (event.toolName === "edit" && Array.isArray(event.input.edits)) {
          for (const { oldText, newText } of event.input.edits) next = next.replace(oldText, () => newText);
        }
        const nextHeading = typeof next === "string" ? next.match(PHASE_4)?.[0] : undefined;
        if (nextHeading && DONE.test(nextHeading)) return { block: true, reason: FINISH_ONLY };
      }
      before.set(event.toolCallId, heading);
    }
  });

  pi.on("tool_result", (event, ctx) => {
    if (!before.has(event.toolCallId)) return;
    const previous = before.get(event.toolCallId);
    before.delete(event.toolCallId);

    const notes: string[] = [];
    // A shell script can mark the roadmap without naming it in the tool input.
    if (previous && !DONE.test(previous) && DONE.test(phaseHeading(ctx.cwd) ?? "")) {
      const path = join(ctx.cwd, ROADMAP);
      writeFileSync(path, readFileSync(path, "utf8").replace(PHASE_4, () => previous));
      notes.push(FINISH_ONLY);
    }
    // ...or change the grader: put the shipped copy back.
    const grader = graderBytes(ctx.cwd);
    if (shipped && (!grader || sha256(grader) !== GRADER_SHA256)) {
      writeFileSync(join(ctx.cwd, GRADER), shipped);
      notes.push(`Restored ${GRADER}. ${GRADER_LOCKED}`);
    }
    if (notes.length) {
      return { isError: true, content: [...event.content, ...notes.map((text) => ({ type: "text" as const, text }))] };
    }
  });
}
