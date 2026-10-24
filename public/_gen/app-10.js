
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
