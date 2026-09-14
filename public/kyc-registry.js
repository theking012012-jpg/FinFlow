/* kyc-registry.js — KYC Phase C: map a professional body to its OFFICIAL member-verification portal
 * so admin gets a direct link to the real register instead of a generic web search. These portals are
 * search forms (admin enters the membership number on the page), so the link opens the correct
 * register; unmapped bodies fall back to a scoped web search (Phase C v1). URLs verified 2026-09-14.
 * Loaded by admin.html via <script>; also require()-able in Node for the harness. */
(function (g) {
  'use strict';
  var PORTALS = [
    { re: /\bACCA\b/i,        url: 'https://www.accaglobal.com/gb/en/member/find-an-accountant/directory-of-member.html', label: 'ACCA member directory' },
    { re: /\bICAEW\b/i,       url: 'https://find.icaew.com/',                                                             label: 'ICAEW register' },
    { re: /\bICAS\b/i,        url: 'https://www.icas.com/members-membership/find-a-ca',                                    label: 'ICAS register' },
    { re: /\b(CIMA|CGMA)\b/i, url: 'https://www.aicpa-cima.com/membership/landing/find-a-cima-student-member-or-mip',      label: 'CIMA/CGMA directory' },
    { re: /CPA\s*Ontario/i,   url: 'https://www.cpaontario.ca/protecting-the-public/directories/member',                   label: 'CPA Ontario directory' },
    { re: /CPA\s*Alberta/i,   url: 'https://services.cpaalberta.ca/VerifyEntity/Members/',                                 label: 'CPA Alberta verifier' },
    // US CPA / AICPA — NASBA national lookup. LAST so "CPA Ontario/Alberta" match first.
    { re: /\bAICPA\b|\bCPA\b|certified public accountant/i, url: 'https://cpaverify.org',                                   label: 'CPAverify (NASBA)' },
  ];

  function registryLink(body, num) {
    body = String(body == null ? '' : body).trim();
    num = String(num == null ? '' : num).trim();
    for (var i = 0; i < PORTALS.length; i++) {
      if (PORTALS[i].re.test(body)) {
        return { url: PORTALS[i].url, label: 'Open ' + PORTALS[i].label + (num ? ' — look up ' + num : ''), direct: true, body: body, number: num };
      }
    }
    return { url: 'https://www.google.com/search?q=' + encodeURIComponent(body + ' verify member ' + num), label: 'Search for ' + (body || 'member') + (num ? ' ' + num : ''), direct: false, body: body, number: num };
  }

  // Full "Registry check" detail-row HTML for the admin accountant modal. Returns '' unless both a
  // professional body and a membership number are present. esc is admin.html's HTML-escaper.
  function registryRowHtml(body, num, esc) {
    esc = typeof esc === 'function' ? esc : function (s) { return String(s == null ? '' : s); };
    if (!(body && num)) return '';
    var L = registryLink(body, num);
    var tag = L.direct
      ? '<span style="color:var(--t3);font-size:11px;margin-left:6px">official register</span>'
      : '<span style="color:var(--t3);font-size:11px;margin-left:6px">(web search)</span>';
    return '<div class="detail-row"><span class="detail-label">Registry check</span><span class="detail-val">'
      + '<a href="' + esc(L.url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--acc,#c9a84c);text-decoration:underline">'
      + esc(L.label) + ' ↗</a>' + tag + '</span></div>';
  }

  g._KYC_PORTALS = PORTALS;
  g._kycRegistryLink = registryLink;
  g._kycRegistryRow = registryRowHtml;
  if (typeof module !== 'undefined' && module.exports) module.exports = { registryLink: registryLink, registryRowHtml: registryRowHtml, PORTALS: PORTALS };
})(typeof window !== 'undefined' ? window : globalThis);
