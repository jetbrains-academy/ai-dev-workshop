import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { matchPrompt, phaseHeadingPattern, projectConfig } from "../../pi-extensions/project-config.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("a project without .pi/project.json has an empty config", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-config-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  assert.deepEqual(projectConfig(cwd), {});
});

test("a prompt pattern captures the phase, ignores a /skill: prefix, and needs a repeated {n} to agree", () => {
  const finish = String.raw`^finish Phase {n}\. Mark Phase {n} done\.$`;
  assert.deepEqual(matchPrompt(finish, "finish Phase 5. Mark Phase 5 done."), { phase: 5 });
  assert.deepEqual(matchPrompt(finish, "/skill:finishing-a-development-branch finish Phase 5. Mark Phase 5 done."), { phase: 5 });
  assert.equal(matchPrompt(finish, "finish Phase 5. Mark Phase 6 done."), undefined);
  assert.deepEqual(matchPrompt("^the plan looks good\\.$", "The plan looks good."), { phase: undefined });
  assert.equal(matchPrompt(undefined, "anything"), undefined);
});

test("a phase heading pattern finds one phase or any phase", () => {
  const roadmap = "# Roadmap\n## Phase 3 — Add (Done)\n## Phase 4 — Resolve\n";
  assert.equal(roadmap.match(phaseHeadingPattern("## Phase {n}", 4))[0], "## Phase 4 — Resolve");
  assert.deepEqual([...roadmap.matchAll(phaseHeadingPattern("## Phase {n}"))].map((m) => [m[1], m[0]]), [
    ["3", "## Phase 3 — Add (Done)"], ["4", "## Phase 4 — Resolve"],
  ]);
  assert.equal("## Phase 40 — Later".match(phaseHeadingPattern("## Phase {n}", 4)), null);
});

test("the README's Phase 4 prompts match the shipped config", async () => {
  const config = projectConfig(repo);
  const readme = await readFile(path.join(repo, "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("### Phase 4"));
  const blocks = [...section.matchAll(/```\n([^\n]+)\n```/g)].map((m) => m[1]);
  const find = (word) => blocks.find((block) => block.includes(word));
  assert.deepEqual(matchPrompt(config.prompts.design, find("brainstorm")), { phase: 4 });
  assert.deepEqual(matchPrompt(config.prompts.plan, find("planning")), { phase: 4 });
  assert.ok(matchPrompt(config.prompts.approve, find("native execution")));
  assert.deepEqual(matchPrompt(config.prompts.finish, find("finish Phase")), { phase: 4 });
  assert.equal(matchPrompt(config.prompts.plan, find("Skip the questions")), undefined);
  assert.deepEqual(matchPrompt(config.prompts.plan, "The Phase 4 design looks good. Please proceed with planning."), { phase: 4 });
});

test("the planning prompt matches in either word order, as whole words", () => {
  const { prompts } = projectConfig(repo);
  assert.deepEqual(matchPrompt(prompts.plan, "Write the implementation plan for Phase 4."), { phase: 4 });
  assert.deepEqual(matchPrompt(prompts.plan, "/skill:writing-plans Plan Phase 4 from the design."), { phase: 4 });
  assert.equal(matchPrompt(prompts.plan, "Keep going with the Phase 4 plans."), undefined);
});

test("a prompt can be a list of patterns; the first that matches gives the phase", () => {
  assert.deepEqual(matchPrompt(["^a Phase {n}$", "^Phase {n} b$"], "Phase 7 b"), { phase: 7 });
  assert.equal(matchPrompt(["^a Phase {n}$"], "Phase 7 b"), undefined);
});
