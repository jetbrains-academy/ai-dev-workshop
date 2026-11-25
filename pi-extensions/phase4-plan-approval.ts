import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

type Phase4State = { status: "design" | "approved" } | { status: "planning"; previousPlans: Record<string, string> };

function stateFor(ctx: ExtensionContext): Phase4State | undefined {
  const entry = ctx.sessionManager.getBranch().findLast(
    (entry) => entry.type === "custom" && entry.customType === ENTRY,
  );
  if (entry?.type === "custom") return entry.data as Phase4State;
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

export default function phase4PlanApproval(pi: ExtensionAPI) {
  let writingPlans: string | undefined;
  pi.on("before_agent_start", (event) => {
    writingPlans = event.systemPromptOptions.skills.find((skill) => skill.name === "writing-plans")?.filePath ?? writingPlans;
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "interactive" && event.source !== "rpc") return;
    const text = event.text.trim().replace(/^\/skill:(?:brainstorming|writing-plans|executing-plans)\s+/, "");
    if (/\bbrainstorm\b.*\bPhase 4\b/i.test(text)) {
      pi.appendEntry<Phase4State>(ENTRY, { status: "design" });
      return;
    }
    if (/\bPhase 4\b.*\b(?:plan|planning)\b|\b(?:plan|planning)\b.*\bPhase 4\b/i.test(text)) {
      pi.appendEntry<Phase4State>(ENTRY, { status: "planning", previousPlans: savedPlans(ctx.cwd) });
      return;
    }
    if (text !== APPROVAL) return;
    const state = stateFor(ctx);
    if (!state || state.status === "approved") return;
    if (!event.streamingBehavior && ctx.isIdle() && state.status === "planning"
        && Object.entries(savedPlans(ctx.cwd)).some(([path, hash]) => hash !== state.previousPlans[path])) {
      pi.appendEntry<Phase4State>(ENTRY, { status: "approved" });
      return;
    }
    ctx.ui.notify("Phase 4 is still locked. Approve after Pi has saved its plan and stopped.", "warning");
    return { action: "handled" };
  });

  pi.on("tool_call", (event, ctx) => {
    const state = stateFor(ctx);
    if (!state || state.status === "approved" || READ_TOOLS.has(event.toolName)) return;
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
