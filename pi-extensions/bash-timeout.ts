import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Pi's bash tool has no default timeout, so a command that never returns (a server started
// in the foreground, a prompt waiting for input) holds the turn until someone stops it.
// Nothing in the workshop flow runs for more than a few seconds.
const DEFAULT_SECONDS = 60;
const MAX_SECONDS = 120;

const HINT =
  "\n\n[The command was stopped because it did not finish. A server (`uvicorn`, `python app.py`) " +
  "or a command waiting for input never returns. Check the app through its tests instead.]";

export default function bashTimeout(pi: ExtensionAPI) {
  // Bound the effect instead of recognising the command: any spelling of a server start
  // ends the same way.
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const input = event.input as { timeout?: unknown };
    const asked = typeof input.timeout === "number" && input.timeout > 0 ? input.timeout : DEFAULT_SECONDS;
    input.timeout = Math.min(asked, MAX_SECONDS);
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || !event.isError) return;
    const text = event.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (!/Command timed out after \d+(\.\d+)? seconds/.test(text)) return;
    return { content: [...event.content, { type: "text" as const, text: HINT }] };
  });
}
