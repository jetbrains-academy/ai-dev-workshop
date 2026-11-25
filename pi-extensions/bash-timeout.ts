import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Pi's bash tool has no default timeout, so a command that never returns (a server started
// in the foreground, a search of the whole disk) holds the turn until it ends. In 12 headless
// Phase 4 runs on 2026-11-25 the longest ordinary command took 11.5 seconds; the only ones
// over 12 were three `find /` or `find /Users` searches of 2 to 7 minutes.
const LIMIT_SECONDS = 30;

const HINT =
  "\n\n[The command was stopped after 30 seconds; nothing in this workshop takes that long. " +
  "Search inside the project, not the whole disk. The executing-plans scripts are at the full path " +
  "given in the Phase 4 plan note. A server or a command waiting for input never returns: " +
  "check the app through its tests instead.]";

export default function bashTimeout(pi: ExtensionAPI) {
  // Bound the effect instead of recognising the command: any spelling ends the same way.
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const input = event.input as { timeout?: unknown };
    const asked = typeof input.timeout === "number" && input.timeout > 0 ? input.timeout : LIMIT_SECONDS;
    input.timeout = Math.min(asked, LIMIT_SECONDS);
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || !event.isError) return;
    const text = event.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (!/Command timed out after \d+(\.\d+)? seconds/.test(text)) return;
    return { content: [...event.content, { type: "text" as const, text: HINT }] };
  });
}
