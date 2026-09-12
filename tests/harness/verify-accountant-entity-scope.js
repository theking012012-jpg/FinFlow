#!/usr/bin/env node
'use strict';
/**
 * verify-accountant-entity-scope.js — the OWNER's PER-ENTITY + PERSONAL access grant, executed
 * end-to-end against real Postgres and the real server. The owner grants their accountant a
 * different level (none | view | filing) on each business entity, and independently on their
 * personal finances, via PUT /api/accountants/my-accountant/access { entity_access }. Those
 * grants must actually change what the accountant can READ and WRITE in the portal.
 *
 *   node -r ./tests/harness/clock.js tests/harness/verify-accountant-entity-scope.js
 *
 * DISCRIMINATING DATA (Rule 4): entity A = the full VERIFICATION dataset (seed()); entity B = a
 * single distinctive invoice of $77,777. If B ever leaks through a "none" grant, that number
 * appears in the response and the test fails loudly — a non-discriminating seed (two empty
 * entities) could not tell allow from deny.
 *
 * RED-PROVEN gates (Rule 14 — the DENY path is executed, not assumed):
 *   · books?entity_id=B (none)         → 403               entity hidden even by direct id
 *   · B absent from entities[]/arrays  → 77777 never served
 *   · POST journal to B (none)         → 403               write denied on a none entity
 *   · POST journal to A when A=view    → 403               write denied on a view entity
 *   · lock when no entity is filing    → 403
 *   · personal served only when granted; NULL under a legacy link and under personal='none'
 *
 * Two independent sessions (owner + accountant) via two HTTP clients. Scratch Postgres only.
 */

const bcrypt = require('bcryptjs');
require('./clock.js');
const { startScratchPostgres } = require('./pgScratch.js');
const { bootServer } = require('./boot.js');
const { seed, localNoonUtc } = require('./seed.js');
const { HarnessHttp } = require('./httpClient.js');

const PW = 'harness-password-not-a-secret';
let pass = 0, fail = 0;
const A = (name, ok, d) => { ok ? (pass++, console.log('  PASS  ' + name)) : (fail++, console.log('  FAIL  ' + name + (d ? '\n          ' + d : ''))); };
const money = v => Number(v).toFixed(2);

async function mkClient(c, email) {
  return (await c.query(
    `INSERT INTO users (user_id, entity_id, data, created_at, updated_at) VALUES (NULL, NULL, $1, NOW(), NOW()) RETURNING id`,
    [{ email, name: 'Client Co', plan: 'business', role: 'owner', password: bcrypt.hashSync(PW, 10) }]
  )).rows[0].id;
}

