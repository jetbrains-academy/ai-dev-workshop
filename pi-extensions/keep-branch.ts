import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchPrompt, phaseHeadingPattern, projectConfig, type ProjectConfig } from "./project-config.ts";

const DONE = /\b(?:done|complete|completed)\b/i;

const finishOnly = (phase: number) =>
  `The README finish prompt runs the test suite and marks Phase ${phase} done. ` +
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

type Roadmap = { path: string; template: string };

function roadmapOf(config: ProjectConfig): Roadmap | undefined {
  if (config.roadmap && config.phaseHeading) return { path: config.roadmap, template: config.phaseHeading };
}

/** Every phase heading in the roadmap text, by phase number. */
function headings(text: string, template: string): Map<number, string> {
  return new Map([...text.matchAll(phaseHeadingPattern(template))].map((match) => [Number(match[1]), match[0]]));
}

function readRoadmap(cwd: string, roadmap: Roadmap): string | undefined {
  const path = join(cwd, roadmap.path);
  if (existsSync(path)) return readFileSync(path, "utf8");
}

/** Phases whose heading went from not done to done. */
function newlyDone(before: Map<number, string>, after: Map<number, string>): number[] {
  return [...after].filter(([n, heading]) => DONE.test(heading) && before.has(n) && !DONE.test(before.get(n)!))
    .map(([n]) => n);
}

function implementation(cwd: string, pathspecs: string[]): string {
  const paths = pathspecs.length ? execFileSync("git", [
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs,
  ], { cwd, encoding: "utf8" }).split("\0").filter(Boolean) : [];
  const hash = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) {
    const file = join(cwd, path);
    if (!existsSync(file)) continue;
    hash.update(path + "\0").update(createHash("sha256").update(readFileSync(file)).digest());
  }
  return hash.digest("hex");
}

export default function keepBranch(pi: ExtensionAPI) {
  const before = new Map<string, Map<number, string>>();
  let finishing = false;

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    const config = projectConfig(ctx.cwd);
    const roadmap = roadmapOf(config);
    const phase = matchPrompt(config.prompts?.finish, event.text)?.phase;
    if (phase === undefined || !roadmap || !config.testSuite) return;
    if (finishing || event.streamingBehavior || !ctx.isIdle()) {
      ctx.ui.notify(`Wait for the current turn to end before finishing Phase ${phase}.`, "warning");
      return { action: "handled" };
    }

    finishing = true;
    const checks: { command: string; passed: boolean; output: string }[] = [];
    let markedDone = false;
    let summary: string;
    try {
      const revision = implementation(ctx.cwd, config.implementation ?? []);
      let stable = true;
      for (const command of [config.testSuite]) {
        const [program, ...args] = command.split(" ");
        try {
          const result = await pi.exec(program, args, { cwd: ctx.cwd, timeout: 60_000 });
          const passed = result.code === 0 && !result.killed;
          const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
          checks.push({ command, passed, output: output.slice(passed ? -1000 : -8000) });
        } catch (error) {
          checks.push({ command, passed: false, output: String(error) });
        }
        stable = stable && implementation(ctx.cwd, config.implementation ?? []) === revision;
      }

      if (stable && checks.every((check) => check.passed)) {
        const path = join(ctx.cwd, roadmap.path);
        const text = readFileSync(path, "utf8");
        const pattern = phaseHeadingPattern(roadmap.template, phase);
        const heading = text.match(pattern)?.[0];
        if (!heading) throw new Error(`Phase ${phase} heading is missing from ${roadmap.path}.`);
        if (!DONE.test(heading)) writeFileSync(path, text.replace(pattern, () => heading + " (Done)"));
        markedDone = true;
        summary = `Phase ${phase} is marked done in ${roadmap.path}. The current branch was kept as-is.`;
      } else {
        summary = stable
          ? `Phase ${phase} was not marked done because a verification check failed.`
          : `Phase ${phase} was not marked done because implementation files changed during verification.`;
      }
    } catch (error) {
      summary = `Phase ${phase} finish could not complete. ` + (error instanceof Error ? error.message : String(error));
    } finally {
      finishing = false;
    }

    const report = checks.map(({ command, passed, output }) => {
      const result = passed ? output.split("\n").at(-1) : output;
      return `${passed ? "PASS" : "FAIL"} \`${command}\`${result ? "\n" + result : ""}`;
    });
    pi.sendMessage({
      customType: "phase-finish",
      display: true,
      content: [summary, ...report].join("\n\n"),
      details: { markedDone, checks },
    });
    return { action: "handled" };
  });

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "bash" && typeof event.input.command === "string" && changesBranch(event.input.command.trim())) {
      return {
        block: true,
        reason: "Keep the current branch as-is. Leave its commits on this branch and report the verification results.",
      };
    }
    const roadmap = roadmapOf(projectConfig(ctx.cwd));
    if (!roadmap) return;
    const current = readRoadmap(ctx.cwd, roadmap);
    const now = headings(current ?? "", roadmap.template);
    if (event.toolName === "bash") before.set(event.toolCallId, now);

    if (
      (event.toolName === "write" || event.toolName === "edit") &&
      typeof event.input.path === "string" && resolve(ctx.cwd, event.input.path) === join(ctx.cwd, roadmap.path)
    ) {
      const content = event.toolName === "write" ? event.input.content : current ?? "";
      if (typeof content === "string") {
        let next = content;
        if (event.toolName === "edit" && Array.isArray(event.input.edits)) {
          for (const { oldText, newText } of event.input.edits) next = next.replace(oldText, () => newText);
        }
        const marked = newlyDone(now, headings(next, roadmap.template));
        if (marked.length) return { block: true, reason: finishOnly(marked[0]) };
      }
      before.set(event.toolCallId, now);
    }
  });

  pi.on("tool_result", (event, ctx) => {
    if (!before.has(event.toolCallId)) return;
    const previous = before.get(event.toolCallId)!;
    before.delete(event.toolCallId);
    const roadmap = roadmapOf(projectConfig(ctx.cwd));
    const text = roadmap && readRoadmap(ctx.cwd, roadmap);
    if (!roadmap || text === undefined) return;
    // A shell script can mark the roadmap without naming it in the tool input: put the headings back.
    const marked = newlyDone(previous, headings(text, roadmap.template));
    if (!marked.length) return;
    let restored = text;
    for (const n of marked) restored = restored.replace(phaseHeadingPattern(roadmap.template, n), () => previous.get(n)!);
    writeFileSync(join(ctx.cwd, roadmap.path), restored);
    return { isError: true, content: [...event.content, { type: "text" as const, text: finishOnly(marked[0]) }] };
  });
}
