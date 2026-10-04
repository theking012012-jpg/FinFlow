
(function(){

const FEATURE_INFO = {
  mrr:           { title: 'MRR / SaaS Dashboard',    perks: ['MRR, churn & expansion tracking','Revenue cohort analysis','SaaS growth metrics'] },
  banking:       { title: 'Live Bank Sync',           perks: ['Connect any bank via Plaid','Automatic transaction import','Real-time balance sync'] },
  scanner:       { title: 'AI Receipt Scanner',       perks: ['Claude Vision extracts vendor, amount & date','Supports photos and PDFs','Auto-categorise in one tap'] },
  ai_limit:      { title: 'Unlimited AI Queries',     perks: ['No monthly cap — ask anything','Full financial analysis access','Priority AI processing'] },
  invoice_limit: { title: 'Uncapped Invoicing',       perks: ['Beyond Pro\'s 500/mo fair-use ceiling','Unlimited recurring profiles','Priority invoice delivery'] },
  entity:        { title: 'Multiple Entities',        perks: ['Up to 5 separate ledgers','Consolidated multi-entity P&L','Independent chart of accounts per entity'] },
};

window.showUpgradeModal = function(feature) {
  const info = FEATURE_INFO[feature] || { title: 'Business Plan Feature', perks: ['Unlock all Business features'] };
  const existing = document.getElementById('upgrade-modal-overlay');
  if(existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'upgrade-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML =
    '<div style="background:var(--bg1);border:1px solid var(--bd2);border-radius:var(--radius-xl);padding:2rem;max-width:380px;width:100%;box-shadow:0 32px 80px rgba(0,0,0,.5)">' +
      '<div style="text-align:center;margin-bottom:1.5rem">' +
        '<div style="width:52px;height:52px;background:var(--acc-bg);border:1px solid var(--acc);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:22px">&#10022;</div>' +
        '<div style="font-size:11px;color:var(--acc);font-weight:600;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px">Business Plan</div>' +
        '<div style="font-size:20px;font-family:var(--font-display);font-style:italic;color:var(--t1);font-weight:600;line-height:1.2">' + info.title + '</div>' +
        '<div style="font-size:12.5px;color:var(--t3);margin-top:6px">requires the Business plan</div>' +
      '</div>' +
      '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:1rem;margin-bottom:1.5rem">' +
        '<div style="font-size:10.5px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.65rem">What you unlock</div>' +
        info.perks.map(function(p){ return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12.5px;color:var(--t1)"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round"><polyline points="2,8 6,12 14,4"/></svg>'+p+'</div>'; }).join('') +
      '</div>' +
      '<button class="btn btn-primary" style="width:100%;justify-content:center;font-size:13px;padding:10px" onclick="document.getElementById(\'upgrade-modal-overlay\').remove();showPage(\'pricing\',null)">Upgrade to Business →</button>' +
      '<button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:8px;font-size:12px" onclick="document.getElementById(\'upgrade-modal-overlay\').remove()">Maybe later</button>' +
    '</div>';
  overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

})();
