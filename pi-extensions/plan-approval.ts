import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchPrompt, projectConfig } from "./project-config.ts";

const PLANS = "docs/superpowers/plans";
const ENTRY = "plan-approval";
const READ_TOOLS = new Set(["read", "ls", "find", "grep"]);
// The phase comes from the prompt that started the stage, through the patterns in .pi/project.json.
const label = (phase: number | undefined) => (phase === undefined ? "Plan" : `Phase ${phase}`);
const locked = (phase: number | undefined) => `${label(phase)} approval guard: code edits and commands stay locked ` +
  "until the user approves the plan. Only the user's approval unlocks them; editing design or plan files does not.";
const designOnly = (phase: number | undefined) => locked(phase) +
  " This turn only saves the design under docs/superpowers/specs/. Save it, reply with a short summary, and end your turn.";
const planOnly = (phase: number | undefined, skill: string | undefined) => locked(phase) +
  " This turn only writes the plan. Read the writing-plans skill" + (skill ? ` at ${skill}` : "") +
  ", save the plan under docs/superpowers/plans/, complete its self-review, and present the plan for approval.";
const planSaved = (phase: number | undefined, path: string) => locked(phase) +
  ` Your plan is saved at ${path}. Continue the writing-plans self-review, revise the plan as needed, and present it for approval.`;

// Mellum read a bare refusal as "an odd message from a previous interaction" and ignored it,
// so every refusal opens by naming the call it answers.
export function blockedCall(toolName: string, input: Record<string, unknown>): string {
  const opening = `Blocked just now: your \`${toolName}\` call`;
  if (typeof input.command === "string") {
    const line = input.command.replace(/\s+/g, " ").trim();
    return `${opening} \`${line.length > 120 ? line.slice(0, 119) + "…" : line}\`.`;
  }
  return typeof input.path === "string" ? `${opening} on \`${input.path}\`.` : `${opening}.`;
}

const SHELL_ALLOWED = "Read-only `ls`, `pwd`, `git status`, `date`, and plain `find` with relative paths are allowed " +
  "when they use no `|`, `||`, `;`, `&`, `>`, `2>` or `$(`; the read, find and grep tools are always allowed.";

function refusal(toolName: string, input: Record<string, unknown>, stage: string): string {
  return [blockedCall(toolName, input), stage, ...(toolName === "bash" ? [SHELL_ALLOWED] : [])].join(" ");
}

// Superpowers names files YYYY-MM-DD-<name>.md, but Pi's prompt has no date, so Mellum guessed:
// `phase-4-design.md` and `2026-11-10-phase-4-design.md` on 2026-11-25.
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Each stage hears only its own folder: naming plans/ while brainstorming led Pi to write a plan
// then too (4 of 4 runs, 2026-11-25), and that early plan kept approval locked.
const dateNote = (date: string, stage: "design" | "planning") => stage === "design"
  ? `Today is ${date}. Save the design as docs/superpowers/specs/${date}-<topic>-design.md.`
  : `Today is ${date}. Save the plan as docs/superpowers/plans/${date}-<feature-name>.md.`;

export interface PlanTask { number: number; title: string }
export interface PlanProgress { started: Record<number, { brief: string; base: string }>; recorded: number[] }
/** The phase the plan belongs to and the project's test runner, from .pi/project.json. */
export interface NoteContext { phase?: number; pytest?: string }

// Any heading level, outside fenced code, as Superpowers' task-brief reads them; 2 of 61 Mellum plans used `##`.
export function planTasks(markdown: string): PlanTask[] {
  let fence = "";
  return markdown.split("\n").flatMap((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) fence = fence ? (marker[1].startsWith(fence) ? "" : fence) : marker[1];
    const task = fence || marker ? null : line.match(/^#{1,6}[ \t]+Task[ \t]+(\d+)\b[:.)\-—\s]*(.*?)\s*$/);
    return task ? [{ number: Number(task[1]), title: task[2] }] : [];
  });
}

