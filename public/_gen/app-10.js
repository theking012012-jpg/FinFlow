
// ── TRIAL / CHECKOUT ──────────────────────────────────────────────────────────
async function startTrial(plan) {
  try {
    notify('Redirecting to checkout… ✦');
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
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
