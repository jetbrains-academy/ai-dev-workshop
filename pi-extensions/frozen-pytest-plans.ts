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

// Flask writes a path parameter "/<int:id>"; FastAPI writes "/{id}", and a "<int:id>" route never matches. In the
// final n=8 check on 2026-11-25, run 1's plan had "@app.route('/complaints/<int:id>/resolve', ...)"; Pi copied the
// path into app.py and spent 30 minutes on probes without seeing it. Thinking-filter run 4 did the same.
const FLASK_PARAM = /\/<(?:(?:int|str|path|float|uuid):)?([A-Za-z_]\w*)>/g;

export function fastapiPaths(markdown: string): { markdown: string; rewritten: number } {
  let rewritten = 0;
  const out = markdown.split("\n").map((line) => {
    const fixed = line.replace(FLASK_PARAM, (_match, name: string) => `/{${name}}`);
    if (fixed !== line) rewritten += 1;
    return fixed;
  });
  return { markdown: out.join("\n"), rewritten };
}

// executing-plans' task-start finds a task by a heading "Task N". In 3 of 11 headless runs on
// 2026-11-25 the plan numbered its tasks "### 1. Update ..." instead; task-start failed, and Pi
// either spent 200 to 470 seconds working out why or skipped the plan. A plan with no Task headings
// but two or more numbered ones gets "Task" added; fenced code is left alone.
const TASK_HEADING = /^#{1,6}[ \t]+Task[ \t]+\d+\b/;
const NUMBERED_HEADING = /^(#{2,4})[ \t]+(\d+)[.):][ \t]+(\S.*)$/;

export function taskHeadings(markdown: string): { markdown: string; renamed: number } {
  const lines = markdown.split("\n");
  let fenced = false;
  const outside = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && !/^\s*(```|~~~)/.test(line);
  });
  if (lines.some((line, i) => outside[i] && TASK_HEADING.test(line))) return { markdown, renamed: 0 };
  const numbered = lines.filter((line, i) => outside[i] && NUMBERED_HEADING.test(line)).length;
  if (numbered < 2) return { markdown, renamed: 0 };
  let renamed = 0;
  const out = lines.map((line, i) => {
    const match = outside[i] ? line.match(NUMBERED_HEADING) : null;
    if (!match) return line;
    renamed += 1;
    return `${match[1]} Task ${match[2]}: ${match[3]}`;
  });
  return { markdown: out.join("\n"), renamed };
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
    let taskSteps = 0;
    let pathLines = 0;
    for (const [path, content] of changed) {
      const headed = taskHeadings(content);
      const paths = fastapiPaths(nativePlanHeader(headed.markdown));
      const frozen = freezePlanCommands(paths.markdown);
      taskSteps += headed.renamed;
      pathLines += paths.rewritten;
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
    if (pathLines) {
      text += ` Wrote the route paths on ${pathLines} plan line${pathLines === 1 ? "" : "s"} with \`{id}\`: FastAPI path ` +
        "parameters are written `{id}`, and a Flask-style `<int:id>` path never matches.";
    }
    if (taskSteps) {
      text += ` Named ${taskSteps} numbered heading${taskSteps === 1 ? "" : "s"} "Task N:" so executing-plans' ` +
        "task-start can find each task.";
    }
    return { content: [...event.content, { type: "text", text }] };
  });
}
