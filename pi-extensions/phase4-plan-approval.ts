import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, renameSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PLANS = "docs/superpowers/plans";
const ENTRY = "workshop-phase4-plan-approval";
const APPROVAL = "The plan looks good. Proceed with native execution.";
const READ_TOOLS = new Set(["read", "ls", "find", "grep"]);
const LOCKED = "Phase 4 approval guard: code edits and commands stay locked until the user approves the plan. " +
  "Only the user's approval unlocks them; editing design or plan files does not.";
const DESIGN_ONLY = LOCKED + " This turn only saves the design under docs/superpowers/specs/. " +
  "Save it, reply with a short summary, and end your turn.";
const planOnly = (skill: string | undefined) => LOCKED + " This turn only writes the plan. Read the writing-plans skill" +
  (skill ? ` at ${skill}` : "") + ", save the plan under docs/superpowers/plans/, reply with a short summary, and end your turn.";
const planSaved = (path: string) => `Phase 4 approval guard: your plan is saved at ${path}. ` +
  "Code edits stay locked until the user approves it, so this turn ends here.";

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

export function datedName(filename: string, date: string): string {
  return `${date}-${filename.replace(/^\d{4}-\d{2}-\d{2}-/, "")}`;
}

// Each stage hears only its own folder: naming plans/ while brainstorming led Pi to write a plan
// then too (4 of 4 runs, 2026-11-25), and that early plan kept approval locked.
const dateNote = (date: string, stage: "design" | "planning") => stage === "design"
  ? `Today is ${date}. Save the design as docs/superpowers/specs/${date}-<topic>-design.md.`
  : `Today is ${date}. Save the plan as docs/superpowers/plans/${date}-<feature-name>.md.`;

export interface PlanTask { number: number; title: string }
export interface PlanProgress { started: Record<number, { brief: string; base: string }>; recorded: number[] }

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
  commits: string[] = []): string | undefined {
  const recorded = new Set(progress.recorded);
  const next = tasks.find((task) => !recorded.has(task.number));
  if (tasks.length && !next) return;
  const started = next && progress.started[next.number];
  const done = tasks.filter((task) => recorded.has(task.number)).map((task) => `Task ${task.number}`);
  const title = (task: PlanTask) => `Task ${task.number}${task.title ? `: ${task.title}` : ""}`;
  return [
    `Phase 4 plan: ${plan}. Execute it with the executing-plans skill, one task at a time.`,
    tasks.length ? `Tasks: ${tasks.map(title).join("; ")}.` : "Tasks: as the plan's task headings list them.",
    `Recorded: ${done.length ? done.join(", ") : "none yet"}.`,
    !next
      ? `Next: the first task the plan lists. Start it with \`${scripts}/task-start ${plan} N\`, N being its number.`
      : started
        ? `Next: Continue Task ${next.number} from its brief ${started.brief} with base ${started.base}; ` +
          "do not run task-start again for it."
        : `Next: Task ${next.number}. Start it with \`${scripts}/task-start ${plan} ${next.number}\`.`,
    ...(commits.length ? [`Commits since approval: ${commits.join("; ")}. If a task's work is already committed, ` +
      "run task-start and task-done for it to record it rather than redoing it."] : []),
    `Finish each task with \`${scripts}/task-done ${plan} N BASE -- uv run --frozen python -m pytest TEST_FILES\`; ` +
      "the test command goes as separate words after --, not one quoted string.",
    "Work the tasks in order, commit as each task's steps say, and do not move to the next task until task-done " +
      "records the current one.",
  ].join("\n");
}

// `existing` lists the specs and plans present at the stage prompt; only files Pi makes later are renamed.
type Stage = { existing: string[] };
type Phase4State =
  | ({ status: "design" } & Stage)
  | ({ status: "planning"; previousPlans: Record<string, string> } & Stage)
  | { status: "approved"; plan?: string; progress?: PlanProgress; head?: string; staleLedger?: number[] }
  | { status: "finished" };

const unlocked = (state: Phase4State) => state.status === "approved" || state.status === "finished";

function stateEntry(ctx: ExtensionContext) {
  const entry = ctx.sessionManager.getBranch().findLast(
    (entry) => entry.type === "custom" && entry.customType === ENTRY,
  );
  if (entry?.type === "custom") return entry;
}

