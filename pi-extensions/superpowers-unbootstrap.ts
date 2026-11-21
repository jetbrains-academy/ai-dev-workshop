import type { ContextWithSystemEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BOOTSTRAP_PREFIX = `<EXTREMELY_IMPORTANT>
superpowers:using-superpowers bootstrap for pi

You have superpowers.

The using-superpowers skill content is included below and is already loaded for this Pi session. Follow it now. Do not try to load using-superpowers again.

`;

type Message = ContextWithSystemEvent["messages"][number];

function standaloneUserText(message: Message): string | undefined {
  if (message.role !== "user") return;
  if (typeof message.content === "string") return message.content;
  if (message.content.length === 1 && message.content[0].type === "text") {
    return message.content[0].text;
  }
}

export default function superpowersUnbootstrap(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    // Change the prompt copy only; the registry still supports explicit invocation.
    event.systemPromptOptions.skills = event.systemPromptOptions.skills.map((skill) =>
      skill.name === "using-superpowers" ? { ...skill, disableModelInvocation: true } : skill,
    );
  });

  pi.on("context_with_system", (event, ctx) => {
    const candidates = event.messages.flatMap((message) => {
      const text = standaloneUserText(message);
      return text?.startsWith(BOOTSTRAP_PREFIX)
        && text.includes("\n\n## Pi tool mapping\n\n")
        && text.endsWith("\n</EXTREMELY_IMPORTANT>")
        ? [{ message, text }]
        : [];
    });
    if (candidates.length === 0) return;

    // The upstream context injection is request-local, never part of this projection.
    // If a real user supplied the same text, prefer retaining it over removing it.
    const persistedText = new Set(ctx.sessionManager.buildSessionProjection().messages.map(standaloneUserText));
    const removable = new Set(candidates.filter(({ text }) => !persistedText.has(text)).map(({ message }) => message));
    if (removable.size === 0) return;

    return { messages: event.messages.filter((message) => !removable.has(message)) };
  });
}
