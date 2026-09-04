import assert from "node:assert/strict";
import test from "node:test";
import { buildLineDiff } from "../web/diff.js";

test("builds an accessible line-level replacement diff", () => {
    assert.deepEqual(buildLineDiff("const value = input;\nreturn value;", "const value = validate(input);\nreturn value;"), [
        { type: "removed", oldLine: 1, newLine: null, text: "const value = input;" },
        { type: "added", oldLine: null, newLine: 1, text: "const value = validate(input);" },
        { type: "context", oldLine: 2, newLine: 2, text: "return value;" },
    ]);
});

test("tracks inserted and removed line numbers independently", () => {
    assert.deepEqual(buildLineDiff("one\ntwo", "zero\none"), [
        { type: "added", oldLine: null, newLine: 1, text: "zero" },
        { type: "context", oldLine: 1, newLine: 2, text: "one" },
        { type: "removed", oldLine: 2, newLine: null, text: "two" },
    ]);
});
