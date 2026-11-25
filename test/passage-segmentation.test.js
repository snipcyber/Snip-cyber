import test from "node:test";
import assert from "node:assert/strict";
import { splitIntoPassages } from "../api/passage-segmentation.js";

test("splits English sentences when the next sentence starts lowercase", () => {
  assert.deepEqual(
    splitIntoPassages("Revenue increased by 4%. operating profit fell by 2%."),
    ["Revenue increased by 4%.", "operating profit fell by 2%."]
  );
});

test("segments non-Latin sentences and keeps their original wording", () => {
  assert.deepEqual(
    splitIntoPassages("第一句。第二句！第三句？"),
    ["第一句。", "第二句！", "第三句？"]
  );
});

test("does not split decimal numbers and keeps an unterminated final sentence", () => {
  assert.deepEqual(
    splitIntoPassages("The margin was 12.5%. operating costs remained stable"),
    ["The margin was 12.5%.", "operating costs remained stable"]
  );
});

test("returns an empty list for empty input and ignores surrounding whitespace", () => {
  assert.deepEqual(splitIntoPassages("  "), []);
  assert.deepEqual(splitIntoPassages("  One sentence.  "), ["One sentence."]);
});
