import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FIX_FIRST, planWarnings } from "./frozen-pytest-plans.ts";
import { matchPrompt, projectConfig } from "./project-config.ts";

const PLANS = "docs/superpowers/plans";
const ENTRY = "plan-approval";
const TOOLS_BEFORE_DRAFTING = "tools-before-design";
const SAVE_DESIGN = "save_design";
const SAVE_PLAN = "save_plan";
const READ_TOOLS = new Set(["read", "ls", "find", "grep"]);
// Mellum never revised a plan after rereading it (0 of 11 forced rereads, 7-23 s each), so a saved plan ends the turn.
const STOP_FOR_APPROVAL = "Give the plan path and a short summary, then stop for approval.";
// The phase comes from the prompt that started the stage, through the patterns in .pi/project.json.
const label = (phase: number | undefined) => (phase === undefined ? "Plan" : `Phase ${phase}`);
const locked = (phase: number | undefined) => `${label(phase)} approval guard: code edits and commands stay locked ` +
  "until the user approves the plan. Only the user's approval unlocks them; editing design or plan files does not.";
const designOnly = (phase: number | undefined) => locked(phase) +
  " Use `save_design` to save the draft under docs/superpowers/specs/, reply with a short summary, and end your turn for approval.";
const planOnly = (phase: number | undefined, skill: string | undefined) => locked(phase) +
  " This turn only writes the plan. Read the writing-plans skill" + (skill ? ` at ${skill}` : "") +
  ", then use `save_plan` to save it under docs/superpowers/plans/. " + STOP_FOR_APPROVAL;
const planSaved = (phase: number | undefined, path: string) => locked(phase) +
  ` Your plan is saved at ${path}. Use \`save_plan\` for revisions. ` + STOP_FOR_APPROVAL;

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

// Superpowers names files YYYY-MM-DD-<name>.md, but Pi's prompt has no date, so Mellum guessed:
// `phase-4-design.md` and `2026-11-10-phase-4-design.md` on 2026-11-25.
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Each stage hears only its own folder: naming plans/ while brainstorming led Pi to write a plan
// then too (4 of 4 runs, 2026-11-25), and that early plan kept approval locked.
const dateNote = (date: string, stage: "design" | "planning") => stage === "design"
  ? `Today is ${date}. Use \`save_design\` to write docs/superpowers/specs/${date}-<topic>-design.md before asking for approval.`
  : `Today is ${date}. Use \`save_plan\` to write docs/superpowers/plans/${date}-<feature-name>.md.`;

export interface PlanTask { number: number; title: string }
export interface PlanProgress { started: Record<number, { brief: string; base: string }>; recorded: number[] }
/** The phase the plan belongs to and the test command task-done runs, from .pi/project.json. */
export interface NoteContext { phase?: number; test?: string }

// The whole call for one started task. On 2026-11-27, 14 of 36 task-done calls in 5 full runs were malformed:
// the note's `N BASE … TEST_FILES` run as written, or the base left out. The short base is what the ledger shows.
export function taskDoneCommand(scripts: string, plan: string, task: number, base: string, test: string): string {
  return `${scripts}/task-done ${plan} ${task} ${base.slice(0, 7)} -- ${test}`;
}

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
          "do not run task-start again for it." + (context.test ? " Finish it with " +
            `\`${taskDoneCommand(scripts, plan, next.number, started.base, context.test)}\`.` : "")
        : `Next: Task ${next.number}. Start it with \`${scripts}/task-start ${plan} ${next.number}\`.`,
    // "Record it rather than redoing it" let runs record tasks they never worked; the brief check keeps
    // the shortcut for real finished work without inviting that.
    ...(commits.length ? [`Commits since approval: ${commits.join("; ")}. If a task's work is already committed, ` +
      "run task-start for it, check its brief's steps against that commit, do any step that is missing, " +
      "then run task-done."] : []),
    context.test
      ? "Finish each task with the task-done command its task-start result gives."
      : `Finish each task with \`${scripts}/task-done ${plan} N BASE -- TEST_COMMAND\`; ` +
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
  | { status: "planning"; previousPlans: Record<string, string>; repairNudged?: boolean }
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