async function main() {
  const scratch = await startScratchPostgres({ keep: false });
  const c = scratch.client;
  let server = null;
  try {
    server = await bootServer(scratch.url);

    // ── OWNER 1: entity A (seed) + entity B ($77,777) + personal finances ──────────────────────
    const clientId = await mkClient(c, 'scope-client@finflow.test');
    const { entityId: entA } = await seed(c, clientId);   // A is is_active:1

    const entB = (await c.query(
      `INSERT INTO entities (user_id, entity_id, data, created_at, updated_at)
       VALUES ($1, NULL, $2, $3::timestamptz, $3::timestamptz) RETURNING id`,
      [clientId, { name: 'Entity B Ltd', currency: 'USD', color: '#3a6', is_active: 0, sort_order: 1 }, localNoonUtc('2026-01-01')]
    )).rows[0].id;
    // B's sole invoice — issue-based accrual ⇒ revenue exactly 77777 on 2026-03-15 (≤ today, in FY).
    await c.query(
      `INSERT INTO invoices (user_id, entity_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)`,
      [clientId, entB, { client: 'B Customer', amount: 77777, amount_paid: 0, status: 'pending',
        issue_date: '2026-03-15', due_date: '2026-03-15', num: 'B-INV-1', notes: 'entity B marker' }, localNoonUtc('2026-03-15')]
    );

    // Personal finances: assets 50000, liabilities 20000, + two personal transactions.
    await c.query(`INSERT INTO personal_accounts (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,$3::timestamptz,$3::timestamptz)`,
      [clientId, { kind: 'asset', name: 'Savings', type: 'cash', value: 50000 }, localNoonUtc('2026-01-05')]);
    await c.query(`INSERT INTO personal_accounts (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,$3::timestamptz,$3::timestamptz)`,
      [clientId, { kind: 'liability', name: 'Car loan', type: 'loan', value: 20000 }, localNoonUtc('2026-01-05')]);
    await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,$3::timestamptz,$3::timestamptz)`,
      [clientId, { description: 'Salary', category: 'income', amount: 8000, tx_type: 'income', tx_date: '2026-02-01' }, localNoonUtc('2026-02-01')]);
    await c.query(`INSERT INTO personal_transactions (user_id, entity_id, data, created_at, updated_at) VALUES ($1,NULL,$2,$3::timestamptz,$3::timestamptz)`,
      [clientId, { description: 'Rent', category: 'housing', amount: 2000, tx_type: 'expense', tx_date: '2026-02-03' }, localNoonUtc('2026-02-03')]);

    // ── Accountant + active link (entity_access starts NULL = legacy) ──────────────────────────
    const accId = (await c.query(
      `INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
       VALUES ('scope-acc@finflow.test', $1, 'Acc', 'Scope', 'Firm', 'SCOPECODE', 'verified') RETURNING id`,
      [bcrypt.hashSync(PW, 10)]
    )).rows[0].id;
    await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', 'view')`, [accId, clientId]);

    const owner = new HarnessHttp(server.baseUrl);
    const acc   = new HarnessHttp(server.baseUrl);
    if ((await owner.post('/api/auth/login', { email: 'scope-client@finflow.test', password: PW })).status !== 200) throw new Error('owner login failed');
    if ((await acc.post('/api/accountants/login', { email: 'scope-acc@finflow.test', password: PW })).status !== 200) throw new Error('accountant login failed');

    const BOOKS = `/api/accountants/clients/${clientId}/books`;
    const JOURNAL = `/api/accountants/clients/${clientId}/journal`;
    const LOCK = `/api/accountants/clients/${clientId}/lock`;
    const setAccess = ea => owner.put('/api/accountants/my-accountant/access', { entity_access: ea });
    const setLegacy = lvl => owner.put('/api/accountants/my-accountant/access', { access_level: lvl });
    const getBooks = q => acc.get(BOOKS + (q || ''));
    const entNames = b => (b.entities || []).map(e => e.name).sort();
    const hasMarker = b => JSON.stringify(b.allInvoices || []).includes('77777');

    console.log('\n' + '='.repeat(78));
    console.log('  ACCOUNTANT PER-ENTITY + PERSONAL ACCESS SCOPE (end-to-end, real PG)');
    console.log('='.repeat(78));

    // ── PHASE 0 — legacy (entity_access NULL): all entities visible, personal hidden ──────────
    console.log('\n-- phase 0: legacy link (entity_access NULL) --');
    let b0 = (await getBooks()).json;
    A('legacy: both entities visible', entNames(b0).includes('Entity B Ltd') && b0.entities.length === 2, entNames(b0).join(','));
    A('legacy: entity B $77,777 present in books', hasMarker(b0));
    A('legacy: personal NOT exposed (null)', b0.personal == null && b0.personalAccess === 'none', `personalAccess ${b0.personalAccess}`);
    const legacyAggRevenue = b0.summary.revenue;

    // ── PHASE 1 — grant all view + personal view: aggregate includes B ────────────────────────
    console.log('\n-- phase 1: grant A=view, B=view, personal=view --');
    const g1 = await setAccess({ entities: { [entA]: 'view', [entB]: 'view' }, personal: 'view' });
    A('PUT entity_access → 200', g1.status === 200, `status ${g1.status}: ${g1.text.slice(0,160)}`);
    let b1 = (await getBooks()).json;
    A('phase1: both entities visible', b1.entities.length === 2 && entNames(b1).includes('Entity B Ltd'));
    A('phase1: B marker present', hasMarker(b1));
    A('phase1: aggregate revenue == legacy aggregate (scoped-all == computeBooks(null))', money(b1.summary.revenue) === money(legacyAggRevenue), `${b1.summary.revenue} vs ${legacyAggRevenue}`);
    A('phase1: entityAccess map correct', b1.entityAccess[entA] === 'view' && b1.entityAccess[entB] === 'view');
    A('phase1: personal exposed (view)', b1.personal != null && b1.personalAccess === 'view');
    A('phase1: personal netWorth = assets + portfolio − liabilities (self-consistent)',
      money(b1.personal.netWorth) === money(Number(b1.personal.assets) + Number(b1.personal.portfolio) - Number(b1.personal.liabilities)),
      `nw ${b1.personal.netWorth} a ${b1.personal.assets} p ${b1.personal.portfolio} l ${b1.personal.liabilities}`);
    A('phase1: personal assets/liabilities as seeded (50000/20000)', money(b1.personal.assets) === '50000.00' && money(b1.personal.liabilities) === '20000.00');
    const revA = b1.summariesByEntity[entA].revenue;
    const revB = b1.summariesByEntity[entB].revenue;
    A('phase1: entity B summary revenue == 77777 (discriminator)', money(revB) === '77777.00', `revB ${revB}`);

    // ── PHASE 2 — scope: A=filing, B=none, personal=view ─────────────────────────────────────
    console.log('\n-- phase 2: A=filing, B=none, personal=view --');
    A('PUT scope → 200', (await setAccess({ entities: { [entA]: 'filing', [entB]: 'none' }, personal: 'view' })).status === 200);
    let b2 = (await getBooks()).json;
    A('phase2: entity B HIDDEN from entities[]', !entNames(b2).includes('Entity B Ltd') && b2.entities.length === 1);
    A('phase2: B $77,777 NOT served in any invoice (RED)', !hasMarker(b2));
    A('phase2: entityAccess shows A=filing, B=none', b2.entityAccess[entA] === 'filing' && b2.entityAccess[entB] === 'none');
    A('phase2: summariesByEntity has A only', b2.summariesByEntity[entA] != null && b2.summariesByEntity[entB] == null);
    A('phase2: aggregate revenue == A only (== all − 77777)',
      money(b2.summary.revenue) === money(revA) && money(b2.summary.revenue) === money(Number(legacyAggRevenue) - 77777),
      `agg ${b2.summary.revenue} revA ${revA}`);
    A('phase2: books?entity_id=B → 403 (RED — hidden even by direct id)', (await getBooks(`?entity_id=${entB}`)).status === 403);
    A('phase2: books?entity_id=A → 200', (await getBooks(`?entity_id=${entA}`)).status === 200);
    // Writes
    A('phase2: POST journal (default entity=A, filing) → 201', (await acc.post(JOURNAL, { date: '2026-07-10', description: 'adj A', lines: [{ debit: 100 }, { credit: 100 }] })).status === 201);
    A('phase2: POST journal entity_id=A (filing) → 201', (await acc.post(JOURNAL, { entity_id: entA, date: '2026-07-11', description: 'adj A2', lines: [{ debit: 5 }, { credit: 5 }] })).status === 201);
    A('phase2: POST journal entity_id=B (none) → 403 (RED — write denied)', (await acc.post(JOURNAL, { entity_id: entB, date: '2026-07-12', description: 'adj B', lines: [{ debit: 9 }, { credit: 9 }] })).status === 403);
    A('phase2: lock (A is filing) → 200', (await acc.post(LOCK, { period: '2026-06', locked: true })).status === 200);
    A('phase2: personal still exposed (view)', b2.personal != null && b2.personalAccess === 'view');

    // ── PHASE 3 — A=view, B unlisted (→none), personal=none ──────────────────────────────────
    console.log('\n-- phase 3: A=view, B unlisted (none), personal=none --');
    A('PUT → 200', (await setAccess({ entities: { [entA]: 'view' }, personal: 'none' })).status === 200);
    let b3 = (await getBooks()).json;
    A('phase3: only A visible (B unlisted ⇒ none)', b3.entities.length === 1 && entNames(b3)[0].startsWith('') && !entNames(b3).includes('Entity B Ltd'));
    A('phase3: personal HIDDEN (null) under personal=none (RED)', b3.personal == null && b3.personalAccess === 'none');
    A('phase3: POST journal to A (view) → 403 (RED — write denied on view entity)', (await acc.post(JOURNAL, { entity_id: entA, date: '2026-07-13', description: 'no', lines: [{ debit: 1 }, { credit: 1 }] })).status === 403);
    A('phase3: lock (no entity filing) → 403 (RED)', (await acc.post(LOCK, { period: '2026-05', locked: true })).status === 403);

    // ── PHASE 4 — legacy revert clears the fine-grained map ───────────────────────────────────
    console.log('\n-- phase 4: legacy grant {access_level:filing} clears entity_access --');
    A('PUT {access_level:filing} → 200', (await setLegacy('filing')).status === 200);
    let b4 = (await getBooks()).json;
    A('phase4: both entities visible again (map cleared → legacy all-entities)', b4.entities.length === 2 && entNames(b4).includes('Entity B Ltd'));
    A('phase4: B $77,777 present again', hasMarker(b4));
    A('phase4: personal hidden again (legacy null)', b4.personal == null && b4.personalAccess === 'none');
    A('phase4: POST journal → 201 (account-wide filing)', (await acc.post(JOURNAL, { date: '2026-07-14', description: 'adj legacy', lines: [{ debit: 2 }, { credit: 2 }] })).status === 201);

    // ── validation ──
    console.log('\n-- validation --');
    A('PUT bogus entity_access → 400', (await owner.put('/api/accountants/my-accountant/access', { entity_access: 42 })).status === 400);

    console.log('\n' + '-'.repeat(78));
    console.log(fail === 0 ? '  ALL GREEN - ' + pass + ' passed, 0 failed  (per-entity + personal access scope)'
                           : '  ' + fail + ' FAILED, ' + pass + ' passed');
    console.log('-'.repeat(78) + '\n');
  } finally {
    if (server && server.close) await server.close();
    await scratch.stop();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('\n[acc-entity-scope] PROBE ERROR — ' + (e && e.stack ? e.stack : String(e)));
  if (e && e.code) console.error('  code: ' + e.code);
  if (e && e.errors) for (const sub of e.errors) console.error('  · ' + (sub && sub.stack ? sub.stack : String(sub)));
  process.exit(1);
});
