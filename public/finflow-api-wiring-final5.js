// FinFlow API Wiring — Final5
// Modules: Sales Receipts, Payments Received, Credit Notes, Payments Made, Vendor Credits, AI

/* ══════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════ */
async function apiFetch(path, opts={}){
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  if(!res.ok){ const e = await res.json().catch(()=>({})); throw new Error(e.error||res.status); }
  return res.json();
}

function fmtMoney(n){ return '$' + Number(n||0).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0}); }
function fmtDate(s){ if(!s)return ''; return window.FinFlowDates ? window.FinFlowDates.fmtLabel(s, { year: true }) : s; }   // F195: TZ-safe calendar date (was new Date().toLocaleDateString → shifted west of UTC)
function nextNum(prefix, list, field='num'){
  const nums = list.map(r=>(r[field]||'').replace(prefix+'-','0')).map(Number).filter(n=>!isNaN(n));
  const next = nums.length ? Math.max(...nums)+1 : 1;
  return prefix + '-' + String(next).padStart(4,'0');
}

/* ══════════════════════════════════════════════════════════════════
   SALES RECEIPTS
══════════════════════════════════════════════════════════════════ */



function _sv(id,v){const el=document.getElementById(id); if(el) el.value=v;}
function _st(id,v){const el=document.getElementById(id); if(el) el.textContent=v;}




/* ══════════════════════════════════════════════════════════════════
   PAYMENTS RECEIVED
══════════════════════════════════════════════════════════════════ */



// F35 Step 5: renamed off the colliding `openRecordPaymentModal` name — that name is now
// exclusively the invoice Store-B opener (index.html:4160). This is the Store-A received-payment
// opener for the Payments-Received page. (pages.js also defines window.openPaymentReceivedModal
// and wins by load order; this decl is the same Store-A intent.)




/* ══════════════════════════════════════════════════════════════════
   CREDIT NOTES
══════════════════════════════════════════════════════════════════ */






// F84 / Failure #1 (F75): the `savePaymentMade` that once lived here was a DEAD SHADOW. The bundle
// loads this file (finflow-bundle.js:3175) BEFORE finflow-api-wiring-pages.js's
// `window.savePaymentMade = …` (:4178), which overwrote this global — so this copy never ran, and it
// omitted `bill_id` (the F84 double-count). It is deleted so only the one pages.js runtime winner
// remains. Do not reintroduce a savePaymentMade here.


/* ══════════════════════════════════════════════════════════════════
   VENDOR CREDITS
══════════════════════════════════════════════════════════════════ */







/* ══════════════════════════════════════════════════════════════════
   AI CHAT
══════════════════════════════════════════════════════════════════ */
let _aiHistory = [];

function renderAIPage(){
  const container = document.getElementById('ai-chat-messages');
  if(!container) return;
  if(!_aiHistory.length){
    container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--t3)">
      <div style="font-size:32px;margin-bottom:12px">✦</div>
      <div style="font-size:14px;font-weight:600;color:var(--t2);margin-bottom:8px">FinFlow AI</div>
      <div style="font-size:13px">Ask me anything about your business — revenue, expenses, cash flow, forecasting, or financial strategy.</div>
    </div>`;
    return;
  }
  container.innerHTML = _aiHistory.map(m=>`
    <div style="display:flex;flex-direction:${m.role==='user'?'row-reverse':'row'};gap:10px;margin-bottom:16px;align-items:flex-start">
      <div style="width:30px;height:30px;border-radius:50%;background:${m.role==='user'?'var(--accent)':'var(--bg3)'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${m.role==='user'?'#fff':'var(--t1)'};flex-shrink:0">${m.role==='user'?'U':'✦'}</div>
      <div style="max-width:75%;background:${m.role==='user'?'var(--accent)':'var(--bg2)'};color:${m.role==='user'?'#fff':'var(--t1)'};border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.5;white-space:pre-wrap">${escHTML(m.content)}</div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function escHTML(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function sendAIMessage(){
  const input = document.getElementById('ai-input'); if(!input) return;
  const message = input.value.trim(); if(!message) return;
  input.value = '';

  _aiHistory.push({ role: 'user', content: message });
  renderAIPage();

  // Show typing indicator
  const container = document.getElementById('ai-chat-messages');
  if(container){
    const typing = document.createElement('div');
    typing.id = 'ai-typing';
    typing.style.cssText = 'display:flex;gap:10px;margin-bottom:16px;align-items:flex-start';
    typing.innerHTML = `<div style="width:30px;height:30px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:12px">✦</div><div style="background:var(--bg2);border-radius:12px;padding:10px 14px;font-size:13px;color:var(--t3)">Thinking…</div>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  try{
    const data = await apiFetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: _aiHistory.slice(0,-1) })
    });
    const typing2 = document.getElementById('ai-typing'); if(typing2) typing2.remove();
    _aiHistory.push({ role: 'assistant', content: data.reply || 'No response.' });
  } catch(e){
    const typing3 = document.getElementById('ai-typing'); if(typing3) typing3.remove();
    _aiHistory.push({ role: 'assistant', content: 'Error: ' + (e.message || 'Could not reach AI. Make sure ANTHROPIC_API_KEY is set in .env') });
  }
  renderAIPage();
}

function clearAIChat(){
  _aiHistory = [];
  renderAIPage();
}

// Hook up AI send button and enter key
(function _run() { if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _run); return; }
  const sendBtn = document.getElementById('ai-send-btn');
  if(sendBtn) sendBtn.addEventListener('click', sendAIMessage);
  const inp = document.getElementById('ai-input');
  if(inp) inp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendAIMessage(); } });
  const clearBtn = document.getElementById('ai-clear-btn');
  if(clearBtn) clearBtn.addEventListener('click', clearAIChat);
})();
