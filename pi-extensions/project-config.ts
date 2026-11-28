import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Everything the extensions know about this project, its stack and its prompts lives in .pi/project.json,
// so no extension carries text written for one project or one phase. A missing key turns that feature off.
export interface ProjectConfig {
  roadmap?: string;
  /** A roadmap heading, with {n} for the phase number: "## Phase {n}". */
  phaseHeading?: string;
  /** Case-insensitive regular expressions searched in a typed prompt; {n} captures the phase number. A list
   * holds alternatives, each with its own {n}, such as two word orders. */
  prompts?: { design?: Pattern; plan?: Pattern; approve?: Pattern; finish?: Pattern };
  /** Project-relative skill file to attach when planning starts. */
  planningSkill?: string;
  python?: string;
  pytest?: string;
  testSuite?: string;
  /** Git pathspecs of the files that make up the implementation. */
  implementation?: string[];
  servers?: { commands?: string[]; modules?: string[]; scripts?: string[] };
  inProcessHint?: string;
  shellLimitSeconds?: number;
  model?: { contextWindow?: number; thinkingLevel?: string };
}

export type Pattern = string | string[];

export const CONFIG_FILE = ".pi/project.json";

export function projectConfig(cwd: string): ProjectConfig {
  const path = join(cwd, CONFIG_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ProjectConfig : {};
}

/** Implementation files (the config's pathspecs) that are modified, staged or untracked: work no commit holds. */
export function uncommittedImplementation(cwd: string, pathspecs: string[] | undefined): string[] {
  if (!pathspecs?.length) return [];
  try {
    const status = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...pathspecs],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    // Each entry is "XY path"; a rename is followed by its old path as a separate entry with no status.
    const entries = status.split("\0").filter(Boolean);
    const paths: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      paths.push(entries[i].slice(3));
      if (/^[RC]/.test(entries[i])) i++;
    }
    return [...new Set(paths)].sort();
  } catch {
    return [];
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Match a typed prompt, without a leading `/skill:<name> `, against a config pattern. */
export function matchPrompt(pattern: Pattern | undefined, text: string): { phase: number | undefined } | undefined {
  if (!pattern) return;
  if (Array.isArray(pattern)) {
    for (const each of pattern) {
      const match = matchPrompt(each, text);
      if (match) return match;
    }
    return;
  }
  let first = true;
  const source = pattern.replaceAll("{n}", () => {
    const group = first ? "(?<n>\\d+)" : "\\k<n>";
    first = false;
    return group;
  });
  const match = text.trim().replace(/^\/skill:[\w:-]+\s+/, "").match(new RegExp(source, "i"));
  if (!match) return;
  return { phase: match.groups?.n === undefined ? undefined : Number(match.groups.n) };
}

/** The roadmap heading of phase `n`, or of any phase (number in group 1) when `n` is omitted. */
export function phaseHeadingPattern(template: string, n?: number): RegExp {
  const number = n === undefined ? "(\\d+)" : String(n);
  return new RegExp(`^${escape(template).replaceAll("\\{n\\}", number)}(?!\\d)[^\\r\\n]*`, n === undefined ? "gm" : "m");
}
