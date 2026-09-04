import assert from "node:assert/strict";
import test from "node:test";
import { validateRepository } from "../github.mjs";

test("accepts GitHub owner/name repository identifiers", () => {
    assert.equal(validateRepository("github/copilot-sdk.js"), "github/copilot-sdk.js");
});

test("rejects repository strings that could become command input", () => {
    assert.throws(() => validateRepository("owner/repo --json secret"), /owner\/name/);
    assert.throws(() => validateRepository("https://github.com/owner/repo"), /owner\/name/);
});
