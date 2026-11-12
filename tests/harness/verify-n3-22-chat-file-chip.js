'use strict';
/**
 * verify-n3-22-chat-file-chip.js — N3-22 (owner screenshot 2026-11-12).
 * Owner's My Accountant chat: a file the OWNER sent showed its chip "owner-check.txt · 27 B" as dark text on a dark
 * translucent box BELOW the gold bubble — on the dark page it was nearly invisible (the chip's colours were meant for
 * inside the gold bubble). Both chats also printed the file name twice: the auto caption "📎 name" and the chip.
 *
 * Executed in Chromium (browserKit, real server, real owner AND real accountant sessions). Seed through the real routes:
 * owner sends a file (owner-check.txt, 27 bytes), accountant sends a file (accountant-check.csv), owner sends text.
 * Measured on the rendered page — for every file chip:
 *   · it sits INSIDE a message bubble (owner side: the chip's nearest coloured box is the bubble);
 *   · contrast of its text against the colour actually behind it (alpha-composited up to the first opaque layer) ≥ 4.5;
 *   · the file name appears exactly ONCE in that message (bug: twice).
 * BUG VALUES (owner side, own file): contrast ≈ 1.1 (#0e0b08 on the dark page); name printed twice.
 */
const { HarnessHttp } = require('./httpClient.js');
const bcrypt = require('bcryptjs');
const { runBrowser } = require('./browserKit.js');

runBrowser('N3-22 — chat file chips are readable and named once (owner + accountant views)', async ({ open, A, c, uid, http, base }) => {
  const acc = (await c.query(`INSERT INTO accountants (email, password_hash, first_name, last_name, firm, referral_code, status)
     VALUES ('n322-acc@finflow.test', $1, 'Ada', 'Ledger', 'Firm', 'N322', 'verified') RETURNING id`, [bcrypt.hashSync('pw-not-a-secret', 10)])).rows[0].id;
  await c.query(`INSERT INTO accountant_clients (accountant_id, user_id, status, access_level) VALUES ($1, $2, 'active', 'view')`, [acc, uid]);
  const okr = r => { if (r.status >= 300) throw new Error(r.status + ' ' + r.text.slice(0, 160)); return r; };
  okr(await http.post('/api/accountants/my-accountant/attach', { name: 'owner-check.txt', mime: 'text/plain', dataB64: Buffer.from('owner receipt 2026-11-11 ok\n').toString('base64') }));
  const accH = new HarnessHttp(base);
  okr(await accH.post('/api/accountants/login', { email: 'n322-acc@finflow.test', password: 'pw-not-a-secret' }));
  okr(await accH.post('/api/accountants/clients/attach', { userId: uid, name: 'accountant-check.csv', mime: 'text/csv', dataB64: Buffer.from('date,amount\n2026-11-11,12.34\n').toString('base64') }));
  okr(await http.post('/api/accountants/my-accountant/messages', { content: 'Plain reply from the owner' }));

  const measure = () => {
    const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const behind = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const bg = parse(getComputedStyle(e).backgroundColor); if (bg[3] > 0) { layers.push(bg); if (bg[3] >= 1) break; } }
      let col = [0, 0, 0]; for (let i = layers.length - 1; i >= 0; i--) { const [r, g, b, a] = layers[i]; col = [r * a + col[0] * (1 - a), g * a + col[1] * (1 - a), b * a + col[2] * (1 - a)]; } return col; };
    return [...document.querySelectorAll('a[href^="/api/accountants/chat-attachment/"]')].map(a => {
      const fg = parse(getComputedStyle(a).color), bg = behind(a);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const name = (a.textContent.match(/[\w.-]+\.(txt|csv)/) || [''])[0];
      // the message = the chip's bubble (owner view: coloured box with a border-radius; accountant view: .msg-bubble)
      let bubble = a.parentElement; while (bubble && !(bubble.classList.contains('msg-bubble') || (parse(getComputedStyle(bubble).backgroundColor)[3] >= 1 && parseFloat(getComputedStyle(bubble).borderTopLeftRadius) > 6))) bubble = bubble.parentElement;
      const msg = bubble ? (bubble.closest('.msg-bubble') || bubble.parentElement) : a.parentElement;
      const count = (msg.textContent.match(new RegExp(name.replace(/\./g, '\\.'), 'g')) || []).length;
      return { name, ratio: Math.round(ratio * 100) / 100, insideBubble: !!bubble, count };
    });
  };
  // owner view
  const op = await open({ width: 1280, height: 900 });
  await op.evaluate(() => window.showPage('my-accountant')); await op.waitForTimeout(2500);
  const o = await op.evaluate(measure);
  A('owner view: both file chips are rendered', o.length === 2, JSON.stringify(o));
  for (const x of o) {
    A(`owner view · ${x.name}: chip inside its message bubble`, x.insideBubble, JSON.stringify(x));
    A(`owner view · ${x.name}: text contrast ≥ 4.5 against what is behind it (bug ≈ 1.1 for the owner's own file)`, x.ratio >= 4.5, JSON.stringify(x));
    A(`owner view · ${x.name}: file name printed once (bug: twice)`, x.count === 1, JSON.stringify(x));
  }
  // accountant view
  const cookie = accH._cookieHeader().split(';').map(s => s.trim()).filter(Boolean).map(kv => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: base }; });
  const ap = await open({ width: 1280, height: 900, beforeGoto: async ctx => { await ctx.clearCookies(); await ctx.addCookies(cookie); } }, `/accountant-client?client=${uid}&name=Owner`);
  const errs = []; ap.on('pageerror', e => errs.push(e.message));
  await ap.evaluate(() => { const n = [...document.querySelectorAll('[data-on-click]')].find(e => /showSection\('messages'/.test(e.getAttribute('data-on-click'))); n && n.click(); });
  await ap.waitForTimeout(2500);
  const av = await ap.evaluate(measure);
  A('accountant view: both file chips are rendered', av.length === 2, JSON.stringify(av));
  for (const x of av) {
    A(`accountant view · ${x.name}: chip inside its bubble, contrast ≥ 4.5`, x.insideBubble && x.ratio >= 4.5, JSON.stringify(x));
    A(`accountant view · ${x.name}: file name printed once (bug: twice)`, x.count === 1, JSON.stringify(x));
  }
  A('accountant view: plain text message still shown', await ap.evaluate(() => /Plain reply from the owner/.test(document.body.textContent)));
  A('no page errors on the accountant page', errs.length === 0, JSON.stringify(errs));
});
