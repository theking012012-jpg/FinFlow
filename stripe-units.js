'use strict';
// Stripe amounts are in the currency's MINOR unit, whose exponent varies by currency: 0 for JPY/KRW/…,
// 3 for BHD/KWD/…, 2 otherwise (Stripe's documented zero- and three-decimal lists). A hardcoded /100 or
// *100 is wrong for a multi-currency product (N47). Single shared converter — every Stripe money path
// (server.js, accountant-routes.js) routes through it. Pure; no I/O.
const ZERO_DEC = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DEC = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);
function currencyExponent(cur) { const c = String(cur || 'usd').toUpperCase(); return ZERO_DEC.has(c) ? 0 : THREE_DEC.has(c) ? 3 : 2; }
function minorToMajor(amount, cur) { return Math.round(Number(amount) || 0) / Math.pow(10, currencyExponent(cur)); }
function majorToMinor(amount, cur) { return Math.round((Number(amount) || 0) * Math.pow(10, currencyExponent(cur))); }
module.exports = { currencyExponent, minorToMajor, majorToMinor };
