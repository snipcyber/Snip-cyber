import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import handler from "../api/pdf-find.js";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing staging Supabase secrets.");

const installKey = `snip-staging-stress-${randomUUID()}`;
const installHash = createHash("sha256").update(installKey).digest("hex");
const reservationId = randomUUID();
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation"
};
const table = `${supabaseUrl}/rest/v1/snip_anonymous_usage_reservations`;
let inserted = false;

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

try {
  const create = await fetch(table, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: reservationId,
      install_hash: installHash,
      period_key: `stress-${new Date().toISOString().slice(0, 10)}`,
      status: "reserved",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    })
  });
  if (!create.ok) throw new Error(`Could not seed staging reservation (${create.status}): ${(await create.text()).slice(0, 300)}`);
  inserted = true;

  let pdfFetches = 0;
  const results = await Promise.all(Array.from({ length: 100 }, async (_, index) => {
    const res = response();
    await handler({
      method: "POST",
      headers: { "x-snip-extensionpay-key": installKey },
      body: {
        reservation_id: reservationId,
        url: `https://example.com/staging-concurrency-${index}.pdf`,
        question: "Staging reservation concurrency verification"
      }
    }, res, {
      fetchImpl: async () => {
        pdfFetches += 1;
        return new Response("not a PDF", {
          status: 200,
          headers: { "content-type": "text/plain" }
        });
      }
    });
    return res;
  }));

  const winner = results.filter(item => item.statusCode === 415).length;
  const rejected = results.filter(item => item.statusCode === 403).length;
  const unexpected = results.filter(item => item.statusCode !== 415 && item.statusCode !== 403);
  const verify = await fetch(`${table}?id=eq.${reservationId}&select=id,status,install_hash`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!verify.ok) throw new Error(`Could not verify final reservation state (${verify.status}).`);
  const rows = await verify.json();

  console.log(JSON.stringify({
    requests: results.length,
    singleClaimWinner: winner,
    replayRejected: rejected,
    unexpectedResponses: unexpected.length,
    downstreamPdfFetches: pdfFetches,
    finalStatus: rows[0]?.status ?? null,
    cleanup: "pending"
  }, null, 2));

  assert.equal(winner, 1, "exactly one concurrent request must claim the reservation");
  assert.equal(rejected, 99, "the other 99 replay requests must be rejected");
  assert.equal(unexpected.length, 0, "all requests must return expected statuses");
  assert.equal(pdfFetches, 1, "only the winning request may reach PDF fetching");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "processing");
} finally {
  if (inserted) {
    const cleanup = await fetch(`${table}?id=eq.${reservationId}&install_hash=eq.${installHash}`, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" }
    });
    if (!cleanup.ok) throw new Error(`CRITICAL: staging test reservation cleanup failed (${cleanup.status}): ${(await cleanup.text()).slice(0, 300)}`);
    const removed = await cleanup.json();
    if (removed.length !== 1) throw new Error(`CRITICAL: expected to delete one synthetic staging row; deleted ${removed.length}`);
    console.log("Cleanup: synthetic staging reservation deleted.");
  }
}