// The audience should see Superpowers' executing-plans run the plan; this note only tells Pi where it is.
// In the 2026-11-25 runs Pi either never opened the plan or lost its place after a compaction.
export function planNote(plan: string, tasks: PlanTask[], progress: PlanProgress, scripts: string,
  commits: string[] = [], context: NoteContext = {}): string | undefined {
  const recorded = new Set(progress.recorded);
  const next = tasks.find((task) => !recorded.has(task.number));
  if (tasks.length && !next) return;
  const started = next && progress.started[next.number];
  const done = tasks.filter((task) => recorded.has(task.number)).map((task) => `Task ${task.number}`);
  const title = (task: PlanTask) => `Task ${task.number}${task.title ? `: ${task.title}` : ""}`;
  return [
    `${label(context.phase)}${context.phase === undefined ? "" : " plan"}: ${plan}. ` +
      "Execute it with the executing-plans skill, one task at a time.",
    tasks.length ? `Tasks: ${tasks.map(title).join("; ")}.` : "Tasks: as the plan's task headings list them.",
    `Recorded: ${done.length ? done.join(", ") : "none yet"}.`,
    !next
      ? `Next: the first task the plan lists. Start it with \`${scripts}/task-start ${plan} N\`, N being its number.`
      : started
        ? `Next: Continue Task ${next.number} from its brief ${started.brief} with base ${started.base}; ` +
          "do not run task-start again for it."
        : `Next: Task ${next.number}. Start it with \`${scripts}/task-start ${plan} ${next.number}\`.`,
    // "Record it rather than redoing it" let runs record tasks they never worked; the brief check keeps
    // the shortcut for real finished work without inviting that.
    ...(commits.length ? [`Commits since approval: ${commits.join("; ")}. If a task's work is already committed, ` +
      "run task-start for it, check its brief's steps against that commit, do any step that is missing, " +
      "then run task-done."] : []),
    `Finish each task with \`${scripts}/task-done ${plan} N BASE -- ` +
      `${context.pytest ? `${context.pytest} TEST_FILES` : "TEST_COMMAND"}\`; ` +
      "the test command goes as separate words after --, not one quoted string.",
    // Run from the Superpowers folder, task-start's workspace script loops forever on a sandboxed mkdir.
    "Run the scripts from the project folder exactly as written, without cd: they are installed outside the " +
      "project on purpose.",
    "Work the tasks in order, commit as each task's steps say, and do not move to the next task until task-done " +
      "records the current one.",
  ].join("\n");
}

type PlanState = { phase?: number } & (
  | { status: "design" }
  | { status: "planning"; previousPlans: Record<string, string> }
  | { status: "approved"; plan?: string; progress?: PlanProgress; head?: string; staleLedger?: number[];
      approvedAt?: number }
  | { status: "finished" });

const unlocked = (state: PlanState) => state.status === "approved" || state.status === "finished";

function stateEntry(ctx: ExtensionContext) {
  const entry = ctx.sessionManager.getBranch().findLast(
    (entry) => entry.type === "custom" && entry.customType === ENTRY,
  );
  if (entry?.type === "custom") return entry;
}

function stateFor(ctx: ExtensionContext): PlanState | undefined {
  return stateEntry(ctx)?.data as PlanState | undefined;
}

function statIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function artifactPath(cwd: string, input: unknown): string | undefined {
  if (typeof input !== "string" || input.split("/").includes("..")) return;
  const parts = relative(cwd, resolve(cwd, input)).split("/");
  if (parts[0] !== "docs" || parts[1] !== "superpowers" || !["plans", "specs"].includes(parts[2])) return;
  const filename = parts.at(-1);
  if (parts.length < 4 || !filename?.endsWith(".md")) return;

  // Match plain paths and reject aliases that could point at implementation files.
  let target = realpathSync(cwd);
  for (const [index, part] of parts.entries()) {
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(part)) return;
    target = join(target, part);
    const stat = statIfPresent(target);
    if (!stat) continue;
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) return;
  }
  return target;
}

function savedPlans(cwd: string): Record<string, string> {
  const probe = artifactPath(cwd, join(PLANS, "approval-probe.md"));
  if (!probe) return {};
  const workspace = realpathSync(cwd);
  const directory = join(workspace, PLANS);
  if (!statIfPresent(directory)) return {};
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true, recursive: true }).flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    const target = artifactPath(workspace, join(entry.parentPath, entry.name));
    if (!target) return [];
    const content = readFileSync(target, "utf8");
    return content.trim() ? [[relative(workspace, target), createHash("sha256").update(content).digest("hex")]] : [];
  }));
}

