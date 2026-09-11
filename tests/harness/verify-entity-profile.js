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

    // ── PART 5 — the WRITE UI: the per-entity profile can actually be EDITED from the app ─────────
    // Everything above (PARTS 1-4) proved the server stores a per-entity profile and the letterhead
    // reads it. None of it proved a USER could ever SET one: until now the only way a per-entity
    // profile existed was a hand-written UPDATE, exactly like this harness's own seed. A capability
    // reachable only from psql is not a shipped feature — the ledger row said "Tier 2 (write UI)
    // OPEN" for precisely that reason. This part drives the real modal handlers.
    //
    // RULE 1 FIRST (executed, not reasoned). window.renderEntities is REASSIGNED in
    // finflow-api-wiring-medium.js:1078. That file is bundled into finflow-bundle.js, which loads
    // `defer` — AFTER the inline index.html copy has already been defined — and the wiring copy is a
    // WRAPPER (`_medOrigRenderEntities`), not a replacement, so the inline copy still executes
    // inside it. That is the reasoning; the assertion below is the PROOF. If the edit had landed on
    // a shadowed copy, the Profile button simply would not be in the DOM and this goes red — which
    // is the check the two dead-copy "fixes" in this repo's history never had.
    const entHost = doc.getElementById('entity-list');
    A('the entity-card container exists (the surface the Profile button must reach)', !!entHost);
    window.renderEntities();
    await settle(4, 30);
    const cardHtml = (entHost && entHost.innerHTML) || '';
    A('[RULE 1] the Profile button REACHES THE DOM — the edited renderEntities copy is the runtime winner',
      /openEntityProfile\(/.test(cardHtml),
      'no openEntityProfile( in the rendered entity cards — the edit landed on a shadowed copy');
    A('[RULE 1] one Profile button per entity (2 entities → 2 buttons, not 1 and not 4)',
      (cardHtml.match(/openEntityProfile\(/g) || []).length === 2,
      `count=${(cardHtml.match(/openEntityProfile\(/g) || []).length}`);
    A('the modal the button opens exists in the document', !!doc.getElementById('entity-profile-modal'));

    // Open entity B's profile. The editor must load THAT ENTITY's stored values — an editor
    // pre-filled from the account blob would silently overwrite the entity's profile with the
    // account's the moment the user pressed Save, which is the F196 bug re-entering through the
    // write path. B's values differ from both A's and the account's, so the source is identifiable.
    const bIdx2 = idxOf('Beta Entity');
    window.openEntityProfile(bIdx2);
    await settle(4, 30);
    A('the editor opens with ENTITY B’s stored values, not the account blob',
      v('ep-business-name') === B_PROF.business_name && v('ep-tax-id') === B_PROF.tax_id &&
      v('ep-email') === B_PROF.email && v('ep-phone') === B_PROF.phone,
      `name="${v('ep-business-name')}" tax="${v('ep-tax-id')}" email="${v('ep-email')}" phone="${v('ep-phone')}"`);
    A('the editor loaded the entity id it will PUT to (never a blank/implicit target)',
      String(v('ep-entity-id')) === String(rowB.id), `ep-entity-id="${v('ep-entity-id')}" rowB.id=${rowB.id}`);

    // Type a NEW value into all six text fields and save. Every value is distinct from A's, B's
    // seeded values and the account's, so a save that wrote to the wrong row, or that echoed a
    // stale value back, cannot go green.
    const EDIT = {
      business_name: 'Beta Trading International', address: '404 Edited Row, Lagos',
      email: 'AR-EDITED@beta.test', phone: '+234-555-9999',
      tax_id: 'TAX-EDIT-777', website: 'https://beta-edited.test',
    };
    setV('ep-business-name', EDIT.business_name); setV('ep-address', EDIT.address);
    setV('ep-email', EDIT.email);                 setV('ep-phone', EDIT.phone);
    setV('ep-tax-id', EDIT.tax_id);               setV('ep-website', EDIT.website);
    await window.saveEntityProfile(null);
    await settle(25, 60);

    const savedB = JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowB.id);
    A('[WRITE] Save persisted ALL SIX letterhead text fields (business_name/address/email/phone/tax_id/website)',
      !!savedB && savedB.business_name === EDIT.business_name && savedB.address === EDIT.address &&
      savedB.phone === EDIT.phone && savedB.tax_id === EDIT.tax_id && savedB.website === EDIT.website,
      `saved=${JSON.stringify(savedB && { n: savedB.business_name, a: savedB.address, p: savedB.phone, t: savedB.tax_id, w: savedB.website })}`);
    A('[WRITE] the email was normalised to lower case on the way in (server rule, not client trust)',
      !!savedB && savedB.email === EDIT.email.toLowerCase(), `email="${savedB && savedB.email}"`);
    A('[WRITE] the save did NOT touch the entity’s name or currency (a profile edit is not a rename)',
      !!savedB && savedB.name === 'Beta Entity' && savedB.currency === 'USD',
      `name="${savedB && savedB.name}" currency="${savedB && savedB.currency}"`);
    A('[WRITE] entity A was NOT written to (the save is scoped to the row the editor opened)',
      (JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowA.id) || {}).tax_id === A_PROF.tax_id,
      'entity A’s profile changed while saving entity B');
    A('[WRITE] the client’s in-memory ENTITIES reloaded, so the next document renders the new value',
      ((window.ENTITIES || []).find(e => e && e.name === 'Beta Entity') || { profile: {} }).profile.tax_id === EDIT.tax_id,
      `client tax_id="${((window.ENTITIES || []).find(e => e && e.name === 'Beta Entity') || { profile: {} }).profile.tax_id}"`);

    // ── PART 5b — a BLANK field is a deliberate CLEAR that restores the account fallback ─────────
    // This is the one behaviour a "just send what changed" editor gets wrong: if a blanked field is
    // omitted from the PUT, the old value survives and the user cannot ever remove it. It must be
    // sent, stored as NULL, and fall back to the account blob — not stored as the empty string,
    // which would render an entity with a BLANK letterhead line instead of the account's.
    // ADDRESS is the field asserted on the document, deliberately: finflow-docview.js builds its
    // letterhead lines from [address, phone, email, taxId] ONLY — `website` is resolved in
    // letterhead() and then never printed (logged as a separate finding, out of scope here). An
    // assertion on a field the template does not render would be unfalsifiable, so both a
    // rendered field (address) and a non-rendered one (website) are cleared: the DB assertions
    // cover both, the DOCUMENT assertion uses the one that reaches paper.
    window.openEntityProfile(bIdx2);
    await settle(4, 30);
    setV('ep-website', '');
    setV('ep-address', '');
    await window.saveEntityProfile(null);
    await settle(25, 60);
    const clearedB = JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowB.id);
    A('[CLEAR] blanking a field stores NULL, not "" (null is what triggers the account fallback)',
      (clearedB.website === null || clearedB.website === undefined) &&
      (clearedB.address === null || clearedB.address === undefined),
      `website=${JSON.stringify(clearedB.website)} address=${JSON.stringify(clearedB.address)}`);
    A('[CLEAR] blanking two fields left the other four intact',
      clearedB.business_name === EDIT.business_name && clearedB.tax_id === EDIT.tax_id && clearedB.phone === EDIT.phone,
      `saved=${JSON.stringify({ n: clearedB.business_name, t: clearedB.tax_id, p: clearedB.phone })}`);
    setV('s-address', ACCT.address);
    window.viewInvoice(0);
    await settle(4, 30);
    const htmlCleared = (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
    A('[CLEAR] the cleared field falls back to the ACCOUNT value on the document (not blank)',
      htmlCleared.indexOf(ACCT.address) !== -1 && htmlCleared.indexOf(EDIT.address) === -1,
      `acct-address-present=${htmlCleared.indexOf(ACCT.address) !== -1} old-value-gone=${htmlCleared.indexOf(EDIT.address) === -1}`);

    // ── PART 6 — the LOGO: validated, persisted, and rendered PER ENTITY ─────────────────────────
    // Until this change nothing in the app could set a logo at all — finflow-docview.js said so in a
    // comment ("no UI writes a logo yet"), and `_invoiceLogoDataURL` / `_companyLogo` were read but
    // never assigned. So every document printed with an empty logo slot regardless of what the
    // entity row held. The three logos below carry DIFFERENT payloads so the rendered <img src>
    // identifies WHICH source was read (Rule 4) — an assertion that merely checked "an img exists"
    // could not tell the entity's logo from the account's.
    const mkLogo = (tag) => 'data:image/png;base64,' + Buffer.from('FFLOGO-' + tag + '-' + 'x'.repeat(40)).toString('base64');
    const LOGO_B = mkLogo('ENTITY-BETA');
    const LOGO_ACCT = mkLogo('ACCOUNT-WIDE');

    // Server-side validation FIRST — the client guard is a courtesy; the server is the rule.
    const badType = await http.put('/api/entities/' + rowB.id, { logo: 'data:text/html;base64,' + Buffer.from('<script>').toString('base64') });
    A('[LOGO] a non-image data URI → 400 (wrong type rejected, never stored)', badType.status === 400, `status=${badType.status}`);
    const oversize = 'data:image/png;base64,' + 'A'.repeat(300 * 1024);
    A('the oversize fixture really is over the 256 KB cap', oversize.length > 256 * 1024, `len=${oversize.length}`);
    const tooBig = await http.put('/api/entities/' + rowB.id, { logo: oversize });
    A('[LOGO] a logo over 256 KB → 400 (not silently truncated into the row)', tooBig.status === 400, `status=${tooBig.status}`);
    const afterBad = JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowB.id);
    A('[LOGO] neither rejected logo left anything on the row', !afterBad.logo, `logo=${JSON.stringify(afterBad.logo)}`);

    // The CLIENT guard mirrors the server so a doomed 256 KB upload never crosses the wire. Driven
    // through the real handler with a real File, so this is the shipped code path, not a re-spec.
    const pick = async (bytes, type, name) => {
      window._epLogo = undefined;
      const file = new window.File([bytes], name, { type });
      window.epLogoPick({ files: [file], value: name });
      for (let i = 0; i < 60 && window._epLogo === undefined; i++) await settle(1, 25);
      return window._epLogo;
    };
    window.openEntityProfile(bIdx2);
    await settle(4, 30);
    A('[LOGO] the client REFUSES a non-image file before sending (mirrors the server rule)',
      (await pick('not-an-image', 'text/plain', 'notes.txt')) === undefined,
      `_epLogo=${String(window._epLogo).slice(0, 60)}`);
    A('[LOGO] the client REFUSES an over-256 KB image before sending',
      (await pick('B'.repeat(300 * 1024), 'image/png', 'huge.png')) === undefined,
      `_epLogo len=${window._epLogo ? String(window._epLogo).length : 'undefined'}`);
    const accepted = await pick('small-png-bytes', 'image/png', 'logo.png');
    A('[LOGO] the client ACCEPTS a valid small PNG (the guard is a filter, not a wall)',
      typeof accepted === 'string' && /^data:image\/png;base64,/.test(accepted),
      `_epLogo=${String(accepted).slice(0, 60)}`);

    // Save a KNOWN logo through the editor and prove it reaches the document.
    window._epLogo = LOGO_B;
    await window.saveEntityProfile(null);
    await settle(25, 60);
    const withLogo = JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowB.id);
    A('[LOGO] Save persisted the logo on ENTITY B’s row', withLogo.logo === LOGO_B,
      `stored=${String(withLogo.logo).slice(0, 40)}`);
    A('[LOGO] entity A did NOT acquire a logo (per-entity, not account-wide)',
      !(JSON.parse((await http.get('/api/entities')).text || '[]').find(r => r.id === rowA.id) || {}).logo);

    // Source isolation, same technique as PART 3: give the ACCOUNT-wide fallback its own distinct
    // logo. Now a letterhead that had stopped reading the entity profile renders LOGO_ACCT, and
    // only one reading the ENTITY can render LOGO_B.
    window._companyLogo = LOGO_ACCT;
    window.viewInvoice(0);
    await settle(4, 30);
    const htmlLogoB = (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
    A('[LOGO] the document renders ENTITY B’s logo (pre-fix: no logo could be set at all)',
      htmlLogoB.indexOf(LOGO_B) !== -1, 'entity B’s logo data URI is absent from the rendered document');
    A('[LOGO] the ACCOUNT-wide logo does NOT leak onto an entity that has its own',
      htmlLogoB.indexOf(LOGO_ACCT) === -1, 'the account-wide logo rendered instead of the entity’s');

    // …and the fallback still works for an entity with NO logo of its own. Both halves matter:
    // "entity wins" and "account fills in" are one rule, and a fix that broke the second half
    // would blank the logo for every single-entity account on the product.
    await window.switchEntity(idxOf('Alpha Books Ltd') >= 0 ? idxOf('Alpha Books Ltd') : 0);
    await settle(40, 60);
    const aActive = (window.ENTITIES || []).find(e => e && e.active);
    if (aActive && !(aActive.profile || {}).logo) {
      window._companyLogo = LOGO_ACCT;
      window.viewInvoice(0);
      await settle(4, 30);
      const htmlLogoA = (frame && (frame.getAttribute('srcdoc') || frame.srcdoc)) || '';
      A('[LOGO] an entity with NO logo still falls back to the account-wide one',
        htmlLogoA.indexOf(LOGO_ACCT) !== -1, 'the account-wide logo fallback was lost');
      A('[LOGO] entity B’s logo does not survive the switch away from it',
        htmlLogoA.indexOf(LOGO_B) === -1, 'a stale per-entity logo carried across an entity switch');
    } else {
      A('[LOGO] a logo-less entity is available to prove the account fallback', false,
        `active="${aActive && aActive.name}" logo=${aActive && (aActive.profile || {}).logo ? 'set' : 'unset'}`);
    }

    console.log(`\n  ${fail === 0 ? 'ALL GREEN' : fail + ' FAILED'} — ${pass} passed, ${fail} failed  (per-entity business profile / letterhead + write UI + logo)\n`);
  } catch (e) { console.error('\n  FATAL:', e && e.stack ? e.stack : String(e)); fail++; }
  finally { try { if (boot) await boot.stop(); } catch {} }
  process.exitCode = fail === 0 ? 0 : 1;
})();
