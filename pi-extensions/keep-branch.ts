import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export default function keepBranch(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const { command } = event.input as { command?: unknown };
    if (typeof command !== "string" || !changesBranch(command)) return;
    return {
      block: true,
      reason: "Keep the current branch as-is for the workshop. Leave its commits on this branch and report the verification results.",
    };
  });
}
