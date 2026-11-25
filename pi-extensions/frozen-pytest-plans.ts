import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { liveServerUse } from "./no-live-server.ts";

const PLANS = "docs/superpowers/plans";
const FROZEN = "uv run --frozen python -m pytest";
export const FROZEN_PYTHON = "uv run --frozen python";
export const TEST_SUITE = FROZEN + " tests";
const PYTEST = /^(?:uv[ \t]+run[ \t]+)?(?:python(?:3(?:\.\d+)?)?[ \t]+-m[ \t]+)?pytest(?=$|[ \t])/;
const PYTHON = /^(?:uv[ \t]+run[ \t]+)?python(?:3(?:\.\d+)?)?(?=$|[ \t])/;
const SHELL_FENCE = /^(?:bash|sh|shell|zsh|console)?$/i;
// A plan line that forbids a command keeps it: "Never run `python app.py`".
const PROHIBITION = /\b(?:never|not|don't|avoid|instead of|without)\b/i;

export interface FrozenPlan {
  markdown: string;
  serverStarts: number;
}

const GRADER = "tests/phase4_acceptance.py";
const OWN_TESTS = "tests/test_phase4.py";

const GRADER_NAME = "phase4_acceptance.py";
const OWN_NAME = "test_phase4.py";
// A task or step heading that asks to change the grader by its bare name. In a 2026-11-25 run
// "Step 1: Create phase4_acceptance.py test file" survived the Files-line rewrite, and Pi took
// the grader as its own deliverable and tried to edit it.
const HEADING_CHANGE = /^\s*(?:#{1,6}\s|[-*+]\s+(?:\[[ xX]\]\s+)?\*\*)[^\n]*\b(?:create|update|modify|write|edit|extend|change|add)\b/i;

/** Plan steps that would create, modify or stage the grader go to the model's own test file instead. */
export function redirectGraderEdits(markdown: string): { markdown: string; redirected: number } {
  let redirected = 0;
  const lines = markdown.split("\n").map((line) => {
    const changes = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:modify|create):/i.test(line) || /\bgit[ \t]+add\b/.test(line);
    if (changes && line.includes(GRADER)) {
      redirected += 1;
      return line.replaceAll(GRADER, OWN_TESTS);
    }
    if (HEADING_CHANGE.test(line) && line.includes(GRADER_NAME) && !/\bpytest\b/.test(line)) {
      redirected += 1;
      return line.replaceAll(GRADER, OWN_TESTS).replaceAll(GRADER_NAME, OWN_NAME);
    }
    return line;
  });
  return { markdown: lines.join("\n"), redirected };
}

/** This session has no subagent tool: point the writing-plans header at executing-plans only. */
export function nativePlanHeader(markdown: string): string {
  return markdown.split("\n").map((line) => !/REQUIRED SUB-SKILL/.test(line) ? line : line
    .replace(/superpowers:subagent-driven-development(?: \(recommended\))? or (superpowers:executing-plans)/, "$1")
    .replace(/superpowers:subagent-driven-development(?: \(recommended\))?/, "superpowers:executing-plans"),
  ).join("\n");
}

export function freezePlanCommands(markdown: string): FrozenPlan {
  let serverStarts = 0;
  const freeze = (command: string, servers: boolean): string => {
    if (servers && liveServerUse(command) === "server") {
      serverStarts += 1;
      return TEST_SUITE;
    }
    return command.replace(PYTEST, FROZEN).replace(PYTHON, FROZEN_PYTHON);
  };

  let fence = "";
  let shell = false;
  const frozen = markdown.split("\n").map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})[ \t]*(\S*)/);
    if (fence) {
      if (marker && marker[1].startsWith(fence) && !marker[2]) fence = "";
      else if (shell) {
        return line.replace(/^(\s*(?:\$[ \t]+)?)(.*)/, (_, prefix, command) =>
          prefix + (command.trim() ? freeze(command, true) : command));
      }
      return line;
    }
    if (marker) {
      fence = marker[1];
      shell = SHELL_FENCE.test(marker[2]);
      return line;
    }

    const commandLabel = /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:run|command):(?:\*\*)?[ \t]*/i;
    const label = line.match(commandLabel);
    if (label && !line.slice(label[0].length).startsWith("`")) {
      line = label[0] + freeze(line.slice(label[0].length), true);
    }
    // Judge each span by the words since the previous one: "Run: `pytest`; never `uvicorn`".
    let since = label ? label[0].length : 0;
    return line.replace(/(`+)([^`\r\n]+)\1/g, (span: string, quote: string, command: string, offset: number) => {
      const forbidden = PROHIBITION.test(line.slice(since, offset));
      since = offset + span.length;
      return !label && !/\s/.test(command.trim()) ? span : quote + freeze(command, !forbidden) + quote;
    });
  }).join("\n");
  return { markdown: frozen, serverStarts };
}

function plansIn(cwd: string): Map<string, string> {
  const root = join(cwd, PLANS);
  if (!existsSync(root) || realpathSync(root) !== join(realpathSync(cwd), PLANS)) return new Map();
  const plans = new Map<string, string>();
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(entry.parentPath, entry.name);
    if (realpathSync(path) === join(realpathSync(cwd), relative(cwd, path))) {
      plans.set(path, readFileSync(path, "utf8"));
    }
  }
  return plans;
}

export default function frozenPytestPlans(pi: ExtensionAPI) {
  const beforeBash = new Map<string, Map<string, string>>();
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "bash") beforeBash.set(event.toolCallId, plansIn(ctx.cwd));
  });

  pi.on("tool_result", (event, ctx) => {
    let changed: [string, string][];
    if (event.toolName === "bash") {
      const before = beforeBash.get(event.toolCallId);
      beforeBash.delete(event.toolCallId);
      if (!before) return;
      changed = [...plansIn(ctx.cwd)].filter(([path, content]) => before.get(path) !== content);
    } else {
      const { path } = event.input;
      if (event.isError || !["write", "edit"].includes(event.toolName) || typeof path !== "string") return;
      const target = resolve(ctx.cwd, path);
      if (!relative(ctx.cwd, target).startsWith(PLANS + "/") || !target.endsWith(".md")) return;
      const content = plansIn(ctx.cwd).get(target);
      changed = content === undefined ? [] : [[target, content]];
    }
    const corrected: string[] = [];
    let serverStarts = 0;
    let graderSteps = 0;
    for (const [path, content] of changed) {
      const kept = redirectGraderEdits(nativePlanHeader(content));
      const frozen = freezePlanCommands(kept.markdown);
      graderSteps += kept.redirected;
      if (frozen.markdown === content) continue;
      writeFileSync(path, frozen.markdown);
      corrected.push(relative(ctx.cwd, path));
      serverStarts += frozen.serverStarts;
    }
    if (!corrected.length) return;
    let text = `Applied the project's frozen pytest and Python commands in ${corrected.join(", ")}. ` +
      `The saved plan uses \`${FROZEN_PYTHON}\`.`;
    if (serverStarts) {
      text += ` Replaced ${serverStarts} server start${serverStarts === 1 ? "" : "s"} with \`${TEST_SUITE}\`: ` +
        "check routes in process with `TestClient(app)` and `follow_redirects=False`, not a live server.";
    }
    if (graderSteps) {
      text += ` Pointed ${graderSteps} plan step${graderSteps === 1 ? "" : "s"} that changed ${GRADER} at ` +
        `${OWN_TESTS}: the grader stays as shipped.`;
    }
    return { content: [...event.content, { type: "text", text }] };
  });
}
