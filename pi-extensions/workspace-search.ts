import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeSearchPath(input: string): string {
  // Match the path spellings accepted by Pi's find and grep tools.
  let path = input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ").replace(/^@/, "");
  if (process.platform === "win32" && !path.includes("\\")) {
    path = path.replace(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i, (_, drive, rest) =>
      `${drive.toUpperCase()}:\\${(rest ?? "").replaceAll("/", "\\")}`);
  }
  if (path === "~") return homedir();
  if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) {
    return join(homedir(), path.slice(2));
  }
  return path.startsWith("file://") ? fileURLToPath(path) : path;
}

const REFUSAL = {
  block: true,
  reason: "Search path must resolve inside the workshop workspace. Retry with `path: \".\"` or an existing repo-relative path.",
};

export default function workspaceSearch(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "find" && event.toolName !== "grep") return;
    const { path } = event.input as { path?: unknown };
    if (path !== undefined && typeof path !== "string") return REFUSAL;

    try {
      const workspace = await realpath(ctx.cwd);
      const target = await realpath(resolve(ctx.cwd, normalizeSearchPath(path || ".")));
      const fromWorkspace = relative(workspace, target);
      if (fromWorkspace === ".." || fromWorkspace.startsWith(`..${sep}`) || isAbsolute(fromWorkspace)) return REFUSAL;
    } catch {
      return REFUSAL;
    }
  });
}
