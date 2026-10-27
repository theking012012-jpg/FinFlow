// Moved out of accountant-register.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
try { document.getElementById('conduct-version').textContent = window.FinFlowConduct.VERSION; } catch (_) {}
