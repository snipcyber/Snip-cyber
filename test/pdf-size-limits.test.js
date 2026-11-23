import assert from "node:assert/strict";
import test from "node:test";
import {
  PDF_SIZE_LIMITS,
  getPdfMaxBytes,
  readLimited
} from "../api/pdf-find.js";

const MB = 1024 * 1024;

test("PDF limits match subscription tiers", () => {
  assert.equal(getPdfMaxBytes("free"), 25 * MB);
  assert.equal(getPdfMaxBytes("pro"), 50 * MB);
  assert.equal(getPdfMaxBytes("unlimited"), 100 * MB);
  assert.equal(getPdfMaxBytes("unknown"), 25 * MB);
  assert.equal(PDF_SIZE_LIMITS.free, 25 * MB);
});

test("rejects oversized Content-Length", async () => {
  const controller = new AbortController();
  const response = new Response(null, {
    headers: { "content-length": String(4 * MB) }
  });

  await assert.rejects(
    readLimited(response, controller, 3 * MB),
    error => error.statusCode === 413 && /3 MB/.test(error.message)
  );
  assert.equal(controller.signal.aborted, true);
});

test("rejects oversized streamed downloads", async () => {
  const controller = new AbortController();
  const response = new Response(new Uint8Array([1, 2, 3, 4]));

  await assert.rejects(
    readLimited(response, controller, 3),
    error => error.statusCode === 413
  );
  assert.equal(controller.signal.aborted, true);
});

test("rejects oversized non-streamed responses", async () => {
  const response = {
    headers: { get: () => null },
    body: null,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
  };

  await assert.rejects(
    readLimited(response, new AbortController(), 3),
    error => error.statusCode === 413
  );
});
