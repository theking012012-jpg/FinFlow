'use strict';
// establishSession — the ONE way a request becomes authenticated (N73). Every login / sign-up /
// invite-accept / accountant / admin login routes through here, so a new auth path cannot forget it:
//   1. regenerate the session id at the privilege change, so a cookie fixed by an attacker before
//      login is never promoted to an authenticated session (session fixation);
//   2. start from an EMPTY session, so identities never mix — an accountant login on a browser that
//      held a user session used to keep both ids, and audit then attributed the user's actions to
//      the accountant;
//   3. persist before the caller responds (F134: immediate follow-up GETs must see the session).
//   4. stamp a USER session with the account's current session epoch (users.data.session_epoch). A
//      password reset/change increments the epoch, and the session-validity middleware (server.js)
//      drops every session whose epoch no longer matches (N6/N6b). A counter, not a timestamp: two
//      events in the same millisecond still order correctly.
async function establishSession(req, fields) {
  let epoch = null;
  if (fields && fields.userId != null) {
    const { pool } = require('./database');
    const { rows: [u] } = await pool.query(`SELECT COALESCE((data->>'session_epoch')::int, 0) AS e FROM users WHERE id = $1`, [fields.userId]);
    epoch = u ? Number(u.e) : 0;
  }
  await new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
  Object.assign(req.session, fields, epoch != null ? { sessionEpoch: epoch } : {});
  await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
}
module.exports = { establishSession };
