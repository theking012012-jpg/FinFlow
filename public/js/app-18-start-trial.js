// Moved out of index.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
// ── TRIAL / CHECKOUT ──────────────────────────────────────────────────────────
async function startTrial(plan) {
  try {
    notify('Redirecting to checkout… ✦');
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      // D-B: the monthly / yearly choice on the Pricing page — checkout uses that interval's price
      body: JSON.stringify({ plan, interval: window._ffBillingInterval === 'year' ? 'year' : 'month' }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      notify('Checkout unavailable — please try again.');
    }
  } catch (e) {
    notify('Checkout unavailable — please try again.');
  }
}
