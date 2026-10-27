// Moved out of accountant-register.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
  // ── RESUME UPLOAD ──────────────────────────────────────────────────────────
  window._resumeCredentials = '';
  window._resumeMemberships = '';

  async function handleResumeUpload(file) {
    if (!file) return;
    const status = document.getElementById('resume-status');
    const zone = document.getElementById('resume-drop-zone');
    status.className = 'resume-status loading';
    status.textContent = '✦ AI is reading your CV — filling in your profile...';
    zone.style.opacity = '0.5';
    zone.style.pointerEvents = 'none';

    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(',')[1]);
        reader.onerror = () => rej(new Error('Read failed'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/accountants/extract-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64,
          mediaType: file.type,
          isPDF: file.type === 'application/pdf',
          isWord: file.name.endsWith('.docx') || file.name.endsWith('.doc'),
          fileName: file.name
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      if (data.firstName) document.getElementById('fname').value = data.firstName;
      if (data.lastName) document.getElementById('lname').value = data.lastName;
      if (data.firm) document.getElementById('firm').value = data.firm;
      if (data.bio) document.getElementById('bio').value = data.bio;

      if (data.country) {
        const sel = document.getElementById('country');
        for (let o of sel.options) {
          if (o.value && o.value.toLowerCase().includes(data.country.toLowerCase())) { sel.value = o.value; break; }
        }
      }
      if (data.specialisation) {
        const sel = document.getElementById('spec');
        for (let o of sel.options) {
          if (o.value && o.value.toLowerCase().includes(data.specialisation.toLowerCase())) { sel.value = o.value; break; }
        }
      }
      if (data.experience) {
        const sel = document.getElementById('experience');
        if (sel) {
          for (let o of sel.options) {
            if (o.value && o.value.startsWith(data.experience.split('-')[0])) { sel.value = o.value; break; }
          }
        }
      }

      window._resumeCredentials = data.credentials || '';
      window._resumeMemberships = data.memberships || '';

      status.className = 'resume-status success';
      status.textContent = '✓ Profile filled from your CV — review and edit below';
    } catch(e) {
      status.className = 'resume-status error';
      status.textContent = '✗ Could not read CV — please fill in manually';
    } finally {
      zone.style.opacity = '1';
      zone.style.pointerEvents = 'auto';
    }
  }

  // Drag and drop
  document.addEventListener('DOMContentLoaded', function() {
    const dz = document.getElementById('resume-drop-zone');
    if (!dz) return;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--gold)'; });
    dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.style.borderColor = '';
      if (e.dataTransfer.files[0]) handleResumeUpload(e.dataTransfer.files[0]);
    });
  });

  // ── STEP NAVIGATION ──
  function goStep2() {
    try {
      const fname    = document.getElementById('fname').value.trim();
      const lname    = document.getElementById('lname').value.trim();
      const email    = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const firm     = document.getElementById('firm').value.trim();
      const country  = document.getElementById('country').value;
      const spec     = document.getElementById('spec').value;

      if (!fname || !lname || !email || !password || !firm || !country || !spec) {
        alert('Please fill in all required fields.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        alert('Please enter a valid email address.');
        return;
      }
      if (password.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
      }

      setStep(2);
    } catch (e) {
      console.error('[goStep2] validation error:', e);
      alert('Validation error. Please check your entries and try again.');
    }
  }

  function goStep1() { setStep(1); }

  function setStep(n) {
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    document.getElementById('pane' + n).classList.add('active');

    document.querySelectorAll('.step').forEach((s, i) => {
      s.classList.remove('active', 'done');
      if (i + 1 < n) s.classList.add('done');
      else if (i + 1 === n) s.classList.add('active');
    });

    const card = document.querySelector('.form-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function goStep3() {
    try {
      if (!selectedVerify) { alert('Please choose a verification method.'); return; }
      const exp = document.getElementById('experience').value;
      if (!exp) { alert('Please select your years of experience.'); return; }
      setStep(3);
    } catch (e) {
      console.error('[goStep3] validation error:', e);
      alert('Validation error. Please check your entries and try again.');
    }
  }

  function goStep2Pricing() { setStep(2); }

  // ── PACKAGE MANAGEMENT ──
  let packageCount = 0;

  function addPackage() {
    if (packageCount >= 4) { alert('Maximum 4 packages allowed.'); return; }
    packageCount++;
    const id = packageCount;
    const div = document.createElement('div');
    div.className = 'package-row';
    div.id = 'pkg-' + id;
    div.innerHTML = `
      <input type="text" placeholder="e.g. Personal tax return" id="pkg-name-${id}" style="font-size:12px">
      <div style="position:relative">
        <span class="rate-sym" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:12px">${esc(rateSymbol())}</span>
        <input type="number" placeholder="200" id="pkg-price-${id}" min="0" style="padding-left:34px;font-size:12px">
      </div>
      <button type="button" class="pkg-remove" onclick="removePackage(${id})">×</button>
    `;
    document.getElementById('packages-list').appendChild(div);
    if (packageCount >= 4) document.getElementById('add-package-btn').style.display = 'none';
  }

  function removePackage(id) {
    const el = document.getElementById('pkg-' + id);
    if (el) el.remove();
    packageCount--;
    document.getElementById('add-package-btn').style.display = '';
  }

  // LA15c (owner decision 2026-10-14): rates are in the accountant's own currency — defaulted from the country,
  // changeable, and sent as rateCurrency (shared table: /finflow-currency.js).
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function rateSymbol() {
    const c = (document.getElementById('rate-currency') || {}).value || 'USD';
    return window.FinFlowCurrency ? window.FinFlowCurrency.symbol(c) : '$';
  }
  function syncRateSymbols() { document.querySelectorAll('.rate-sym').forEach(el => { el.textContent = rateSymbol(); }); }
  window.syncRateSymbols = syncRateSymbols;
  (function initRateCurrency() {
    const sel = document.getElementById('rate-currency');
    if (!sel || !window.FinFlowCurrency) return;
    const C = window.FinFlowCurrency.CURRENCIES;
    sel.innerHTML = Object.keys(C).sort().map(k => `<option value="${k}">${k} — ${esc(C[k].name || k)}</option>`).join('');
    const fromCountry = () => { const n = (document.getElementById('country') || {}).value; return (window.FinFlowCurrency.COUNTRY_CURRENCY[n]) || 'USD'; };
    sel.value = fromCountry();
    let touched = false;
    sel.addEventListener('change', () => { touched = true; });
    const cty = document.getElementById('country');
    if (cty) cty.addEventListener('change', () => { if (!touched) { sel.value = fromCountry(); syncRateSymbols(); } });
    syncRateSymbols();
  })();

  function collectPricing() {
    const hourly = parseFloat(document.getElementById('rate-hourly').value) || null;
    const note = document.getElementById('pricing-note').value.trim();
    const packages = [];
    for (let i = 1; i <= 4; i++) {
      const nameEl = document.getElementById('pkg-name-' + i);
      const priceEl = document.getElementById('pkg-price-' + i);
      if (nameEl && priceEl && nameEl.value.trim() && priceEl.value) {
        packages.push({ name: nameEl.value.trim(), price: parseFloat(priceEl.value) });
      }
    }
    return { hourlyRate: hourly, packages, pricingNote: note, rateCurrency: (document.getElementById('rate-currency') || {}).value || 'USD' };
  }

  // ── VERIFICATION METHOD SELECTION ──
  let selectedVerify = null;
  function selectVerify(el, method) {
    document.querySelectorAll('.verify-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    selectedVerify = method;
    document.getElementById('verify-membership').style.display = method === 'membership' ? 'block' : 'none';
    document.getElementById('verify-employer').style.display = method === 'employer' ? 'block' : 'none';
    document.getElementById('verify-institution').style.display = method === 'institution' ? 'block' : 'none';
  }

  // ── CREDENTIAL PROOF UPLOAD (Step F — persisted for manual admin review) ──
  window._credentialDoc = null;
  const CRED_MAX_BYTES = 5 * 1024 * 1024;
  const CRED_TYPES = ['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  async function handleCredentialUpload(file) {
    const status = document.getElementById('credential-status');
    if (!file) { window._credentialDoc = null; status.style.display = 'none'; return; }
    if (!CRED_TYPES.includes(file.type)) {
      window._credentialDoc = null;
      status.className = 'resume-status error'; status.textContent = '✗ Unsupported file type — use PDF, image (JPG/PNG/WebP), or Word.';
      return;
    }
    if (file.size > CRED_MAX_BYTES) {
      window._credentialDoc = null;
      status.className = 'resume-status error'; status.textContent = '✗ File too large — maximum 5 MB.';
      return;
    }
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.onerror = () => rej(new Error('read failed'));
        r.readAsDataURL(file);
      });
      window._credentialDoc = { base64, fileName: file.name, mediaType: file.type };
      status.className = 'resume-status success';
      status.textContent = '✓ ' + file.name + ' attached — a FinFlow admin will review it.';
    } catch (e) {
      window._credentialDoc = null;
      status.className = 'resume-status error'; status.textContent = '✗ Could not read the file — please try again.';
    }
  }

  // ── MEMBERSHIP: no automated verification (F16) ──
  // The old client-side "instant verify" was a simulation — any 6+ char number
  // "passed" and showed "Verified automatically." That was a fake. Verification is
  // now a manual admin review with no auto-approve; the honest pending note is
  // rendered statically under the membership field, so there is no lookup handler.

  // ── FORM SUBMISSION ──
  async function submitForm() {
    const btn = document.querySelector('#pane3 .btn-primary');
    const exp = document.getElementById('experience').value;
    if (!exp) { alert('Please select your years of experience.'); return; }
    // D-E: an explicit acceptance of the current Professional Conduct Policy (the server checks the version too).
    const _conductBox = document.getElementById('conduct-accept');
    if (!_conductBox || !_conductBox.checked) { alert('Please read and accept the Professional Conduct Policy to submit your application.'); if (_conductBox) _conductBox.focus(); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
      const payload = {
        firstName:     document.getElementById('fname').value.trim(),
        lastName:      document.getElementById('lname').value.trim(),
        email:         document.getElementById('email').value.trim(),
        password:      document.getElementById('password').value,
        firm:          document.getElementById('firm').value.trim(),
        country:       document.getElementById('country').value,
        specialisation: document.getElementById('spec').value,
        bio:           document.getElementById('bio').value.trim(),
        experience:    exp,
        referralCode:  document.getElementById('referral').value.trim(),
        credentials:   window._resumeCredentials || '',
        memberships:   window._resumeMemberships || '',
        credentialDoc: window._credentialDoc || undefined,   // Step F — persisted credential proof
        conductAccepted: true,                                                     // D-E: the box above is ticked
        conductVersion:  (window.FinFlowConduct && window.FinFlowConduct.VERSION) || '',
        ...collectPricing(),
        verification: {
          method:           selectedVerify,
          profBody:         selectedVerify === 'membership' ? document.getElementById('prof-body').value : null,
          membershipNumber: selectedVerify === 'membership' ? document.getElementById('membership-num').value.trim() : null,
          employerFirm:     selectedVerify === 'employer'   ? document.getElementById('emp-firm').value.trim()     : null,
          employerContact:  selectedVerify === 'employer'   ? document.getElementById('emp-contact').value.trim()  : null,
          employerPhone:    selectedVerify === 'employer'   ? document.getElementById('emp-phone').value.trim()    : null,
          institution:      selectedVerify === 'institution'? document.getElementById('inst-name').value.trim()   : null,
          degree:           selectedVerify === 'institution'? document.getElementById('inst-degree').value.trim() : null,
        }
      };

      const res = await fetch('/api/accountants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      let data;
      try { data = await res.json(); } catch (e) { data = {}; }

      if (!res.ok || data.error) {
        alert(data.error || ('Registration failed (' + res.status + '). Please try again.'));
        if (btn) { btn.disabled = false; btn.textContent = 'Submit application →'; }
        return;
      }

      setStep(4);
    } catch (err) {
      console.error('[Register] submit error:', err);
      alert('Could not connect to server. Please check your connection and try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Submit application →'; }
    }
  }
