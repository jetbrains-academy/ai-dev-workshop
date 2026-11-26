import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const name of ["PI_PACKAGE_DIR", "SUPERPOWERS_DIR"]) {
  if (!process.env[name]) throw new Error(`Set ${name} to the installed package directory; see pi-extension.md.`);
}
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const upstream = path.join(process.env.SUPERPOWERS_DIR, ".pi/extensions/superpowers.ts");
const local = fileURLToPath(new URL("../../pi-extensions/superpowers-unbootstrap.ts", import.meta.url));
const sandbox = await mkdtemp(path.join(tmpdir(), "pi-unbootstrap-test-"));
after(() => rm(sandbox, { recursive: true, force: true }));
const cwd = path.join(sandbox, "project");
const agentDir = path.join(sandbox, "agent");
await mkdir(cwd);
await mkdir(agentDir);
const HIDDEN = new Set(["using-superpowers", "subagent-driven-development", "dispatching-parallel-agents",
  "using-git-worktrees", "finishing-a-development-branch"]);
const registry = sdk.loadSkillsFromDir({ dir: path.join(process.env.SUPERPOWERS_DIR, "skills"), source: "user" }).skills;
assert.ok(registry.some(s => s.name === "using-superpowers"));

const user = (text) => ({ role: "user", content: [{ type: "text", text }], timestamp: 100 });
const head = {
  role: "system",
  content: "Keep the prompt and declared tools.",
  toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
  timestamp: 1,
};

async function setup(paths, request = user("What is 2 + 2?")) {
  const loaded = await sdk.discoverAndLoadExtensions(paths, cwd, agentDir);
  assert.deepEqual(loaded.errors, []);
  const session = sdk.SessionManager.inMemory(cwd);
  session.appendMessage(request);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, session, undefined);
  const errors = [];
  runner.onError(error => errors.push(error));
  return { runner, session, errors, messages: [head, request] };
}

async function actualBootstrap() {
  const { runner, messages, errors } = await setup([upstream]);
  const result = await runner.emitContext(messages);
  assert.equal(result.length, 3, "the baseline must actually inject a bootstrap");
  assert.match(result[1].content[0].text, /^<EXTREMELY_IMPORTANT>\nsuperpowers:using-superpowers bootstrap for pi\n/);
  assert.deepEqual(errors, []);
  return result[1];
}

for (const paths of [[local, upstream], [upstream, local]]) {
  test(`filters the actual injector and automatic catalog with ${paths[0] === local ? "local" : "upstream"} loaded first`, async () => {
    await actualBootstrap();
    const { runner, session, errors, messages } = await setup(paths);
    const history = structuredClone(session.getEntries());
    const before = await runner.emitBeforeAgentStart(
      { messageType: "user", prompt: "What is 2 + 2?" },
      { cwd, skills: registry, selectedTools: ["read"] },
    );
    const catalog = sdk.formatSkillsForPrompt(before.systemPromptOptions.skills);
    assert.doesNotMatch(catalog, /<name>using-superpowers<\/name>/);
    assert.match(catalog, /<name>systematic-debugging<\/name>/);
    assert.match(catalog, /<name>brainstorming<\/name>/);
    assert.deepEqual(before.systemPromptOptions.skills.filter(s => !s.disableModelInvocation).map(s => s.name),
      registry.filter(s => !s.disableModelInvocation && !HIDDEN.has(s.name)).map(s => s.name));
    assert.equal(registry.find(s => s.name === "using-superpowers").disableModelInvocation, false);

    assert.deepEqual(await runner.emitContext(messages), messages);
    assert.deepEqual(await runner.emitContext(messages), messages);
    await runner.emit({ type: "agent_end", messages: [] });
    assert.deepEqual(await runner.emitContext(messages), messages);
    assert.deepEqual(session.getEntries(), history);

    session.appendMessage(head);
    const retained = user("A follow-up question after compaction");
    const retainedId = session.appendMessage(retained);
    const compactionId = session.appendCompaction("The previous question was about arithmetic.", retainedId, 1000);
    const compactionEntry = session.getEntry(compactionId);
    const compacted = session.buildSessionProjection().messages;
    const compactedHistory = structuredClone(session.getEntries());
    assert.equal(compacted[0].role, "system");
    assert.equal(compacted[1].role, "compactionSummary");
    assert.deepEqual(compacted.at(-1), retained);

    const baseline = await setup([upstream]);
    await baseline.runner.emit({ type: "agent_end", messages: [] });
    await baseline.runner.emit({ type: "session_compact", compactionEntry, fromExtension: false });
    assert.equal((await baseline.runner.emitContext(compacted)).length, compacted.length + 1,
      "the baseline must actually reinject into the compacted transcript");

    await runner.emit({ type: "session_compact", compactionEntry, fromExtension: false });
    assert.deepEqual(await runner.emitContext(compacted), compacted);
    assert.deepEqual(session.getEntries(), compactedHistory);
    assert.deepEqual(baseline.errors, []);
    assert.deepEqual(errors, []);
  });
}

test("preserves an actual bootstrap pasted by the user", async () => {
  const request = await actualBootstrap();
  const { runner, session, messages, errors } = await setup([local, upstream], request);
  assert.deepEqual(await runner.emitContext(messages), messages);
  assert.deepEqual(session.buildSessionProjection().messages, [request]);
  assert.deepEqual(errors, []);
});

test("Pi reports a projection error and retains the unfiltered context", async () => {
  const { runner, session, messages, errors } = await setup([upstream, local]);
  session.buildSessionProjection = () => { throw new Error("session unavailable"); };
  const original = structuredClone(messages);
  const result = await runner.emitContext(messages);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], head);
  assert.deepEqual(result[2], messages[1]);
  assert.deepEqual(messages, original);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].event, "context_with_system");
  assert.match(errors[0].error, /session unavailable/);
});
