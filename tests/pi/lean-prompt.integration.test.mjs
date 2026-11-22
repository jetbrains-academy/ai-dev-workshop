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
const local = (name) => fileURLToPath(new URL(`../../pi-extensions/${name}`, import.meta.url));
const upstream = path.join(process.env.SUPERPOWERS_DIR, ".pi/extensions/superpowers.ts");
const lean = local("lean-prompt.ts");
const unbootstrap = local("superpowers-unbootstrap.ts");

const sandbox = await mkdtemp(path.join(tmpdir(), "pi-lean-prompt-test-"));
after(() => rm(sandbox, { recursive: true, force: true }));
const cwd = path.join(sandbox, "project");
const agentDir = path.join(sandbox, "agent");
await mkdir(cwd);
await mkdir(agentDir);

const superpowers = sdk.loadSkillsFromDir({ dir: path.join(process.env.SUPERPOWERS_DIR, "skills"), source: "user" }).skills;
const personal = {
  ...superpowers.find((s) => s.name === "brainstorming"),
  name: "personal-skill",
  description: "A skill from somewhere else on this machine",
  filePath: path.join(sandbox, "elsewhere/skills/personal-skill/SKILL.md"),
  baseDir: path.join(sandbox, "elsewhere/skills/personal-skill"),
};

for (const paths of [[unbootstrap, lean, upstream], [upstream, lean, unbootstrap]]) {
  test(`trims the real prompt with ${path.basename(paths[0])} loaded first`, async () => {
    const loaded = await sdk.discoverAndLoadExtensions(paths, cwd, agentDir);
    assert.deepEqual(loaded.errors, []);
    const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
    const errors = [];
    runner.onError((error) => errors.push(error));

    const before = await runner.emitBeforeAgentStart(
      { messageType: "user", prompt: "Use Superpowers to brainstorm Phase 4" },
      { cwd, skills: [personal, ...superpowers], selectedTools: ["read", "bash", "edit", "write", "query_docs", "subagent"] },
    );
    const options = before.systemPromptOptions;
    const catalog = sdk.formatSkillsForPrompt(options.skills);
    assert.doesNotMatch(catalog, /<name>personal-skill<\/name>/);
    assert.doesNotMatch(catalog, /<name>using-superpowers<\/name>/);
    assert.match(catalog, /<name>brainstorming<\/name>/);
    assert.match(catalog, /<name>writing-plans<\/name>/);
    assert.deepEqual(options.selectedTools, ["read", "bash", "edit", "write"]);
    assert.equal(options.promptGuidelines.filter((line) => /subagent-driven-development/.test(line)).length, 1);
    assert.equal(options.skills.length, superpowers.length + 1, "hidden skills stay registered");
    assert.deepEqual(errors, []);
  });
}
