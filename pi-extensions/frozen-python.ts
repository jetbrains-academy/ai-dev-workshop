import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// The sandboxed shell has no bare `python` on PATH, and `python3` is the system one without the
// project's packages. In 27 headless Phase 4 runs on 2026-11-25, `python: command not found`
// came up 15 times, and one run went on to `pip install fastapi`. A shell segment whose command
// word is python, python3 or python3.N runs through the project's frozen environment instead.
const BARE_PYTHON = /(^|&&|\|\||[;|&(\n])([ \t]*)python(?:3(?:\.\d+)?)?(?=[ \t\n]|$)/g;

export function freezePython(command: string): string {
  return command.replace(BARE_PYTHON, (_match, before: string, space: string) => `${before}${space}uv run --frozen python`);
}

export default function frozenPython(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const input = event.input as { command?: unknown };
    if (typeof input.command !== "string") return;
    const frozen = freezePython(input.command);
    if (frozen !== input.command) input.command = frozen;
  });
}
