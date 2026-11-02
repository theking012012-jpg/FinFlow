'use strict';
// C1 / F92 / CLAUDE.md Rule 9 — idempotency AT THE WRITE, one shared mechanism every mutating /api request goes through.
//
// A request that carries an `Idempotency-Key` header is executed ONCE per (actor, key). The first request claims the
// key in idempotency_keys (a unique row — the database decides, not a time window); its response (status + JSON body)
// is stored; a repeat with the same key gets that stored response back (header `Idempotent-Replayed: true`) without
// running the route again. A repeat that arrives while the first is still running waits for it (up to 8 s) and then
// replays; if the first is still running after that, 409 IN_PROGRESS (the client retries the same key).
// The SAME key on a DIFFERENT request (method, path or body) is refused 422 — a key names one operation.
// A 5xx releases the key so the retry can run; a 2xx–4xx is stored (a validation error replays the same error).
//
// Every page sends a key on every same-origin /api write (public/ff-idem.js patches fetch), so double-clicks, a slow
// network retry and a reload-and-resubmit all land once — on EVERY route, including ones written after this file.
// The older 5-second findRecentDuplicate window stays only as a backstop for keyless API callers.
const crypto = require('crypto');

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_BODY_BYTES = 256 * 1024;          // a stored response larger than this is not kept (the key is released)
const WAIT_MS = 8000, POLL_MS = 150;
const SKIP = [/^\/stripe\/webhook/, /^\/csp-report/];   // signed / fire-and-forget endpoints

function actorOf(req) {
  const s = req.session || {};
  if (s.userId) return 'u:' + s.userId;
  if (s.accountantId) return 'a:' + s.accountantId;
  if (s.isAdmin) return 'adm:' + (s.adminId == null ? 'shared' : s.adminId);
  return null;   // anonymous writes (sign-up, contact form) are rate-limited elsewhere; no actor to scope a key to
}
function fingerprint(req) {
  let body = '';
  try { body = req.body == null ? '' : JSON.stringify(req.body); } catch (_) { body = ''; }
  return crypto.createHash('sha256').update(req.method + ' ' + req.originalUrl.split('?')[0] + '?' + (req.originalUrl.split('?')[1] || '') + '\n' + body).digest('hex');
}

module.exports = function idempotency(pool) {
  return async function idempotencyMiddleware(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (SKIP.some(re => re.test(req.path))) return next();
    const key = req.get('Idempotency-Key');
    if (!key) return next();
    if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Invalid Idempotency-Key.', code: 'BAD_IDEMPOTENCY_KEY' });
    const actor = actorOf(req);
    if (!actor) return next();
    const fp = fingerprint(req);

    let claimed = false;
    try {
      const r = await pool.query(
        `INSERT INTO idempotency_keys (actor, key, fingerprint, method, path) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (actor, key) DO NOTHING RETURNING id`, [actor, key, fp, req.method, req.originalUrl.slice(0, 300)]);
      claimed = r.rowCount === 1;
    } catch (e) { return next(e); }

    if (!claimed) {
      // a repeat: wait for the first to finish, then replay what it answered
      const until = Date.now() + WAIT_MS;
      for (;;) {
        const { rows: [k] } = await pool.query(`SELECT fingerprint, response_status, response_body FROM idempotency_keys WHERE actor = $1 AND key = $2`, [actor, key]);
        if (!k) break;   // released by a 5xx → run this one as the first (claim again below)
        if (k.fingerprint !== fp) return res.status(422).json({ error: 'This Idempotency-Key was already used for a different request.', code: 'IDEMPOTENCY_KEY_REUSED' });
        if (k.response_status != null) {
          res.set('Idempotent-Replayed', 'true');
          return res.status(k.response_status).json(k.response_body);
        }
        if (Date.now() > until) return res.status(409).json({ error: 'The same request is still being processed — try again in a moment.', code: 'IN_PROGRESS' });
        await new Promise(r => setTimeout(r, POLL_MS));
      }
      const r2 = await pool.query(`INSERT INTO idempotency_keys (actor, key, fingerprint, method, path) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (actor, key) DO NOTHING RETURNING id`, [actor, key, fp, req.method, req.originalUrl.slice(0, 300)]);
      if (r2.rowCount !== 1) return res.status(409).json({ error: 'The same request is still being processed — try again in a moment.', code: 'IN_PROGRESS' });
    }

    // the first: run the route, keep what it answers
    let stored = false;
    const release = () => { if (!stored) { stored = true; pool.query(`DELETE FROM idempotency_keys WHERE actor = $1 AND key = $2 AND response_status IS NULL`, [actor, key]).catch(() => {}); } };
    const origJson = res.json.bind(res);
    res.json = function (body) {
      if (!stored) {
        stored = true;
        const status = res.statusCode || 200;
        let text = null; try { text = JSON.stringify(body === undefined ? null : body); } catch (_) { text = null; }
        if (status >= 500 || text == null || Buffer.byteLength(text) > MAX_BODY_BYTES) {
          pool.query(`DELETE FROM idempotency_keys WHERE actor = $1 AND key = $2`, [actor, key]).catch(() => {});
        } else {
          // stored BEFORE the response is sent, so a repeat can never see "finished" without the answer
          return pool.query(`UPDATE idempotency_keys SET response_status = $3, response_body = $4::jsonb, completed_at = NOW() WHERE actor = $1 AND key = $2`, [actor, key, status, text])
            .catch(e => console.error('[idempotency] could not store the response for', req.method, req.originalUrl, ':', e.message))
            .then(() => origJson(body));
        }
      }
      return origJson(body);
    };
    res.on('finish', () => { if (!stored) release(); });   // a non-JSON answer (CSV, redirect, send()) is not replayable
    res.on('close', () => { if (!stored) release(); });
    next();
  };
};
module.exports.KEY_RE = KEY_RE;
// Keys are kept 24 hours — long enough for any retry; then the daily job removes them.
module.exports.purgeOld = async (pool) => (await pool.query(`DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'`)).rowCount;
