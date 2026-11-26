import { createHash } from 'node:crypto';

async function verifyAnonymousKey(key) {
  if (!key || key.length > 512) return null;

  // The key is a stable installation identifier, not proof of a paid plan.
  return createHash('sha256').update(key).digest('hex');
}

export async function verifyUsageReservation(req, fetchImpl = fetch) {
  const url = (process.env.SUPABASE_URL || "").trim();
  const anon = (process.env.SUPABASE_ANON_KEY || "").trim();
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const key = String(req.headers['x-snip-extensionpay-key'] || '');
  const id = String(req.body?.reservation_id || '');

  if (!url || !anon) throw new Error('Supabase configuration missing');

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, status: 400, error: 'A valid usage reservation is required.' };
  }

  let installHash = null;
  if (token) {
    const auth = await fetchImpl(url + '/auth/v1/user', {
      headers: { apikey: anon, Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(10000)
    });
    if (!auth.ok) return { ok: false, status: 401, error: 'Invalid session.' };
    const user = await auth.json();
    if (!user.id) return { ok: false, status: 401, error: 'Account verification failed.' };
  } else {
    installHash = await verifyAnonymousKey(key);
    if (!installHash) return { ok: false, status: 401, error: 'A verified Free installation is required.' };
  }

  const claim = await fetchImpl(url + '/rest/v1/rpc/snip_api_claim_usage_reservation', {
    method: 'POST',
    headers: {
      apikey: anon,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: JSON.stringify({ p_reservation_id: id, p_install_hash: installHash }),
    signal: AbortSignal.timeout(10000)
  });
  if (!claim.ok) {
    const detail = (await claim.text()).slice(0, 500);
    throw new Error('Reservation verification failed (' + claim.status + '): ' + detail);
  }
  const result = await claim.json();
  if (!result || !result.ok) return { ok: false, status: 403, error: 'Reservation invalid or expired.' };
  if (!['free', 'pro', 'unlimited'].includes(result.plan)) return { ok: false, status: 403, error: 'Reservation has an invalid plan.' };
  return { ok: true, reservationId: id, plan: result.plan };
}