// The plan saved during this planning stage: the newest new or changed plan, preferring one with tasks.
function freshPlan(cwd: string, state: PlanState | undefined): string | undefined {
  if (state?.status !== "planning") return;
  const fresh = Object.entries(savedPlans(cwd)).filter(([path, hash]) => hash !== state.previousPlans[path]).map(([path]) => path);
  if (!fresh.length) return;
  const withTasks = fresh.filter((path) => planTasks(readFileSync(join(cwd, path), "utf8")).length);
  return (withTasks.length ? withTasks : fresh).reduce((a, b) =>
    (lstatSync(join(cwd, b)).mtimeMs > lstatSync(join(cwd, a)).mtimeMs ? b : a));
}

const PLAN_CHECK = "plan-check";

function planFindings(cwd: string, plan: string): string | undefined {
  const warnings = planWarnings(cwd, projectConfig(cwd), plan, readFileSync(join(cwd, plan), "utf8"));
  return warnings.length ? [`Plan check for ${plan}. ${FIX_FIRST}`, ...warnings].join("\n") : undefined;
}

function statIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function artifactPath(cwd: string, input: unknown, kind?: "specs" | "plans"): string | undefined {
  if (typeof input !== "string" || input.split("/").includes("..")) return;
  const parts = relative(cwd, resolve(cwd, input)).split("/");
  if (parts[0] !== "docs" || parts[1] !== "superpowers" || !["plans", "specs"].includes(parts[2])) return;
  if (kind && parts[2] !== kind) return;
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

const PLAN_NOTE = "plan-note";

const REPORT_AND_STOP = "Report the final review and stop for human verification";
const FINAL_REVIEW_HANDOFF = "Complete the executing-plans final review. " + REPORT_AND_STOP +
  ". The user's finish prompt runs the checks and marks the phase done.";
const ALL_DONE = "Every task in the plan is recorded and the full test suite passes.";

function repoRelativePath(cwd: string, file: string): string | undefined {
  const target = resolve(cwd, file);
  // Superpowers can print the physical path when Pi's cwd uses an alias such as /var.
  return [cwd, realpathSync(cwd)].map((root) => relative(root, target))
    .find((path) => path && !isAbsolute(path) && path.split(sep)[0] !== "..");
}

function finalReviewInstructions(cwd: string, plan: string, base: string | undefined, skill: string | undefined): string {
  if (!base || !skill) return FINAL_REVIEW_HANDOFF;
  const skills = dirname(dirname(skill));
  const script = join(skills, "subagent-driven-development", "scripts", "review-package");
  const reviewerFile = join(skills, "requesting-code-review", "code-reviewer.md");
  const reviewer = repoRelativePath(cwd, reviewerFile) ?? reviewerFile;
  const quote = (arg: string) => "'" + arg.replaceAll("'", "'\"'\"'") + "'";
  return `For the final review, run \`${quote(script)} ${quote(plan)} ${base} HEAD\` from the project root. ` +
    `Use \`read\` on \`${reviewer}\` and the repo-relative diff path in the command result. ` +
    "Include any uncommitted implementation changes in the review. " +
    FINAL_REVIEW_HANDOFF;
}

export function compactionSummary(plan: string, note: string | undefined, status: string,
  fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> }, phase?: number,
  review = FINAL_REVIEW_HANDOFF): string {
  const changed = [...new Set([...fileOps.edited, ...fileOps.written])].sort();
  return [
    `Summary written by the ${phase === undefined ? "" : `Phase ${phase} `}plan guard from its own records (no model summary).`,
    `The user approved the plan ${plan}; you are executing it with the executing-plans skill, one task at a time.`,
    note ?? `Every task in the plan is recorded. Run the full test suite and commit anything left. ${review}`,
    `Uncommitted changes: ${status.trim() ? status.trim().split("\n").join("; ") : "none"}.`,
    `Files read: ${fileOps.read.size ? [...fileOps.read].sort().join(", ") : "none"}.`,
    `Files changed: ${changed.length ? changed.join(", ") : "none"}.`,
    "The latest exchanges follow.",
  ].join("\n");
}

