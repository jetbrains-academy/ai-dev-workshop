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

// A last task that only reruns the tests, and maybe commits, came out of 3 of 7 headless plans on 2026-11-27
// ("Verify Phase 1-3 still pass"), sometimes with manual steps such as "Visit /complaints" that cannot run.
// Asking Mellum to fold it in failed in 7 of 7 rereads and both repair prompts, so the save drops it instead.
// The finish step already runs the project's test suite.
const TASK = /^(#{2,4})[ \t]+Task[ \t]+(\d+)\b[:.)]?[ \t]*(.*)$/;
const RUN_SPAN = /\b(?:Run|Command)\b\**:?\**[ \t]*`([^`]+)`/gi;
const FILE_CHANGE = /^\s*(?:[-*][ \t]+)?\**(?:Create|Modify)\**:\**[ \t]*(.*)$/i;

export function dropVerificationTask(markdown: string, config: ProjectConfig): { markdown: string; dropped?: { number: number; title: string } } {
  const lines = markdown.split("\n");
  const tasks: { index: number; level: number; number: number; title: string }[] = [];
  const boundaries: { index: number; level: number }[] = [];
  let fence = "";
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker && (!fence || marker[1].startsWith(fence))) {
      fence = fence ? "" : marker[1];
      continue;
    }
    if (fence) continue;
    const task = line.match(TASK);
    if (task) tasks.push({ index, level: task[1].length, number: Number(task[2]), title: task[3].trim() });
    const heading = line.match(/^(#{1,6})[ \t]/);
    if (heading) boundaries.push({ index, level: heading[1].length });
    else if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) boundaries.push({ index, level: 0 });
  }
  const last = tasks.at(-1);
  if (!last || tasks.length < 2) return { markdown };
  const end = boundaries.find((b) => b.index > last.index && b.level <= last.level)?.index ?? lines.length;
  const testCommand = (command: string) => (config.pytest ? command.startsWith(config.pytest) : false) || PYTEST.test(command);
  const commands: string[] = [];
  let shell: boolean | undefined;
  for (const line of lines.slice(last.index + 1, end)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})[ \t]*(\S*)/);
    if (marker) {
      if (shell === undefined && !SHELL_FENCE.test(marker[2])) return { markdown };
      shell = shell === undefined ? true : undefined;
      continue;
    }
    if (shell) {
      const command = line.replace(/\s#.*$/, "").trim().replace(/^\$[ \t]+/, "");
      if (command && !command.startsWith("#")) commands.push(command);
      continue;
    }
    const change = line.match(FILE_CHANGE);
    if (change && change[1].trim() && !/^none\b/i.test(change[1].trim())) return { markdown };
    for (const span of line.matchAll(RUN_SPAN)) commands.push(span[1].trim());
  }
  const allowed = (command: string) => testCommand(command) || /^git(?:[ \t]|$)/.test(command);
  if (!commands.some(testCommand) || !commands.every(allowed)) return { markdown };
  const kept = [...lines.slice(0, last.index), ...(end === lines.length ? [""] : lines.slice(end))];
  return { markdown: kept.join("\n"), dropped: { number: last.number, title: last.title } };
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
import re
import sys
from textwrap import dedent

errors = []
for snippet in json.load(sys.stdin):
    try:
        ast.parse(dedent(snippet["source"]))
    except SyntaxError as error:
        first = snippet["firstLine"]
        errors.append({
            "line": first + max(error.lineno or 1, 1) - 1,
            "firstLine": first,
            # Pi's read shows no line numbers, so name plan lines, never snippet lines.
            "message": re.sub(r"on line (\\d+)", lambda m: f"on line {first + int(m[1]) - 1}", error.msg),
        })
print(json.dumps(errors))
`;

// The test that holds a plan line: the last \`def test_…\` at or above it in its snippet.
function enclosingTest({ lines, firstLine }: PythonSnippet, line: number): string | undefined {
  return lines.slice(0, line - firstLine + 1).map((text) => text.match(/^\s*(?:async\s+)?def\s+(test_\w+)/)?.[1])
    .findLast(Boolean);
}

