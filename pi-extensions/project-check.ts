import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { projectConfig, type ProjectConfig } from "./project-config.ts";

// A setup that differs from the project's fails silently. In a 2026-11-26 session Pi believed the model's
// context window was larger than the 60K LM Studio had loaded, so it never compacted: past 59K tokens the
// server dropped context, and the model restarted the design from the first prompt. Thinking was also off,
// because the model entry lacked "reasoning": true. `model` in .pi/project.json names what the project expects.
export function setupWarnings(expected: ProjectConfig["model"],
  actual: { contextWindow?: number; thinkingLevel?: string }): string[] {
  const warnings: string[] = [];
  if (expected?.contextWindow && actual.contextWindow !== undefined && actual.contextWindow !== expected.contextWindow) {
    warnings.push(`Pi uses a ${actual.contextWindow}-token context window for this model, but this project expects ` +
      `${expected.contextWindow}. Pi compacts against its own number, so with a larger window the model server ` +
      `drops context before Pi compacts. Set "contextWindow": ${expected.contextWindow} for the model in ` +
      "~/.pi/agent/models.json (see setup.md) and match it in the model server.");
  }
  if (expected?.thinkingLevel && actual.thinkingLevel && actual.thinkingLevel !== expected.thinkingLevel) {
    warnings.push(`Thinking is "${actual.thinkingLevel}", but this project expects "${expected.thinkingLevel}". ` +
      `Set it with /thinking. If "${expected.thinkingLevel}" is not offered, the model entry in ` +
      '~/.pi/agent/models.json needs "reasoning": true (see setup.md).');
  }
  return warnings;
}

export default function projectCheck(pi: ExtensionAPI) {
  const check = (ctx: ExtensionContext, contextWindow: number | undefined, thinkingLevel: string) => {
    for (const warning of setupWarnings(projectConfig(ctx.cwd).model, { contextWindow, thinkingLevel })) {
      ctx.ui.notify(warning, "warning");
    }
  };
  pi.on("session_start", (_event, ctx) => check(ctx, ctx.model?.contextWindow, pi.getThinkingLevel()));
  pi.on("model_select", (event, ctx) => check(ctx, event.model.contextWindow, pi.getThinkingLevel()));
  pi.on("thinking_level_select", (event, ctx) => check(ctx, ctx.model?.contextWindow, event.level));
}
