import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { projectConfig, type ProjectConfig } from "./project-config.ts";

// A small model that is puzzled by an HTTP result starts the app and curls it. A foreground
// start hangs the turn; a background start keeps the port after the turn ends. Either way
// the live server answers differently from the in-process test client it should be using.
// Adapted from mellum-worker's live-server guard. It reads each shell segment's command
// word, so `.venv/bin/uvicorn` and `echo hi && uvicorn` count and `pip show uvicorn` does not.

const HTTP_CLIENTS = new Set(["curl", "wget", "http", "https", "xh"]);
const WRAPPERS = new Set(["nohup", "time", "exec", "env", "command", "sudo", ".", "source"]);
const RUNNERS = new Set(["uv", "poetry", "pdm", "hatch", "pipenv", "rye"]);
const LOOPBACK = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b|\[::1\]/;

const basename = (word: string) => word.slice(word.lastIndexOf("/") + 1);

/** The words of one shell segment from its command word on: wrappers and `VAR=x` dropped. */
function commandWords(segment: string): string[] {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  for (;;) {
    const word = words[i];
    if (word === undefined) break;
    if (/^\w+=/.test(word) || WRAPPERS.has(word)) i += 1;
    else if (RUNNERS.has(word) && words[i + 1] === "run") {
      i += 2;
      while (words[i]?.startsWith("-")) i += 1;
    } else break;
  }
  return words.slice(i);
}

export type Verdict = "server" | "probe" | undefined;

export type Servers = NonNullable<ProjectConfig["servers"]>;

/** Which servers count comes from `servers` in .pi/project.json: command words, `python -m` modules, scripts. */
export function liveServerUse(command: string, servers: Servers | undefined): Verdict {
  if (!servers) return undefined;
  const modules = new Set(servers.modules ?? []);
  const scripts = new Set(servers.scripts ?? []);
  const commands = (servers.commands ?? []).map((entry) => entry.split(/\s+/));
  // Quoted text is data (`python -c "import uvicorn"`, `git commit -m "run uvicorn"`).
  const bare = command.replace(/'[^']*'|"[^"]*"/g, " Q ");
  for (const segment of bare.split(/&&|\|\||[;|&\n()]/)) {
    const [first, ...rest] = commandWords(segment);
    if (first === undefined) continue;
    const name = basename(first);
    if (rest.includes("--version") || rest.includes("--help")) continue;
    if (commands.some(([word, ...args]) => word === name && args.every((arg, index) => rest[index] === arg))) return "server";
    if (/^python\d?(\.\d+)?$/.test(name)) {
      const args = rest.filter((word, index) => !word.startsWith("-") || word === "-m" || rest[index - 1] === "-m");
      if (args[0] === "-m" ? modules.has(args[1] ?? "") : scripts.has(basename(args[0] ?? ""))) return "server";
    }
    if (HTTP_CLIENTS.has(name) && LOOPBACK.test(command)) return "probe";
  }
  return undefined;
}

export default function noLiveServer(pi: ExtensionAPI) {
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = (event.input as { command?: unknown }).command;
    const config = projectConfig(ctx.cwd);
    const verdict = typeof command === "string" ? liveServerUse(command, config.servers) : undefined;
    if (!verdict) return;
    const hint = config.inProcessHint ? ` ${config.inProcessHint}` : "";
    return {
      block: true,
      reason: verdict === "server"
        ? `Blocked: this starts the app as a server, which never returns and keeps its port.${hint}`
        : `Blocked: this calls a local server, and none should be running.${hint}`,
    };
  });
}