function stateFor(ctx: ExtensionContext): Phase4State | undefined {
  return stateEntry(ctx)?.data as Phase4State | undefined;
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

function existingArtifacts(cwd: string): string[] {
  const workspace = realpathSync(cwd);
  return ["specs", "plans"].flatMap((kind) => {
    const directory = join(workspace, "docs/superpowers", kind);
    if (!statIfPresent(directory)) return [];
    return readdirSync(directory, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => relative(workspace, join(entry.parentPath, entry.name)));
  });
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

const PLAN_NOTE = "workshop-phase4-plan";

export default function phase4PlanApproval(pi: ExtensionAPI) {
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
        state.progress ?? { started: {}, recorded: [] }, scriptsDir());
      if (note) return { message: { customType: PLAN_NOTE, content: note, display: true } };
      return;
    }
    const entry = stateEntry(ctx);
    const state = entry?.data as Phase4State | undefined;
    if (!entry || !state || unlocked(state) || entry.id === datedStage) return;
    datedStage = entry.id;
    return { message: { customType: "workshop-phase4-date", content: dateNote(today(), state.status), display: true } };
  });

  pi.on("tool_result", (event, ctx) => {
    const state = stateFor(ctx);
    if (!state || unlocked(state) || event.isError) return;
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const target = artifactPath(ctx.cwd, (event.input as { path?: unknown }).path);
    if (!target || !statIfPresent(target)) return;
    const workspace = realpathSync(ctx.cwd);
    const from = relative(workspace, target);
    const name = basename(target);
    const wanted = datedName(name, today());
    if (state.existing.includes(from) || wanted === name) return;
    const destination = join(dirname(target), wanted);
    const to = relative(workspace, destination);
    const text = state.existing.includes(to)
      ? `Left ${from} as named: ${to} already exists from before this stage.`
      : `Renamed ${from} to ${to} to carry today's date; use ${to} from now on.`;
    if (!state.existing.includes(to)) renameSync(target, destination);
    return { content: [...event.content, { type: "text" as const, text }] };
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
    pi.appendEntry<Phase4State>(ENTRY, { ...state, progress });
  });

  // A compaction can drop the execution prompt and the task workflow (2026-11-25 PyCharm run): restate where
  // Pi is. "steer" reaches the next model call of a running turn; when idle it waits for the next prompt.
  // Pi can compact after a run has ended; a steering message then would start a turn by itself.
  let runEnded = false;
  pi.on("agent_start", () => { runEnded = false; });
  pi.on("agent_end", () => { runEnded = true; });

  pi.on("session_compact", (event, ctx) => {
    const state = stateFor(ctx);
    if (state?.status !== "approved" || !state.plan || !statIfPresent(join(ctx.cwd, state.plan))) return;
    const progress = state.progress ?? { started: {}, recorded: [] };
    // A ledger from an earlier rehearsal of the same plan name is not this run's progress.
    const ledger = readLedger(ctx.cwd, state.plan).filter((n) => !(state.staleLedger ?? []).includes(n));
    const recorded = [...new Set([...progress.recorded, ...ledger])];
    const log = state.head ? gitOutput(ctx.cwd, "log", "--oneline", "--reverse", `${state.head}..HEAD`) : undefined;
    const note = planNote(state.plan, planTasks(readFileSync(join(ctx.cwd, state.plan), "utf8")),
      { ...progress, recorded }, scriptsDir(), log ? log.split("\n") : []);
    if (!note) return;
    const deliverAs = runEnded && !event.willRetry ? "nextTurn" : "steer";
    pi.sendMessage({ customType: PLAN_NOTE, content: note, display: true }, { deliverAs });
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "interactive" && event.source !== "rpc") return;
    const text = event.text.trim().replace(/^\/skill:(?:brainstorming|writing-plans|executing-plans)\s+/, "");
    if (/\bbrainstorm\b.*\bPhase 4\b/i.test(text)) {
      pi.appendEntry<Phase4State>(ENTRY, { status: "design", existing: existingArtifacts(ctx.cwd) });
      return;
    }
    if (/\bPhase 4\b.*\b(?:plan|planning)\b|\b(?:plan|planning)\b.*\bPhase 4\b/i.test(text)) {
      pi.appendEntry<Phase4State>(ENTRY, {
        status: "planning", previousPlans: savedPlans(ctx.cwd), existing: existingArtifacts(ctx.cwd),
      });
      return;
    }
    if (/\bfinish Phase 4\b/i.test(text) && stateFor(ctx)?.status === "approved") {
      pi.appendEntry<Phase4State>(ENTRY, { status: "finished" });
      return;
    }
    if (text !== APPROVAL) return;
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
      pi.appendEntry<Phase4State>(ENTRY, {
        status: "approved", plan, progress: { started: {}, recorded: [] },
        head: gitOutput(ctx.cwd, "rev-parse", "HEAD"), staleLedger: readLedger(ctx.cwd, plan),
      });
      approvalNote = true;
      return;
    }
    ctx.ui.notify("Phase 4 is still locked. Approve after Pi has saved its plan and stopped.", "warning");
    return { action: "handled" };
  });

  pi.on("tool_call", (event, ctx) => {
    const state = stateFor(ctx);
    if (!state || unlocked(state) || READ_TOOLS.has(event.toolName)) return;
    if ((event.toolName === "write" || event.toolName === "edit") && artifactPath(ctx.cwd, event.input.path)) return;
    if (event.toolName === "bash" && readOnlyShell(event.input.command)) return;
    const input = event.input as Record<string, unknown>;
    if (state.status === "design") return { block: true, reason: refusal(event.toolName, input, DESIGN_ONLY) };
    // Once a new plan exists, a turn that keeps reaching for code is looping: end it.
    const saved = Object.entries(savedPlans(ctx.cwd)).find(([path, hash]) => hash !== state.previousPlans[path]);
    if (saved) return { block: true, reason: refusal(event.toolName, input, planSaved(saved[0])), terminate: true };
    return { block: true, reason: refusal(event.toolName, input, planOnly(writingPlans)) };
  });
}
