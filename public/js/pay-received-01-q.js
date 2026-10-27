// Moved out of pay-received.html (FA-P1, 2026-10-27): the page runs under a Content-Security-Policy with no inline
// script, so every script is a file. It still runs at the same place in the page, in the same order.
    (function(){
      var q=new URLSearchParams(location.search);
      var status=(q.get('status')||'success').toLowerCase();
      var ref=q.get('ref')||q.get('order_id')||q.get('reference')||'';
      if(status==='cancelled'||status==='cancel'||status==='failed'){
        var b=document.getElementById('badge'); b.className='badge no'; b.textContent='!';
        document.getElementById('title').textContent='Payment not completed';
        document.getElementById('msg').textContent='Your payment was cancelled or did not go through, and no charge was made. You can close this window and try again from your invoice.';
      }
      if(ref){ document.getElementById('ref').textContent='Reference: '+ref; }
    })();
