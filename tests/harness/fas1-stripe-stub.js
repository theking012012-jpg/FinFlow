'use strict';
// A stand-in for the Stripe API used by tools/launch/link-stripe-subscriptions.js in verify-fas1-link-tool.js.
// Subscriptions come from FAS1_STUB_SUBS (JSON); every subscriptions.update call is appended to FAS1_STUB_LOG.
const fs = require('fs');
module.exports = function () {
  const subs = JSON.parse(process.env.FAS1_STUB_SUBS || '[]');
  return {
    subscriptions: {
      list: () => ({ async *[Symbol.asyncIterator]() { for (const s of subs) yield s; } }),
      update: async (id, body) => { fs.appendFileSync(process.env.FAS1_STUB_LOG, JSON.stringify({ id, body }) + '\n'); return { id }; },
    },
  };
};