// Tasks executing-plans' task-done recorded in this plan's ledger. The workspace directory name can be
// disambiguated, so match the ledger by the plan named on its first line.
export function readLedger(cwd: string, plan: string): number[] {
  const root = join(cwd, ".superpowers/sdd");
  if (!statIfPresent(root)) return [];
  const wanted = resolve(cwd, plan);
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = join(root, entry.name, "progress.md");
    if (!entry.isDirectory() || !statIfPresent(file)) return [];
    const [first, ...lines] = readFileSync(file, "utf8").split("\n");
    const named = first.match(/^# SDD ledger — plan: (.+)$/)?.[1];
    if (!named || resolve(cwd, named.trim()) !== wanted) return [];
    return lines.flatMap((line) => line.match(/^Task (\d+): complete\b/)?.[1] ?? []).map(Number);
  }).sort((a, b) => a - b);
}

function gitOutput(cwd: string, ...args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

// `find` actions that run or write something.
const FIND_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);

function readOnlyShell(command: unknown): boolean {
  if (typeof command !== "string") return false;
  const trimmed = command.trim();
  // Planning names plan files by date and looks for earlier plans; both only read.
  if (/^date(?:[ \t]+\+[^\s;&|<>`$()]+)?$/.test(trimmed)) return true;
  if (/^find[ \t]/.test(trimmed) && !/[;&|<>`$()\n\\]/.test(trimmed)) {
    const args = trimmed.split(/[ \t]+/).slice(1);
    const paths = args.slice(0, Math.max(0, args.findIndex((word) => word.startsWith("-"))) || args.length);
    return args.every((word) => !FIND_ACTIONS.has(word))
      && paths.every((path) => !path.startsWith("/") && !path.split("/").includes(".."));
  }
  const words = trimmed.split(/[ \t]+/);
  if (!words.every((word) => /^[a-z0-9_./-]+$/i.test(word))) return false;
  const [program, subcommand, ...args] = words;
  if (program === "pwd") return words.length === 1;
  if (program === "ls") {
    return words.slice(1).every((word) => /^-[alh1]+$/.test(word)
      || (!word.startsWith("-") && !word.startsWith("/") && !word.split("/").includes("..")));
  }
  if (program !== "git") return false;
  if (subcommand === "status") return args.every((word) => ["--short", "--porcelain", "-sb", "-s"].includes(word));
  if (subcommand === "ls-files") return args.length === 0;
  return false;
}

const PLAN_NOTE = "plan-note";

const ALL_DONE = "Every task in the plan is recorded and the full test suite passes. " +
  "Complete the executing-plans final review and report the results. The finish prompt runs the checks and marks the phase done.";

export function compactionSummary(plan: string, note: string | undefined, status: string,
  fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> }, phase?: number): string {
  const changed = [...new Set([...fileOps.edited, ...fileOps.written])].sort();
  return [
    `Summary written by the ${phase === undefined ? "" : `Phase ${phase} `}plan guard from its own records (no model summary).`,
    `The user approved the plan ${plan}; you are executing it with the executing-plans skill, one task at a time.`,
    note ?? "Every task in the plan is recorded: run the full test suite, commit anything left, and report.",
    `Uncommitted changes: ${status.trim() ? status.trim().split("\n").join("; ") : "none"}.`,
    `Files read: ${fileOps.read.size ? [...fileOps.read].sort().join(", ") : "none"}.`,
    `Files changed: ${changed.length ? changed.join(", ") : "none"}.`,
    "The latest exchanges follow.",
  ].join("\n");
}

type ContextMessage = ContextEvent["messages"][number];

export function stubPlanningResults(messages: ContextMessage[], approvedAt: number): ContextMessage[] | undefined {
  let changed = false;
  const out = messages.map((message) => {
    if (message.role !== "toolResult" || typeof message.timestamp !== "number" || message.timestamp >= approvedAt) return message;
    const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    if (text.length < 200) return message;
    changed = true;
    return { ...message, content: [{ type: "text", text: "[planning-stage result omitted after the plan was approved]" }] };
  });
  return changed ? out : undefined;
}

