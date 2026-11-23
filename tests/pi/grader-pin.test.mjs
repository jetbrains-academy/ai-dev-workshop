import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { GRADER_SHA256 } from "../../pi-extensions/keep-branch.ts";

test("keep-branch pins the grader that ships with the workshop", async () => {
  const grader = await readFile(new URL("../phase4_acceptance.py", import.meta.url));
  assert.equal(createHash("sha256").update(grader).digest("hex"), GRADER_SHA256);
});
