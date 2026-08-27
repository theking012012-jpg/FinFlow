'use strict';
/**
 * verify-entity-profile.js — F196 Tier 2: the BUSINESS PROFILE (letterhead) is PER-ENTITY.
 *
 * WHAT WENT WRONG BEFORE: every document's letterhead was built from the ACCOUNT-wide settings blob.
 * GET /api/settings is `SELECT * FROM user_settings WHERE user_id=$1 AND data->>'key' IS NULL` — ONE
 * row per account, no entity scoping — loaded once at boot into the `s-*` inputs and never reloaded on
 * an entity switch. Entities carried only name/currency/color/timezone/country. So with "Saige
 * Holdings" active, the invoice letterhead read "Acme" (the ACCOUNT's business_name), and every entity
 * printed the same address, contact and tax-id. This is the CLAUDE.md Rule 10 "under investigation"
 * class: a setting stored PER-USER applied to PER-ENTITY output.
 *
 * DISCRIMINATION (Rule 4) — the three sources hold DELIBERATELY DIFFERENT values, so a passing run
 * identifies WHICH source was read, and the pre-fix implementation cannot go green:
 *   account blob : "Account Wide Biz"  / "99 Account Ave"      / acct@account.test / TAX-ACCT-999
 *   entity A     : "Alpha Books Ltd"   / "11 Alpha Way..."     / ar@alpha.test     / TAX-AAA-111
 *   entity B     : "Beta Trading Co"   / "22 Beta Road..."     / ar@beta.test      / TAX-BBB-222
 * Pre-fix, the letterhead renders the ACCOUNT values for BOTH entities, so the entity assertions fail
 * AND the "account value must not leak" assertions fail. The values also differ BETWEEN the two
 * entities, so a switch that silently kept the previous entity's profile is caught too — not only the
 * account-vs-entity confusion.
 *
 * Asserts on EXECUTED values — the rendered document HTML and the live input values — never on source
 * text (Rule 5).
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-entity-profile.js
 */
const { bootSpaInJsdom } = require('./jsdomBoot.js');

const ACCT = {
  business_name: 'Account Wide Biz', address: '99 Account Ave',
  email: 'acct@account.test', tax_id: 'TAX-ACCT-999', website: 'https://account-wide.test',
};
const A_PROF = {
  business_name: 'Alpha Books Ltd', address: '11 Alpha Way, Kingston',
  email: 'ar@alpha.test', phone: '+1-876-555-0101', tax_id: 'TAX-AAA-111',
};
const B_PROF = {
  business_name: 'Beta Trading Co', address: '22 Beta Road, Lagos',
  email: 'ar@beta.test', phone: '+234-555-0202', tax_id: 'TAX-BBB-222',
};

