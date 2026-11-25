import assert from "node:assert/strict";
import test from "node:test";

const { default: semanticSearchHandler } = await import("../api/semantic-search.js");

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

test("semantic search rejects requests without a usage reservation before calling OpenAI", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("A request without a reservation must not make network calls");
  };

  try {
    const response = createResponse();
    await semanticSearchHandler({
      method: "POST",
      headers: {},
      body: { question: "Find the key disclosure", blocks: [{ text: "A sufficiently long disclosure passage." }] }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /usage reservation/i);
    assert.equal(fetchCount, 0);
    assert.match(response.headers["Access-Control-Allow-Headers"], /Authorization/);
    assert.match(response.headers["Access-Control-Allow-Headers"], /X-Snip-ExtensionPay-Key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
