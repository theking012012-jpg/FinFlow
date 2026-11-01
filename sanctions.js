'use strict';
// Countries under COMPREHENSIVE United States embargoes (owner decision 2026-11-01: the company is US-registered).
// FinFlow is not offered to businesses located there (Terms §11). The ONE list: the server refuses a business country,
// or a personal bank country, in it; the read-only tool tools/launch/list-embargoed-country-records.js reports any
// record already holding one (Rule 8 — existing data is never changed by code).
// Deliberately narrow: only embargoes that cover essentially all trade. Programmes that changed in 2025 (Syria) or are
// sector-specific (Russia / Belarus IT-services restrictions, Venezuela government sanctions) are for legal review,
// not guessed here. Regions without an ISO code (Crimea, Donetsk, Luhansk) cannot be matched by a country field.
const EMBARGOED = Object.freeze({ CU: 'Cuba', IR: 'Iran', KP: 'North Korea' });
const embargoed = cc => (cc == null ? null : (EMBARGOED[String(cc).trim().toUpperCase()] || null));
const refusal = name => ({ error: `FinFlow is not available for ${name} because of United States sanctions.`, code: 'SANCTIONED_COUNTRY' });
module.exports = { EMBARGOED, embargoed, refusal };
