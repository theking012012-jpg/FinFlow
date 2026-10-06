'use strict';
// establishSession — the ONE way a request becomes authenticated (N73). Every login / sign-up /
// invite-accept / accountant / admin login routes through here, so a new auth path cannot forget it:
//   1. regenerate the session id at the privilege change, so a cookie fixed by an attacker before
//      login is never promoted to an authenticated session (session fixation);
//   2. start from an EMPTY session, so identities never mix — an accountant login on a browser that
//      held a user session used to keep both ids, and audit then attributed the user's actions to
//      the accountant;
//   3. persist before the caller responds (F134: immediate follow-up GETs must see the session).
async function establishSession(req, fields) {
  await new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
  Object.assign(req.session, fields);
  await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
}
module.exports = { establishSession };