export const FIX_FIRST = "Fix these in the plan with `save_plan` and reread it before asking for approval:";

function testSyntaxErrors(cwd: string, python: string | undefined, snippets: PythonSnippet[]): { line: number; firstLine: number; message: string }[] {
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

// Mechanical findings for a saved plan: `pass`-only tests and test snippets that do not parse, each named.
// plan-approval.ts repeats them on a repair prompt and at the end of planning.
export function planWarnings(cwd: string, config: ProjectConfig, plan: string, markdown: string): string[] {
  const snippets = pythonSnippets(markdown);
  const warnings = snippets.flatMap(passOnlyTests).map(({ name, line }) =>
    `Warning: \`${name}\` in ${plan}:${line} contains only \`pass\`. Replace it with a complete test.`);
  for (const { line, firstLine, message } of testSyntaxErrors(cwd, config.python, snippets)) {
    const snippet = snippets.find((candidate) => candidate.firstLine === firstLine);
    const name = snippet && enclosingTest(snippet, line);
    warnings.push(`Warning: ${name ? `\`${name}\`` : "A Python test snippet"} in ${plan}:${line} does not parse: ` +
      `${message}. Give it a complete body.`);
  }
  return warnings;
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
      if (event.isError || !["write", "edit", "save_plan"].includes(event.toolName) || typeof path !== "string") return;
      const target = resolve(ctx.cwd, path);
      if (!relative(ctx.cwd, target).startsWith(PLANS + "/") || !target.endsWith(".md")) return;
      const content = plansIn(ctx.cwd).get(target);
      changed = content === undefined ? [] : [[target, content]];
    }
    const corrected: string[] = [];
    const warnings: string[] = [];
    let serverStarts = 0;
    let taskSteps = 0;
    const dropped: string[] = [];
    const config = projectConfig(ctx.cwd);
    for (const [path, content] of changed) {
      const headed = taskHeadings(content);
      const frozen = freezePlanCommands(nativePlanHeader(headed.markdown), config);
      const verified = dropVerificationTask(frozen.markdown, config);
      frozen.markdown = verified.markdown;
      taskSteps += headed.renamed;
      const plan = relative(ctx.cwd, path);
      if (verified.dropped) {
        dropped.push(`Removed Task ${verified.dropped.number} ("${verified.dropped.title}") from ${plan}: it only reran ` +
          "the tests, and the finish step runs the test suite.");
      }
      warnings.push(...planWarnings(ctx.cwd, config, plan, frozen.markdown));
      if (frozen.markdown === content) continue;
      writeFileSync(path, frozen.markdown);
      corrected.push(plan);
      serverStarts += frozen.serverStarts;
    }
    // Warnings lead: Mellum follows the first imperative in a result, which is otherwise "reread, then ask for approval".
    const lead = warnings.length ? [{ type: "text" as const, text: [FIX_FIRST, ...warnings].join("\n") }] : [];
    if (!corrected.length) return lead.length ? { content: [...lead, ...event.content] } : undefined;
    let text = `Applied the project's test and Python commands in ${corrected.join(", ")}.` +
      (config.python ? ` The saved plan uses \`${config.python}\`.` : "");
    if (serverStarts) {
      text += ` Replaced ${serverStarts} server start${serverStarts === 1 ? "" : "s"} with \`${config.testSuite}\`.` +
        (config.inProcessHint ? ` ${config.inProcessHint}` : "");
    }
    if (dropped.length) text += ` ${dropped.join(" ")}`;
    if (taskSteps) {
      text += ` Named ${taskSteps} numbered heading${taskSteps === 1 ? "" : "s"} "Task N:" so executing-plans' ` +
        "task-start can find each task.";
    }
    return { content: [...lead, ...event.content, { type: "text", text }] };
  });
}
