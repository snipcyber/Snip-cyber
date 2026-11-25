import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "https:" + "/" + "/test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service";

const { default: pdfFindHandler } = await import("../api/pdf-find.js");

const TEST_USER = "22222222-2222-4222-8222-222222222222";
const TEST_RESERVATION = "11111111-1111-4111-8111-111111111111";

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

function mockSupabase(url) {
  if (String(url).endsWith("/auth/v1/user")) {
    return new Response(JSON.stringify({ id: TEST_USER }), { status: 200 });
  }
  if (String(url).includes("/rest/v1/snip_usage_reservations?")) {
    return new Response(JSON.stringify([{ id: TEST_RESERVATION, plan: "free" }]), { status: 200 });
  }
  throw new Error("Unexpected Supabase request: " + url);
}

test("PDF endpoint remains isolated under 100 concurrent authorized requests", async () => {
  const originalFetch = globalThis.fetch;
  let authChecks = 0;
  let reservationChecks = 0;
  let pdfFetches = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) authChecks += 1;
    else if (String(url).includes("/rest/v1/snip_usage_reservations?")) reservationChecks += 1;
    return mockSupabase(url);
  };

  try {
    const concurrency = 100;
    const results = await Promise.all(
      Array.from({ length: concurrency }, async (_, index) => {
        const response = createResponse();
        await pdfFindHandler({
          method: "POST",
          headers: { authorization: "Bearer test-token" },
          body: {
            url: "https://example.com/load-test-" + index + ".pdf",
            reservation_id: TEST_RESERVATION,
            question: "What is the key disclosure?"
          }
        }, response, {
          fetchImpl: async () => {
            pdfFetches += 1;
            return new Response("not a PDF", {
              status: 200,
              headers: { "content-type": "text/plain" }
            });
          }
        });
        return { index, statusCode: response.statusCode, body: response.body };
      })
    );

    assert.equal(results.length, concurrency);
    assert.equal(authChecks, concurrency);
    assert.equal(reservationChecks, concurrency);
    assert.equal(pdfFetches, concurrency);
    for (const result of results) {
      assert.equal(result.statusCode, 415, "request " + result.index + " should independently reject non-PDF content");
      assert.match(result.body.error, /did not return a PDF/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PDF endpoint rejects concurrent requests with missing reservations before downloading", async () => {
  const originalFetch = globalThis.fetch;
  let authChecks = 0;
  let reservationChecks = 0;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) {
      authChecks += 1;
      return new Response(JSON.stringify({ id: TEST_USER }), { status: 200 });
    }
    if (String(url).includes("/rest/v1/snip_usage_reservations?")) {
      reservationChecks += 1;
      return new Response("[]", { status: 200 });
    }
    throw new Error("Unexpected network request: " + url);
  };

  try {
    const concurrency = 100;
    const results = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const response = createResponse();
        await pdfFindHandler({
          method: "POST",
          headers: { authorization: "Bearer test-token" },
          body: {
            url: "https://example.com/report.pdf",
            question: "What is the key disclosure?"
          }
        }, response, {
          fetchImpl: async () => {
            throw new Error("PDF must not be fetched without a reservation");
          }
        });
        return response;
      })
    );

    assert.equal(results.length, concurrency);
    for (const response of results) {
      assert.equal(response.statusCode, 400);
      assert.match(response.body.error, /reservation invalid or expired/i);
    }
    assert.equal(authChecks, concurrency);
    assert.equal(reservationChecks, concurrency);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
