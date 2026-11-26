import usageHandler from "./usage.js";
import { verifyUsageReservation } from "./usage-auth.js";
function mockResponse() {
  return { statusCode: 200, body: null, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const headers = { "x-snip-extensionpay-key": "snip-production-smoke-installation-20261127" };
  const reservation = mockResponse();
  await usageHandler({ method: "POST", headers, body: { action: "reserve" } }, reservation);
  if (reservation.statusCode !== 200 || !reservation.body?.reservation_id) return res.status(502).json({ step: "reserve", status: reservation.statusCode, body: reservation.body });
  let claim;
  try { claim = await verifyUsageReservation({ headers, body: { reservation_id: reservation.body.reservation_id } }); }
  catch (error) {
    const cleanup = mockResponse();
    await usageHandler({ method: "POST", headers, body: { action: "release", reservation_id: reservation.body.reservation_id } }, cleanup);
    return res.status(502).json({ step: "claim", error: error.message, cleanup: cleanup.body });
  }
  const release = mockResponse();
  await usageHandler({ method: "POST", headers, body: { action: "release", reservation_id: reservation.body.reservation_id } }, release);
  const ok = claim.ok && release.statusCode === 200 && release.body?.ok === true;
  return res.status(ok ? 200 : 502).json({ ok, reserve: reservation.body, claim, release: release.body, note: "Synthetic production reservation released; no usage was committed." });
}