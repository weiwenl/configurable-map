import test from "node:test";
import assert from "node:assert/strict";
import { applySymbologyDraft, validateSymbology } from "../src/symbology.ts";

const draft = { lowColor: "#ffffff", highColor: "#00fd00", lowSize: "5", highSize: "40" };

test("valid edits produce the existing fields and ordered data stops", () => {
  const result = validateSymbology({ ...draft, highColor: "#Aa00ff", lowSize: "2.5", highSize: "60" });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.symbolConfig, {
    color: { field: "Leaf_Area", stops: [{ value: 10, color: "#ffffff" }, { value: 40000, color: "#Aa00ff" }] },
    size: { field: "Leaf_Bmass", stops: [{ value: 0, size: 2.5 }, { value: 700, size: 60 }] },
  });
});

test("boundary, equal and inverse output sizes are accepted", () => {
  for (const [lowSize, highSize] of [["1", "100"], ["100", "1"], ["10", "10"]]) {
    const result = validateSymbology({ ...draft, lowSize, highSize });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.symbolConfig.size.stops.map(stop => stop.size), [Number(lowSize), Number(highSize)]);
  }
});

test("decimal and scientific notation sizes are parsed as numbers", () => {
  const result = validateSymbology({ ...draft, lowSize: " 2.5 ", highSize: "1e2" });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.symbolConfig.size.stops.map(stop => stop.size), [2.5, 100]);
});

for (const invalidSize of ["", " ", "abc", "NaN", "Infinity", "-Infinity", "1e309", "0x10", "0", "-1", "0.5", "100.01"]) {
  test(`invalid size ${JSON.stringify(invalidSize)} is rejected at either endpoint`, () => {
    for (const key of ["lowSize", "highSize"]) {
      const result = validateSymbology({ ...draft, [key]: invalidSize });
      assert.ok(result.error);
      assert.equal(result.symbolConfig, undefined);
    }
  });
}

test("only six-digit hexadecimal colours are accepted at either endpoint", () => {
  for (const invalidColor of ["", "red", "#fff", "#12345g", "#12345678", " #123456"]) {
    for (const key of ["lowColor", "highColor"]) {
      const result = validateSymbology({ ...draft, [key]: invalidColor });
      assert.ok(result.error);
      assert.equal(result.symbolConfig, undefined);
    }
  }
});

test("validation preserves input and each result is independent", () => {
  const input = Object.freeze({ ...draft });
  const first = validateSymbology(input);
  first.symbolConfig.size.stops[0].size = 99;
  const second = validateSymbology(input);
  assert.equal(second.symbolConfig.size.stops[0].size, 5);
  assert.deepEqual(input, draft);
  const invalid = Object.freeze({ ...draft, lowSize: "" });
  assert.ok(validateSymbology(invalid).error);
  assert.equal(invalid.lowSize, "");
});

test("invalid draft preserves applied settings and does not call the renderer", () => {
  const invalid = { ...draft, lowSize: "" };
  const result = applySymbologyDraft(invalid, draft, () => assert.fail("must not render"));
  assert.ok(result.error);
  assert.equal(result.appliedDraft, draft);
  assert.equal(invalid.lowSize, "");
});

test("repeated edits apply the latest draft without changing earlier settings", () => {
  const first = { ...draft, highColor: "#800080" };
  const renders = [];
  const applied = applySymbologyDraft(first, draft, symbols => renders.push(symbols));
  assert.equal(applied.error, null);
  assert.deepEqual(applied.appliedDraft, first);
  assert.notEqual(applied.appliedDraft, first);
  const second = { ...first, lowSize: "30", highSize: "4" };
  assert.equal(applied.appliedDraft.lowSize, "5");
  const reapplied = applySymbologyDraft(second, applied.appliedDraft, symbols => renders.push(symbols));
  assert.equal(reapplied.error, null);
  assert.deepEqual(reapplied.appliedDraft, second);
  assert.equal(renders.length, 2);
  assert.deepEqual(renders[1].size.stops.map(stop => stop.size), [30, 4]);
  assert.equal(draft.highColor, "#00fd00");
});

test("renderer failure retains applied state and allows retrying the same draft", () => {
  const edited = { ...draft, highSize: "80" };
  const failed = applySymbologyDraft(edited, draft, () => { throw new Error("renderer unavailable"); });
  assert.ok(failed.error);
  assert.equal(failed.appliedDraft, draft);
  assert.equal(edited.highSize, "80");
  const retried = applySymbologyDraft(edited, failed.appliedDraft, () => {});
  assert.equal(retried.error, null);
  assert.deepEqual(retried.appliedDraft, edited);
});
