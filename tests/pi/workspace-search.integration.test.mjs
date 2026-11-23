import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.env.PI_PACKAGE_DIR) throw new Error("Set PI_PACKAGE_DIR as shown in pi-extension.md.");
const sdk = await import(pathToFileURL(path.join(process.env.PI_PACKAGE_DIR, "dist/index.js")).href);
const settingsPath = new URL("../../.pi/settings.json", import.meta.url);
const settings = JSON.parse(await readFile(settingsPath, "utf8"));

const sandbox = await mkdtemp(path.join(tmpdir(), "pi-workspace-search-"));
after(() => rm(sandbox, { recursive: true, force: true }));
const cwd = path.join(sandbox, "workshop");
const sibling = path.join(sandbox, "workshop-other");
const agentDir = path.join(sandbox, "agent");
await mkdir(path.join(cwd, "specs"), { recursive: true });
await mkdir(sibling);
await mkdir(agentDir);
await writeFile(path.join(cwd, "specs", "roadmap.md"), "Phase 4 acceptance criteria\n");
await writeFile(path.join(sibling, "outside.md"), "Outside content\n");
await symlink(sibling, path.join(cwd, "outside"));
await symlink(path.join(sibling, "outside.md"), path.join(cwd, "outside.md"));
await symlink(path.join(cwd, "specs"), path.join(cwd, "local-specs"));

async function setup() {
  const extensions = settings.extensions.map((entry) => fileURLToPath(new URL(entry, settingsPath)));
  const loaded = await sdk.discoverAndLoadExtensions(extensions, cwd, agentDir);
  assert.deepEqual(loaded.errors, []);
  const runner = new sdk.ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sdk.SessionManager.inMemory(cwd), undefined);
  return (toolName, input) => runner.emitToolCall({ type: "tool_call", toolCallId: "search", toolName, input });
}

test("blocks search roots outside the workspace", async () => {
  const call = await setup();
  for (const toolName of ["find", "grep"]) {
    for (const searchPath of ["/", "/Users", "..", "../workshop-other", sibling, "outside", "outside.md", "~", "@/", "file:///"]) {
      const decision = await call(toolName, { pattern: "roadmap", path: searchPath });
      assert.equal(decision?.block, true, `${toolName} must block ${searchPath}`);
      assert.match(decision.reason, /workspace/);
    }
  }
});

test("allows default, relative, absolute, and in-workspace symlink paths", async () => {
  const call = await setup();
  for (const toolName of ["find", "grep"]) {
    for (const searchPath of [undefined, ".", "specs", path.join(cwd, "specs"), "local-specs"]) {
      assert.equal((await call(toolName, { pattern: "roadmap", path: searchPath }))?.block, undefined, `${toolName} must allow ${searchPath}`);
    }
  }
});

test("runs real in-workspace find and grep queries after the guard allows them", async () => {
  const call = await setup();
  const find = { pattern: "roadmap.md", path: "specs" };
  const grep = { pattern: "Phase 4", path: "specs/roadmap.md", literal: true };
  assert.equal((await call("find", find))?.block, undefined);
  assert.equal((await call("grep", grep))?.block, undefined);
  const found = await sdk.createFindTool(cwd).execute("search", find);
  const matched = await sdk.createGrepTool(cwd).execute("search", grep);
  assert.match(found.content[0].text, /roadmap\.md/);
  assert.match(matched.content[0].text, /roadmap\.md:1: Phase 4 acceptance criteria/);
});
