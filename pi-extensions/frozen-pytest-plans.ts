import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { liveServerUse } from "./no-live-server.ts";
import { projectConfig, type ProjectConfig } from "./project-config.ts";

const PLANS = "docs/superpowers/plans";
// A plan's pytest and python commands become the project's own (`pytest`, `python` in .pi/project.json),
// and a server start becomes its `testSuite`. Without those keys a plan is saved as written.
const PYTEST = /^(?:uv[ \t]+run[ \t]+)?(?:python(?:3(?:\.\d+)?)?[ \t]+-m[ \t]+)?pytest(?=$|[ \t])/;
const PYTHON = /^(?:uv[ \t]+run[ \t]+)?python(?:3(?:\.\d+)?)?(?=$|[ \t])/;
const SHELL_FENCE = /^(?:bash|sh|shell|zsh|console)?$/i;
// A plan line that forbids a command keeps it: "Never run `python app.py`".
const PROHIBITION = /\b(?:never|not|don't|avoid|instead of|without)\b/i;

export interface FrozenPlan {
  markdown: string;
  serverStarts: number;
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

export function freezePlanCommands(markdown: string, config: ProjectConfig): FrozenPlan {
  let serverStarts = 0;
  const freeze = (command: string, servers: boolean): string => {
    if (servers && config.testSuite && liveServerUse(command, config.servers) === "server") {
      serverStarts += 1;
      return config.testSuite;
    }
    let out = command;
    if (config.pytest) out = out.replace(PYTEST, config.pytest);
    if (config.python) out = out.replace(PYTHON, config.python);
    return out;
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

interface PythonSnippet {
  lines: string[];
  firstLine: number;
}

function pythonSnippets(markdown: string): PythonSnippet[] {
  const lines = markdown.split(/\r?\n/);
  const snippets: PythonSnippet[] = [];
  let fence = "";
  let python = false;
  let start = 0;
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^\s*(`{3,}|~{3,})[ \t]*(\S*)/);
    if (!fence && marker) {
      fence = marker[1];
      python = /^(?:py|python3?)$/i.test(marker[2]);
      start = index + 1;
      continue;
    }
    if (fence && marker && marker[1].startsWith(fence) && !marker[2]) {
      if (python) snippets.push({ lines: lines.slice(start, index), firstLine: start + 1 });
      fence = "";
    }
  }
  if (fence && python) snippets.push({ lines: lines.slice(start), firstLine: start + 1 });
  return snippets;
}

function passOnlyTests({ lines, firstLine }: PythonSnippet): { name: string; line: number }[] {
  const stubs: { name: string; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const test = line.match(/^([ \t]*)(?:async\s+)?def\s+(test_\w+)\s*\(.*\)(?:\s*->\s*[^:]+)?:\s*(?:#.*)?$/);
    if (!test) continue;
    let passLine: number | undefined;
    for (let body = index + 1; body < lines.length; body++) {
      const text = lines[body].trim();
      if (!text || text.startsWith("#")) continue;
      const indent = lines[body].length - lines[body].trimStart().length;
      if (indent <= test[1].length) break;
      if (passLine !== undefined || !/^pass(?:\s*#.*)?$/.test(text)) {
        passLine = undefined;
        break;
      }
      passLine = firstLine + body;
    }
    if (passLine !== undefined) stubs.push({ name: test[2], line: passLine });
  }
  return stubs;
}

const PARSE_TEST_SNIPPETS = `
import ast
import json
import sys
from textwrap import dedent

errors = []
for snippet in json.load(sys.stdin):
    try:
        ast.parse(dedent(snippet["source"]))
    except SyntaxError as error:
        errors.append({
            "line": snippet["firstLine"] + max(error.lineno or 1, 1) - 1,
            "message": error.msg.replace("on line ", "on snippet line "),
        })
print(json.dumps(errors))
`;

function testSyntaxErrors(cwd: string, python: string | undefined, snippets: PythonSnippet[]): { line: number; message: string }[] {
  if (!python) return [];
  const tests = snippets
    .filter(({ lines }) => lines.some((line) => /^\s*(?:(?:async\s+)?def\s+test_|@pytest\.fixture\b)/.test(line)))
    .map(({ lines, firstLine }) => ({ source: lines.join("\n"), firstLine }));
  if (!tests.length) return [];
  const [program, ...args] = python.split(" ");
  try {
    const output = execFileSync(program, [...args, "-I", "-c", PARSE_TEST_SNIPPETS], {
      cwd, input: JSON.stringify(tests), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 5000,
    });
    return JSON.parse(output);
  } catch {
    return []; // The optional check must not fail a saved plan when Python is unavailable.
  }
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
    const warnings: string[] = [];
    let serverStarts = 0;
    let taskSteps = 0;
    const config = projectConfig(ctx.cwd);
    for (const [path, content] of changed) {
      const headed = taskHeadings(content);
      const frozen = freezePlanCommands(nativePlanHeader(headed.markdown), config);
      taskSteps += headed.renamed;
      const plan = relative(ctx.cwd, path);
      const snippets = pythonSnippets(frozen.markdown);
      for (const { name, line } of snippets.flatMap(passOnlyTests)) {
        warnings.push(`Warning: ${plan}:${line}: ${name} contains only \`pass\`. Replace it with a complete test.`);
      }
      for (const { line, message } of testSyntaxErrors(ctx.cwd, config.python, snippets)) {
        warnings.push(`Warning: ${plan}:${line}: Python test snippet does not parse. ${message}`);
      }
      if (frozen.markdown === content) continue;
      writeFileSync(path, frozen.markdown);
      corrected.push(plan);
      serverStarts += frozen.serverStarts;
    }
    if (!corrected.length) {
      if (warnings.length) return { content: [...event.content, { type: "text", text: warnings.join("\n") }] };
      return;
    }
    let text = `Applied the project's test and Python commands in ${corrected.join(", ")}.` +
      (config.python ? ` The saved plan uses \`${config.python}\`.` : "");
    if (serverStarts) {
      text += ` Replaced ${serverStarts} server start${serverStarts === 1 ? "" : "s"} with \`${config.testSuite}\`.` +
        (config.inProcessHint ? ` ${config.inProcessHint}` : "");
    }
    if (taskSteps) {
      text += ` Named ${taskSteps} numbered heading${taskSteps === 1 ? "" : "s"} "Task N:" so executing-plans' ` +
        "task-start can find each task.";
    }
    return { content: [...event.content, { type: "text", text: [text, ...warnings].join("\n") }] };
  });
}
