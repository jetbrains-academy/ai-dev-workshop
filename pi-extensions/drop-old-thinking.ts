import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Message = ContextEvent["messages"][number];

// Mellum's chat template drops earlier reasoning only before the latest user message. Executing a
// plan is one user prompt followed by 50 to 150 tool calls, so every step's thinking stayed in
// the prompt: in 20 headless Phase 4 runs on 2026-11-25 it was 47% of what filled the context
// during execution, and the main cause of about two compactions per run. Pi sends past thinking
// back as `reasoning_content`; this drops it from every assistant message but the latest, in the
// request only. The session keeps everything.
export function dropOldThinking(messages: Message[]): Message[] | undefined {
  let latest = -1;
  messages.forEach((message, index) => {
    if (message.role === "assistant") latest = index;
  });
  let changed = false;
  const out = messages.map((message, index) => {
    if (message.role !== "assistant" || index === latest) return message;
    const content = message.content.filter((part) => part.type !== "thinking");
    // A reply that was only thinking keeps it rather than becoming an empty message.
    if (content.length === message.content.length || content.length === 0) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? out : undefined;
}

export default function dropOldThinkingExtension(pi: ExtensionAPI) {
  pi.on("context", (event) => {
    const messages = dropOldThinking(event.messages);
    return messages ? { messages } : undefined;
  });
}
