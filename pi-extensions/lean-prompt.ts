import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// A small local model has a small context window, and every request repeats the skill
// catalog and tool schemas. Advertise only what the workshop flow uses.
const CORE_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

// Characters one shell or search result may add to the context (about 2,000 tokens).
const RESULT_LIMIT = 8000;
const RESULT_HEAD = 6000;
const TRIMMED_TOOLS = new Set(["bash", "grep", "find", "ls"]);

const skillsDir =(skill: { filePath: string }) => path.dirname(path.dirname(skill.filePath));

export default function leanPrompt(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    const options = event.systemPromptOptions;

    // Hidden skills stay in the registry, so an explicit /skill:name still works.
    const superpowersDirs = new Set(options.skills.filter((s) => s.name === "using-superpowers").map(skillsDir));
    if (superpowersDirs.size > 0) {
      options.skills = options.skills.map((skill) =>
        skill.disableModelInvocation || superpowersDirs.has(skillsDir(skill))
          ? skill
          : { ...skill, disableModelInvocation: true },
      );
    }

    const core = options.selectedTools.filter((name) => CORE_TOOLS.has(name));
    if (core.length < options.selectedTools.length) options.selectedTools = core;
  });

  // One `find .` through .venv can return 50 KB. Keep the start and the end, where a
  // listing shows its shape and a test run prints its summary. File reads are left whole.
  pi.on("tool_result", (event) => {
    if (!TRIMMED_TOOLS.has(event.toolName)) return;
    const text = event.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (text.length <= RESULT_LIMIT) return;
    const count = (n: number) => n.toLocaleString("en-US");
    const note =
      `\n\n[trimmed ${count(text.length - RESULT_LIMIT)} of ${count(text.length)} characters here. ` +
      "Narrow the command instead of repeating it: list project files with `git ls-files`.]\n\n";
    return {
      content: [
        { type: "text" as const, text: text.slice(0, RESULT_HEAD) + note + text.slice(RESULT_HEAD - RESULT_LIMIT) },
        ...event.content.filter((part) => part.type !== "text"),
      ],
    };
  });
}