(async () => {
  let boot, pass = 0, fail = 0;
  const A = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  ' + d : '')); } };
  try {
    boot = await bootSpaInJsdom({
      seedExtra: async (c, uid) => {
        // plan 'business' lifts the 1-entity cap so a SECOND entity can exist.
        await c.query(`UPDATE users SET data = data || '{"plan":"business"}'::jsonb WHERE id = $1`, [uid]);
        // The account-wide profile — the value that must NOT appear once an entity sets its own.
        await c.query(
          `UPDATE user_settings SET data = data || $2::jsonb WHERE user_id = $1 AND data->>'key' IS NULL`,
          [uid, JSON.stringify(ACCT)]
        );
        // Entity A = the seeded ACTIVE entity, given its OWN profile.
        await c.query(
          `UPDATE entities SET data = data || $2::jsonb
             WHERE user_id = $1 AND (data->>'is_active')::int = 1`,
          [uid, JSON.stringify(A_PROF)]
        );
        // Entity B — a second entity with a DIFFERENT profile.
        await c.query(
          `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
           VALUES ($1, NULL, $2, NOW(), NOW())`,
          [uid, JSON.stringify(Object.assign(
            { name: 'Beta Entity', currency: 'USD', is_active: 0, sort_order: 1 }, B_PROF))]
        );
      },
    });
    const { window, http, settle } = boot;
    const doc = window.document;
    await settle(60, 60);

    const v = (id) => { const el = doc.getElementById(id); return el ? String(el.value || '') : '<no-el>'; };
    const activeEnt = () => (window.ENTITIES || []).find(e => e && e.active) || null;
    const idxOf = (n) => (window.ENTITIES || []).findIndex(e => e && e.name === n);

    // ── PART 1 — SERVER: the entity stores and round-trips its own profile ────────────────────────
    const rows = JSON.parse((await http.get('/api/entities')).text || '[]');
    A('boot: two entities exist', rows.length === 2, `n=${rows.length}`);
    const rowA = rows.find(r => r.business_name === A_PROF.business_name);
    const rowB = rows.find(r => r.business_name === B_PROF.business_name);
    A("GET /api/entities round-trips entity A's profile (address+email+tax_id)",
      !!rowA && rowA.address === A_PROF.address && rowA.email === A_PROF.email && rowA.tax_id === A_PROF.tax_id,
      `rowA=${JSON.stringify(rowA && { a: rowA.address, e: rowA.email, t: rowA.tax_id })}`);
    A("GET /api/entities round-trips entity B's DIFFERENT profile",
      !!rowB && rowB.tax_id === B_PROF.tax_id, `rowB.tax_id=${rowB && rowB.tax_id}`);

    // PUT writes a profile field, and patches ONLY the keys sent (a profile save must not blank name).
    const putR = await http.put('/api/entities/' + rowB.id, { address: '22B Beta Road, Lagos' });
    A('PUT /api/entities accepts a profile field → 200', putR.status === 200, `status=${putR.status}`);
    const afterPut = JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowB.id);
    A('PUT patched address AND left name/tax_id intact (partial patch, no blanking)',
      afterPut.address === '22B Beta Road, Lagos' && afterPut.name === 'Beta Entity' && afterPut.tax_id === B_PROF.tax_id,
      `name="${afterPut.name}" addr="${afterPut.address}" tax="${afterPut.tax_id}"`);

    // Validation: over-length and a non-data-URI logo are REJECTED 400, never silently truncated in.
    const tooLong = await http.put('/api/entities/' + rowB.id, { business_name: 'x'.repeat(201) });
    A('over-length business_name → 400 (not silently truncated)', tooLong.status === 400, `status=${tooLong.status}`);
    const badLogo = await http.put('/api/entities/' + rowB.id, { logo: 'javascript:alert(1)' });
    A('non-data-URI logo → 400', badLogo.status === 400, `status=${badLogo.status}`);
    const stillB = JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowB.id);
    A('a rejected write changed NOTHING on the row',
      stillB.business_name === B_PROF.business_name && !stillB.logo, `bn="${stillB.business_name}"`);

    // ── PART 2 — CLIENT: ENTITIES carries the profile; the panel shows the ACTIVE entity's ────────
    const entA = activeEnt();
    A('client: the active entity carries its own profile object',
      !!(entA && entA.profile && entA.profile.business_name === A_PROF.business_name),
      `profile=${JSON.stringify(entA && entA.profile)}`);
    A('Business-profile panel shows ENTITY A, not the account blob',
      v('s-biz-name') === A_PROF.business_name && v('s-address') === A_PROF.address && v('s-tax-id') === A_PROF.tax_id,
      `name="${v('s-biz-name')}" addr="${v('s-address')}" tax="${v('s-tax-id')}"`);
    A('the account-wide business_name does NOT leak into the panel',
      v('s-biz-name') !== ACCT.business_name, `s-biz-name="${v('s-biz-name')}"`);
    // Fallback: entity A sets no website, so the ACCOUNT value fills it (no migration needed).
    A('a field the entity does NOT set falls back to the account blob (website)',
      v('s-website') === ACCT.website, `s-website="${v('s-website')}"`);

    // ── PART 3 — the rendered DOCUMENT letterhead is entity A's ───────────────────────────────────
    // ISOLATE THE SOURCE. Two mechanisms now feed the letterhead: the entity profile object that
    // letterhead() reads directly, and the `s-*` inputs, which applyEntityProfileFields has already
    // repainted with the ENTITY's values. If we assert with the panel in that state, a letterhead that
    // had STOPPED reading the entity profile would still render entity values via the inputs — the
    // assertion would pass for the wrong reason and could not tell the two sources apart.
    // So force every input back to the ACCOUNT-wide value first: now the account text is what a
    // letterhead reading the inputs would print, and only one reading the ENTITY profile can pass.
    const setV = (id, val) => { const el = doc.getElementById(id); if (el) el.value = val; };
    setV('s-biz-name', ACCT.business_name);
    setV('s-address', ACCT.address);
    setV('s-biz-email', ACCT.email);
    setV('s-email', ACCT.email);
    setV('s-tax-id', ACCT.tax_id);

    const invs = window.userInvoices || [];
    A('boot: an invoice is available to render', invs.length > 0, `len=${invs.length}`);
    window.viewInvoice(0);
    await settle(4, 30);
    const frame = doc.getElementById('ff-docview-frame');
    const htmlA = (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
    A("[F196] letterhead shows entity A's NAME + ADDRESS + EMAIL + TAX-ID",
      htmlA.indexOf(A_PROF.business_name) !== -1 && htmlA.indexOf(A_PROF.address) !== -1 &&
      htmlA.indexOf(A_PROF.email) !== -1 && htmlA.indexOf(A_PROF.tax_id) !== -1,
      `name=${htmlA.indexOf(A_PROF.business_name) !== -1} addr=${htmlA.indexOf(A_PROF.address) !== -1} ` +
      `email=${htmlA.indexOf(A_PROF.email) !== -1} tax=${htmlA.indexOf(A_PROF.tax_id) !== -1}`);
    A('[F196] the ACCOUNT-wide business does NOT appear on the document',
      htmlA.indexOf(ACCT.business_name) === -1 && htmlA.indexOf(ACCT.address) === -1 && htmlA.indexOf(ACCT.tax_id) === -1,
      'an account-wide letterhead value leaked into the document');

    // ── PART 4 — the letterhead SWITCHES with the active entity ───────────────────────────────────
    const bIdx = idxOf('Beta Entity');
    A('entity B is present in the client list', bIdx >= 0, `bIdx=${bIdx}`);
    await window.switchEntity(bIdx);
    await settle(40, 60);
    A('after switch: entity B is active',
      !!(activeEnt() && activeEnt().name === 'Beta Entity'), `active="${activeEnt() && activeEnt().name}"`);
    A('after switch: the Business-profile panel repaints to entity B',
      v('s-biz-name') === B_PROF.business_name && v('s-tax-id') === B_PROF.tax_id,
      `name="${v('s-biz-name')}" tax="${v('s-tax-id')}"`);

    // Same source-isolation as PART 3 — asserted AFTER the panel-repaint check above, so clobbering
    // the inputs cannot mask it. A letterhead reading the inputs would now print the ACCOUNT text.
    setV('s-biz-name', ACCT.business_name);
    setV('s-address', ACCT.address);
    setV('s-biz-email', ACCT.email);
    setV('s-email', ACCT.email);
    setV('s-tax-id', ACCT.tax_id);

    const inv2 = window.userInvoices || [];
    if (inv2.length > 0) {
      window.viewInvoice(0);
      await settle(4, 30);
      const htmlB = (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
      A("[F196] after the switch the letterhead is entity B's (name + tax-id)",
        htmlB.indexOf(B_PROF.business_name) !== -1 && htmlB.indexOf(B_PROF.tax_id) !== -1,
        `name=${htmlB.indexOf(B_PROF.business_name) !== -1} tax=${htmlB.indexOf(B_PROF.tax_id) !== -1}`);
      A("[F196] entity A's letterhead does NOT survive the switch (no stale carry-over)",
        htmlB.indexOf(A_PROF.business_name) === -1 && htmlB.indexOf(A_PROF.tax_id) === -1 && htmlB.indexOf(A_PROF.address) === -1,
        "entity A's letterhead values are still present after switching to B");
    } else {
      A('[F196] entity B has an invoice to render', false,
        'no invoices after the switch — cannot assert the switched letterhead');
    }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (per-entity business profile / letterhead)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