function suitePasses(cwd: string): boolean {
  const suite = projectConfig(cwd).testSuite;
  if (!suite) return false;
  const [program, ...args] = suite.split(" ");
  try {
    execFileSync(program, args, { cwd, stdio: "pipe", timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}


export default function planApproval(pi: ExtensionAPI) {
  let writingPlans: string | undefined;
  let datedStage: string | undefined;
  let executingPlans: string | undefined;
  let approvalNote = false;
  const scriptsDir = () => (executingPlans ? join(dirname(executingPlans), "scripts") : "executing-plans/scripts");
  pi.on("before_agent_start", (event, ctx) => {
    writingPlans = event.systemPromptOptions.skills.find((skill) => skill.name === "writing-plans")?.filePath ?? writingPlans;
    executingPlans = event.systemPromptOptions.skills.find((skill) => skill.name === "executing-plans")?.filePath ?? executingPlans;
    if (approvalNote) {
      approvalNote = false;
      const state = stateFor(ctx);
      if (state?.status !== "approved" || !state.plan) return;
      const note = planNote(state.plan, planTasks(readFileSync(join(ctx.cwd, state.plan), "utf8")),
        state.progress ?? { started: {}, recorded: [] }, scriptsDir(), [],
        { phase: state.phase, pytest: projectConfig(ctx.cwd).pytest });
      if (note) return { message: { customType: PLAN_NOTE, content: note, display: true } };
      return;
    }
    const entry = stateEntry(ctx);
    const state = entry?.data as PlanState | undefined;
    if (!entry || !state || unlocked(state) || entry.id === datedStage) return;
    datedStage = entry.id;
    return { message: { customType: "plan-date", content: dateNote(today(), state.status), display: true } };
  });

  // Track executing-plans' own scripts from their results: a printed brief and base start a task, a
  // printed ledger line records it. Kept in session entries, since the workspace can be deleted.
  pi.on("tool_result", (event, ctx) => {
    const state = stateFor(ctx);
    if (state?.status !== "approved" || !state.plan || event.toolName !== "bash" || event.isError) return;
    const command = (event.input as { command?: unknown }).command;
    if (typeof command !== "string") return;
    const script = command.match(/executing-plans\/scripts\/(task-start|task-done)\s+(\S+)\s+(\d+)\b/);
    if (!script || resolve(ctx.cwd, script[2]) !== resolve(ctx.cwd, state.plan)) return;
    const text = event.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
    const n = Number(script[3]);
    const progress = structuredClone(state.progress ?? { started: {}, recorded: [] });
    if (script[1] === "task-start") {
      const brief = text.match(/^brief: (.+)$/m)?.[1];
      const base = text.match(/^base: (\S+)$/m)?.[1];
      if (!brief || !base) return;
      progress.started[n] = { brief: brief.trim(), base };
    } else {
      if (!new RegExp(`^ledger: Task ${n}: complete\\b`, "m").test(text) || progress.recorded.includes(n)) return;
      progress.recorded.push(n);
    }
    pi.appendEntry<PlanState>(ENTRY, { ...state, progress });
    if (script[1] === "task-done") {
      const tasks = planTasks(readFileSync(join(ctx.cwd, state.plan), "utf8"));
      if (tasks.length && tasks.every((task) => progress.recorded.includes(task.number)) && suitePasses(ctx.cwd)) {
        return { content: [...event.content, { type: "text", text: ALL_DONE }] };
      }
    }
  });

  // A compaction can drop the execution prompt and the task workflow (2026-11-25 PyCharm run): restate where
  // Pi is. "steer" reaches the next model call of a running turn; when idle it waits for the next prompt.
  // Pi can compact after a run has ended; a steering message then would start a turn by itself.
  let runEnded = false;
  pi.on("agent_start", () => { runEnded = false; });
  pi.on("agent_end", () => { runEnded = true; });

  const currentNote = (ctx: ExtensionContext, state: PlanState) => {
    if (state.status !== "approved" || !state.plan || !statIfPresent(join(ctx.cwd, state.plan))) return;
    const progress = state.progress ?? { started: {}, recorded: [] };
    // A ledger from an earlier rehearsal of the same plan name is not this run's progress.
    const ledger = readLedger(ctx.cwd, state.plan).filter((n) => !(state.staleLedger ?? []).includes(n));
    const recorded = [...new Set([...progress.recorded, ...ledger])];
    const log = state.head ? gitOutput(ctx.cwd, "log", "--oneline", "--reverse", `${state.head}..HEAD`) : undefined;
    return planNote(state.plan, planTasks(readFileSync(join(ctx.cwd, state.plan), "utf8")),
      { ...progress, recorded }, scriptsDir(), log ? log.split("\n") : [],
      { phase: state.phase, pytest: projectConfig(ctx.cwd).pytest });
  };

  // During execution the guard writes the compaction summary from what it tracks, so a compaction
  // costs no model call. Mellum's summaries took a median 64 s (4,000 to 12,000 reasoning tokens for
  // a summary of about 1,200), two hit the output cap after 174 and 207 s, and one said Pi was still
  // waiting to choose an execution approach. The latest exchanges are kept as usual.
  pi.on("session_before_compact", (event, ctx) => {
    const state = stateFor(ctx);
    if (state?.status !== "approved" || !state.plan) return;
    const note = currentNote(ctx, state);
    const summary = compactionSummary(state.plan, note, gitOutput(ctx.cwd, "status", "--short") ?? "",
      event.preparation.fileOps, state.phase);
    return { compaction: { summary, firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore } };
  });

  // Planning-stage tool results (skill text, file reads) are 10 to 14K tokens of a 60K window when
  // execution starts. After approval each is replaced by a stub in the request; the call and its
  // result keep their place, so the conversation stays well formed.
  pi.on("context", (event, ctx) => {
    const state = stateFor(ctx);
    if (state?.status !== "approved" || !state.approvedAt) return;
    const messages = stubPlanningResults(event.messages, state.approvedAt);
    return messages ? { messages } : undefined;
  });

  pi.on("session_compact", (event, ctx) => {
    const state = stateFor(ctx);
    if (!state) return;
    const note = currentNote(ctx, state);
    if (!note) return;
    const deliverAs = runEnded && !event.willRetry ? "nextTurn" : "steer";
    pi.sendMessage({ customType: PLAN_NOTE, content: note, display: true }, { deliverAs });
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "interactive" && event.source !== "rpc") return;
    const prompts = projectConfig(ctx.cwd).prompts;
    if (!prompts) return;
    const design = matchPrompt(prompts.design, event.text)?.phase;
    if (design !== undefined) {
      pi.appendEntry<PlanState>(ENTRY, { status: "design", phase: design });
      return;
    }
    const planning = matchPrompt(prompts.plan, event.text)?.phase;
    if (planning !== undefined) {
      pi.appendEntry<PlanState>(ENTRY, {
        status: "planning", phase: planning, previousPlans: savedPlans(ctx.cwd),
      });
      return;
    }
    if (matchPrompt(prompts.finish, event.text) && stateFor(ctx)?.status === "approved") {
      pi.appendEntry<PlanState>(ENTRY, { status: "finished", phase: stateFor(ctx)?.phase });
      return;
    }
    if (!matchPrompt(prompts.approve, event.text)) return;
    const state = stateFor(ctx);
    if (!state || unlocked(state)) return;
    const fresh = state.status === "planning"
      ? Object.entries(savedPlans(ctx.cwd)).filter(([path, hash]) => hash !== state.previousPlans[path]).map(([path]) => path)
      : [];
    if (!event.streamingBehavior && ctx.isIdle() && fresh.length) {
      const newest = (paths: string[]) =>
        paths.reduce((a, b) => (lstatSync(join(ctx.cwd, b)).mtimeMs > lstatSync(join(ctx.cwd, a)).mtimeMs ? b : a));
      const withTasks = fresh.filter((path) => planTasks(readFileSync(join(ctx.cwd, path), "utf8")).length);
      const plan = newest(withTasks.length ? withTasks : fresh);
      pi.appendEntry<PlanState>(ENTRY, {
        status: "approved", phase: state.phase, plan, progress: { started: {}, recorded: [] },
        head: gitOutput(ctx.cwd, "rev-parse", "HEAD"), staleLedger: readLedger(ctx.cwd, plan), approvedAt: Date.now(),
      });
      approvalNote = true;
      return;
    }
    ctx.ui.notify(`${label(state?.phase)} is still locked. Approve after Pi has saved its plan and stopped.`, "warning");
    return { action: "handled" };
  });

  pi.on("tool_call", (event, ctx) => {
    const state = stateFor(ctx);
    if (!state || unlocked(state) || READ_TOOLS.has(event.toolName)) return;
    if ((event.toolName === "write" || event.toolName === "edit") && artifactPath(ctx.cwd, event.input.path)) return;
    if (event.toolName === "bash" && readOnlyShell(event.input.command)) return;
    const input = event.input as Record<string, unknown>;
    if (state.status === "design") return { block: true, reason: refusal(event.toolName, input, designOnly(state.phase)) };
    const saved = Object.entries(savedPlans(ctx.cwd)).find(([path, hash]) => hash !== state.previousPlans[path]);
    const guidance = saved ? planSaved(state.phase, saved[0]) : planOnly(state.phase, writingPlans);
    return { block: true, reason: refusal(event.toolName, input, guidance) };
  });
}