type ContextMessage = ContextEvent["messages"][number];

function adaptBrainstorming(text: string): string {
  // Keep the upstream design checklist and use the workshop's draft-first sequence.
  // Mellum outlines the draft from this list, so the acceptance item goes in it (a separate sentence was skipped in 3 of 4 runs).
  const checklist = text.split(/^## The Written Design$/m)[1]?.split("\n**Where it goes:**")[0].trim()
    .replace(/^- constraints$/m, "- constraints\n- the acceptance criteria, copied verbatim from the input");
  return [
    "# Brainstorming the design draft",
    "Read the roadmap or request as design input, and inspect only the source files needed to understand it.",
    "Compare viable approaches, recommend one, and record any assumptions or open decisions as proposals in the draft.",
    "Use `save_design` to write the Markdown draft under `docs/superpowers/specs/` before asking for approval. " +
      "After the save succeeds, give its path, summarize the recommendation, and stop for the user's approval.",
    "This stage is for design. Planning and implementation start in later turns after their respective approvals.",
    checklist ? `## The Written Design\n\n${checklist}` : undefined,
  ].filter(Boolean).join("\n\n");
}

function adaptExecutingPlans(text: string): string {
  // The pinned skill names the branch-finishing step in the process diagram and in the Finish section.
  return text.replaceAll("Use superpowers:finishing-a-development-branch", REPORT_AND_STOP);
}

function adaptWritingPlans(text: string): string {
  const [guidance] = text.split("\n## Execution Handoff");
  return [
    guidance.trimEnd(),
    "## Execution Handoff",
    "Use `save_plan` to save the plan, and again for any correction. " + STOP_FOR_APPROVAL,
  ].join("\n\n");
}

function projectSkill(messages: ContextMessage[], name: string, path: string,
  adapt: (text: string) => string): ContextMessage[] | undefined {
  const opening = `<skill name="${name}" location="${path}">\n`;
  let changed = false;
  const project = (text: string) => {
    if (!text.startsWith(opening)) return text;
    const end = text.indexOf("\n</skill>");
    if (end < 0) return text;
    const body = text.slice(opening.length, end);
    const adapted = adapt(body);
    changed ||= adapted !== body;
    return opening + adapted + text.slice(end);
  };
  const out = messages.map((message) => message.role !== "user" ? message : {
    ...message,
    content: typeof message.content === "string" ? project(message.content) : message.content.map((part) =>
      part.type === "text" ? { ...part, text: project(part.text) } : part),
  });
  return changed ? out : undefined;
}

export function stubPlanningResults(messages: ContextMessage[], approvedAt: number): ContextMessage[] | undefined {
  let changed = false;
  const out = messages.map((message): ContextMessage => {
    if (message.role !== "toolResult" || typeof message.timestamp !== "number" || message.timestamp >= approvedAt) return message;
    const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    if (text.length < 200) return message;
    changed = true;
    return { ...message, content: [{ type: "text", text: "[planning-stage result omitted after the plan was approved]" }] };
  });
  return changed ? out : undefined;
}

// What task-done runs for a task: the whole suite, so the command has no part left for the model to fill in.
function taskTest(cwd: string): string | undefined {
  const config = projectConfig(cwd);
  return config.testSuite ?? config.pytest;
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


export default async function planApproval(pi: ExtensionAPI) {
  const { Type } = await import("typebox");
  const parameters = Type.Object({
    path: Type.String({ description: "Repo-relative Markdown path in the tool's artifact folder" }),
    content: Type.String({ description: "Complete Markdown draft" }),
  });
  const savers = [
    { name: SAVE_DESIGN, stage: "design", kind: "specs", label: "Save design draft" },
    { name: SAVE_PLAN, stage: "planning", kind: "plans", label: "Save implementation plan" },
  ] as const;
  for (const { name, stage, kind, label: toolLabel } of savers) {
    const folder = "docs/superpowers/" + kind + "/";
    pi.registerTool({
      name,
      label: toolLabel,
      description: toolLabel + " as Markdown under " + folder + ". Pass the complete draft for each revision.",
      defaultActive: false,
      exposure: "model-only",
      parameters,
      async execute(_id, { path, content }, signal, _onUpdate, ctx) {
        if (stateFor(ctx)?.status !== stage) throw new Error(name + " is available only in the " + stage + " stage.");
        const target = artifactPath(ctx.cwd, path, kind);
        if (!target) throw new Error("Choose a Markdown file under " + folder + " without path aliases.");
        if (!content.trim()) throw new Error("Provide a nonempty Markdown draft.");
        signal?.throwIfAborted();
        const directory = dirname(target);
        mkdirSync(directory, { recursive: true });
        // Replace the complete draft in one step so a partial write cannot replace the previous draft.
        const temporary = mkdtempSync(join(directory, ".save-draft-"));
        try {
          const draft = join(temporary, "draft.md");
          writeFileSync(draft, content, "utf8");
          renameSync(draft, target);
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
        const saved = relative(realpathSync(ctx.cwd), target);
        const text = stage === "design" ? "Saved design draft to " + saved + ". Summarize it and stop for approval."
          : "Saved plan to " + saved + ". " + STOP_FOR_APPROVAL;
        return { content: [{ type: "text", text }], details: undefined };
      },
    });
  }

  let brainstorming: string | undefined;
  let writingPlans: string | undefined;
  let datedStage: string | undefined;
  let executingPlans: string | undefined;
  let approvalNote = false;
  const scriptsDir = () => (executingPlans ? join(dirname(executingPlans), "scripts") : "executing-plans/scripts");
  // Every skill read so far, adapted the same way in every later request: in planning the brainstorming skill
  // went back to its 15,530-character upstream text (2026-11-27), which also changed the cached prompt prefix.
  const knownSkills = () => [
    brainstorming && { name: "brainstorming", file: brainstorming, adapt: adaptBrainstorming },
    writingPlans && { name: "writing-plans", file: writingPlans, adapt: adaptWritingPlans },
    executingPlans && { name: "executing-plans", file: executingPlans, adapt: adaptExecutingPlans },
  ].filter((skill) => !!skill);
  const stageSkill = (state: PlanState | undefined) => {
    if (state?.status === "design" && brainstorming) return { name: "brainstorming", file: brainstorming, adapt: adaptBrainstorming };
    if (state?.status === "planning" && writingPlans) return { name: "writing-plans", file: writingPlans, adapt: adaptWritingPlans };
    if (state?.status === "approved" && executingPlans) return { name: "executing-plans", file: executingPlans, adapt: adaptExecutingPlans };
  };
  pi.on("before_agent_start", (event, ctx) => {
    brainstorming = event.systemPromptOptions.skills.find((skill) => skill.name === "brainstorming")?.filePath ?? brainstorming;
    writingPlans = event.systemPromptOptions.skills.find((skill) => skill.name === "writing-plans")?.filePath ?? writingPlans;
    executingPlans = event.systemPromptOptions.skills.find((skill) => skill.name === "executing-plans")?.filePath ?? executingPlans;
    const entry = stateEntry(ctx);
    const state = entry?.data as PlanState | undefined;
    if (state) {
      const active = pi.getActiveTools();
      const alreadyDrafting = active.includes(SAVE_DESIGN) || active.includes(SAVE_PLAN);
      if (state.status === "design" || state.status === "planning") {
        const saver = state.status === "design" ? SAVE_DESIGN : SAVE_PLAN;
        if (!alreadyDrafting) pi.appendEntry(TOOLS_BEFORE_DRAFTING, active);
        pi.setActiveTools([...active.filter((name) => READ_TOOLS.has(name)), saver]);
      } else if (alreadyDrafting) {
        // Pi also restores its last tool set when the session is reopened.
        const previous = ctx.sessionManager.getBranch().findLast(
          (item) => item.type === "custom" && item.customType === TOOLS_BEFORE_DRAFTING,
        );
        pi.setActiveTools(previous?.type === "custom" ? previous.data as string[]
          : active.filter((name) => name !== SAVE_DESIGN && name !== SAVE_PLAN));
      }
    }
    if (approvalNote) {
      approvalNote = false;
      if (state?.status !== "approved" || !state.plan) return;
      const note = planNote(state.plan, planTasks(readFileSync(join(ctx.cwd, state.plan), "utf8")),
        state.progress ?? { started: {}, recorded: [] }, scriptsDir(), [],
        { phase: state.phase, test: taskTest(ctx.cwd) });
      if (note) return { message: { customType: PLAN_NOTE, content: note, display: true } };
      return;
    }
    if (!entry || !state || unlocked(state) || entry.id === datedStage) return;
    datedStage = entry.id;
    // A repair prompt continues planning with a plan already saved. In both 2026-11-27 repair turns the re-attached
    // date and guidance note came last, and Mellum answered it ("update the plan to incorporate FastAPI testing
    // guidance") instead of the request, so a repair gets no note. Plan-check findings come once, at settle.
    if (freshPlan(ctx.cwd, state)) return;
    let content = dateNote(today(), state.status);
    const skill = state.status === "planning" ? projectConfig(ctx.cwd).planningSkill : undefined;
    if (skill) {
      try {
        const path = join(ctx.cwd, skill);
        if (!lstatSync(path).isFile()) throw new Error("Expected a regular file");
        content += `\n\nUse this project guidance while writing the plan (${skill}).\n\n${readFileSync(path, "utf8").trim()}`;
      } catch (error) {
        const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "is missing" : "could not be read";
        content += `\n\nWarning: Planning skill \`${skill}\` ${reason}. Continue planning with the available instructions.`;
      }
    }
    return { message: { customType: "plan-date", content, display: true } };
  });

  // Track executing-plans' own scripts from their results: a printed brief and base start a task, a
  // printed ledger line records it. Kept in session entries, since the workspace can be deleted.
  pi.on("tool_result", (event, ctx) => {
    const state = stateFor(ctx);
    if (event.isError) return;
    if (event.toolName === "read" && typeof event.input.path === "string") {
      const file = resolve(ctx.cwd, event.input.path);
      const skill = stageSkill(state);
      if (skill?.file === file) return { content: event.content.map((part) => part.type === "text"
        ? { ...part, text: skill.adapt(part.text) } : part) };
    }
    if (state?.status !== "approved" || !state.plan || event.toolName !== "bash") return;
    const command = (event.input as { command?: unknown }).command;
    if (typeof command !== "string") return;
    if (/(?:^|\/)review-package['"]?(?:\s|$)/.test(command)) {
      return { content: event.content.map((part) => {
        if (part.type !== "text") return part;
        const text = part.text.replace(/^wrote (.+\.diff): (\d+ commit\(s\), \d+ bytes)$/m, (line, file, stats) => {
          const diff = repoRelativePath(ctx.cwd, file);
          return diff ? `wrote ${diff}: ${stats}\nUse \`read\` with the repo-relative path \`${diff}\`.` : line;
        });
        return { ...part, text };
      }) };
    }
    const script = command.match(/executing-plans\/scripts\/(task-start|task-done)\s+(\S+)\s+(\d+)\b/);
    if (!script || resolve(ctx.cwd, script[2]) !== resolve(ctx.cwd, state.plan)) return;
    const text = event.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
    const n = Number(script[3]);
    const progress = structuredClone(state.progress ?? { started: {}, recorded: [] });
    let finish: string | undefined;
    if (script[1] === "task-start") {
      const brief = text.match(/^brief: (.+)$/m)?.[1];
      const base = text.match(/^base: (\S+)$/m)?.[1];
      if (!brief || !base) return;
      progress.started[n] = { brief: brief.trim(), base };
      const test = taskTest(ctx.cwd);
      if (test) finish = `Finish Task ${n} with \`${taskDoneCommand(scriptsDir(), state.plan, n, base, test)}\`.`;
    } else {
      if (!new RegExp(`^ledger: Task ${n}: complete\\b`, "m").test(text) || progress.recorded.includes(n)) return;
      progress.recorded.push(n);
    }
    pi.appendEntry<PlanState>(ENTRY, { ...state, progress });
    if (finish) return { content: [...event.content, { type: "text", text: finish }] };
    if (script[1] === "task-done") {
      const tasks = planTasks(readFileSync(join(ctx.cwd, state.plan), "utf8"));
      if (tasks.length && tasks.every((task) => progress.recorded.includes(task.number)) && suitePasses(ctx.cwd)) {
        const review = finalReviewInstructions(ctx.cwd, state.plan, state.head, executingPlans);
        return { content: [...event.content, { type: "text", text: `${ALL_DONE}\n${review}` }] };
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
      { phase: state.phase, test: taskTest(ctx.cwd) });
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
      event.preparation.fileOps, state.phase, finalReviewInstructions(ctx.cwd, state.plan, state.head, executingPlans));
    return { compaction: { summary, firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore } };
  });

  // Planning-stage tool results (skill text, file reads) are 10 to 14K tokens of a 60K window when
  // execution starts. After approval each is replaced by a stub in the request; the call and its
  // result keep their place, so the conversation stays well formed.
  pi.on("context", (event, ctx) => {
    const state = stateFor(ctx);
    let messages = state?.status === "approved" && state.approvedAt ? stubPlanningResults(event.messages, state.approvedAt) : undefined;
    for (const skill of knownSkills()) {
      messages = projectSkill(messages ?? event.messages, skill.name, skill.file, skill.adapt) ?? messages;
    }
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
      // A repair prompt ("Reread the saved Phase 4 plan…") also matches. Keep the baseline from when planning
      // began, so a plan saved earlier in this stage stays approvable even if the repair saves nothing new.
      const current = stateFor(ctx);
      const continuing = current?.status === "planning" && current.phase === planning ? current : undefined;
      pi.appendEntry<PlanState>(ENTRY, {
        status: "planning", phase: planning, previousPlans: continuing?.previousPlans ?? savedPlans(ctx.cwd),
        ...(continuing?.repairNudged ? { repairNudged: true } : {}),
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
    const plan = freshPlan(ctx.cwd, state);
    if (!event.streamingBehavior && ctx.isIdle() && plan) {
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

  // Planning ends with Mellum's reply. If the saved plan still has a mechanical finding, Pi makes one more request,
  // with the findings as its last message (Mellum answers the last message, not one inside a tool result: 0 of 7
  // rereads revised a plan). Once per planning stage; after that the presenter sees the findings instead.
  pi.on("agent_before_settle", (event, ctx) => {
    const state = stateFor(ctx);
    if (state?.status !== "planning" || event.outcome !== "completed") return;
    const plan = freshPlan(ctx.cwd, state);
    const findings = plan && planFindings(ctx.cwd, plan);
    if (!findings) return;
    if (state.repairNudged) {
      ctx.ui.notify(findings, "warning");
      return;
    }
    return {
      entries: [...event.entries,
        { type: "custom", customType: ENTRY, data: { ...state, repairNudged: true } },
        { type: "custom_message", customType: PLAN_CHECK, content: findings, display: true }],
      continue: true,
    };
  });

  pi.on("tool_call", (event, ctx) => {
    const state = stateFor(ctx);
    if (!state || unlocked(state) || READ_TOOLS.has(event.toolName)) return;
    const input = event.input as Record<string, unknown>;
    if (state.status === "design") {
      if (event.toolName === SAVE_DESIGN) return;
      return { block: true, reason: `${blockedCall(event.toolName, input)} ${designOnly(state.phase)}` };
    }
    if (event.toolName === SAVE_PLAN) return;
    const saved = Object.entries(savedPlans(ctx.cwd)).find(([path, hash]) => hash !== state.previousPlans[path]);
    const guidance = saved ? planSaved(state.phase, saved[0]) : planOnly(state.phase, writingPlans);
    return { block: true, reason: `${blockedCall(event.toolName, input)} ${guidance}` };
  });
}
