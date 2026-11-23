import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Mellum read the project's FastAPI skill in about half the runs. This note rides with the
// Superpowers skill it is following while it plans or executes, so the FastAPI points reach
// the turn where routes and tests are designed. On trial: see pi-extension.md.

export const NOTE_MARKER = "[Project FastAPI notes";

export const FASTAPI_NOTE = "\n" + [
  NOTE_MARKER + " for this plan, from .pi/skills/fastapi/SKILL.md]",
  "- Path parameters use braces and a typed handler argument: `@app.post(\"/items/{item_id}/close\")` with `item_id: int`. FastAPI does not read `<int:item_id>`.",
  "- A POST route that redirects returns `RedirectResponse(url, status_code=303)`; an unknown id raises `HTTPException(status_code=404)`.",
  "- A button that calls a POST route is a `<form method=\"post\" action=\"...\">`; a link sends GET.",
  "- Tests import `TestClient` the way the existing tests do and call `client.post(path, follow_redirects=False)`, then assert the status code and `response.headers[\"location\"]`.",
  "- Pair each unknown-id test with a successful request to the same route, so an unregistered route cannot pass.",
  "- Tests that change shared app state restore it in a pytest fixture, so each test passes alone and in any order.",
  "- Check routes in process with `TestClient`; do not start a server.",
].join("\n");

const PLAN_SKILL = /[\\/](?:writing|executing)-plans[\\/]SKILL\.md$/;

export default function fastapiPlanNote(pi: ExtensionAPI) {
  pi.on("tool_result", (event) => {
    if (event.toolName !== "read" || event.isError) return;
    const path = event.input?.path;
    if (typeof path !== "string" || !PLAN_SKILL.test(path)) return;
    return { content: [...event.content, { type: "text" as const, text: FASTAPI_NOTE }] };
  });
}
