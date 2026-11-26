import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { projectConfig } from "./project-config.ts";

// Pi's bash tool has no default timeout, so a command that never returns (a server started
// in the foreground, a search of the whole disk) holds the turn until it ends. In 16 headless
// Phase 4 runs on 2026-11-25, 99% of shell commands took about a second and the slowest
// ordinary one (task-done) 1.2 seconds; every call over 10 seconds was a search, the worst
// three `find /` or `find /Users` of 2 to 7 minutes.
// The limit is `shellLimitSeconds` in .pi/project.json; without it this extension does nothing.

// Both slow searches came from a wrong belief, not a lost path: one run distrusted the scripts'
// path because it is outside the project, the other looked for a file its plan named but never
// created. The hint answers those beliefs.
const hint = (seconds: number) =>
  `\n\n[The command was stopped after ${seconds} seconds; nothing in this project takes that long. ` +
  "Search inside the project, not the whole disk. The task scripts are installed outside the project " +
  "on purpose; the path in the plan note is correct, run it as written. A file the plan names that is " +
  "not in the project does not exist yet: create it. A server or a command waiting for input never " +
  "returns: check the app through its tests instead.]";

export default function bashTimeout(pi: ExtensionAPI) {
  // Bound the effect instead of recognising the command: any spelling ends the same way.
  pi.on("tool_call", (event, ctx) => {
    const limit = projectConfig(ctx.cwd).shellLimitSeconds;
    if (event.toolName !== "bash" || !limit) return;
    const input = event.input as { timeout?: unknown };
    const asked = typeof input.timeout === "number" && input.timeout > 0 ? input.timeout : limit;
    input.timeout = Math.min(asked, limit);
  });

  pi.on("tool_result", (event, ctx) => {
    const limit = projectConfig(ctx.cwd).shellLimitSeconds;
    if (event.toolName !== "bash" || !event.isError || !limit) return;
    const text = event.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (!/Command timed out after \d+(\.\d+)? seconds/.test(text)) return;
    return { content: [...event.content, { type: "text" as const, text: hint(limit) }] };
  });
}
