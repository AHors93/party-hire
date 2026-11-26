(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '£' + Number(n || 0).toFixed(2);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let data = { bookings: [] };
  let tab = 'pending';
  const TABS = [
    ['pending', 'Requests', (b) => b.status === 'pending'],
    ['confirmed', 'Upcoming', (b) => b.status === 'confirmed'],
    ['deposits', 'Deposits to return', (b) => b.deposit > 0 && b.depositStatus === 'received'],
    ['completed', 'Completed', (b) => b.status === 'completed'],
    ['closed', 'Declined / cancelled', (b) => b.status === 'declined' || b.status === 'cancelled'],
    ['all', 'All', () => true],
  ];

  // UK numbers: 07… -> 447…
  function waNumber(phone) {
    let d = String(phone).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '44' + d.slice(1);
    return d;
  }
  const wa = (b, text) => `https://wa.me/${waNumber(b.phone)}?text=${encodeURIComponent(text)}`;
  const first = (b) => b.name.split(' ')[0];

  function itemsLine(b) {
    return `${b.tables} table${b.tables === 1 ? '' : 's'} & ${b.chairs} chair${b.chairs === 1 ? '' : 's'}, ${b.dates}`;
  }

  const messages = {
    confirm(b) {
      const lines = [
        `Hi ${first(b)}, it's ${data.businessName} 👋`,
        `Your booking ${b.ref} is confirmed ✅`,
        '',
        itemsLine(b),
        b.delivery ? `Delivery to: ${b.address}, ${b.postcode}` : 'Collection from us',
        '',
        `Hire: ${money(b.hireTotal)}`,
      ];
      if (b.delivery) lines.push(`Delivery & collection: ${b.deliveryFee == null ? 'TBC' : money(b.deliveryFee)}`);
      if (b.bookingFee) lines.push(`Booking fee: ${money(b.bookingFee)}`);
      if (b.deposit) lines.push(`Refundable deposit: ${money(b.deposit)} (returned after collection)`);
      lines.push(`Total to pay: ${money(b.amountDue)}`, '');
      if (b.paymentMethod === 'bank_transfer') {
        lines.push('Please pay by bank transfer to:', data.bankDetails || '[ADD YOUR BANK DETAILS]', `Reference: ${b.ref}`);
      } else {
        lines.push(`Payment in cash on ${b.delivery ? 'delivery' : 'collection'}, please.`);
      }
      lines.push('', `Booking details: ${b.statusUrl}`);
      return lines.join('\n');
    },
    decline(b) {
      return `Hi ${first(b)}, it's ${data.businessName}. Sorry – we can't do your booking ${b.ref} (${b.dates}). If other dates work, just book again or reply here 🙏`;
    },
    askRefundDetails(b) {
      return `Hi ${first(b)}, thanks for hiring with ${data.businessName} – all collected 👍 To return your ${money(b.deposit)} deposit, could you send the account name, sort code and account number you'd like it paid to?`;
    },
    depositReturned(b) {
      return `Hi ${first(b)}, your ${money(b.deposit)} deposit for booking ${b.ref} has been returned${b.paymentMethod === 'bank_transfer' ? ' to your account' : ''}. Thanks again for hiring with ${data.businessName}! ⭐`;
    },
    generic(b) {
      return `Hi ${first(b)}, it's ${data.businessName} about your booking ${b.ref} (${b.dates}).`;
    },
  };

  async function load() {
    const res = await fetch('/admin/api/bookings');
    if (!res.ok) { $('sub').textContent = 'Could not load bookings (' + res.status + ')'; return; }
    data = await res.json();
    const pending = data.bookings.filter((b) => b.status === 'pending').length;
    const deps = data.bookings.filter((b) => b.deposit > 0 && b.depositStatus === 'received').length;
    $('sub').textContent = `${pending} request${pending === 1 ? '' : 's'} waiting · ${deps} deposit${deps === 1 ? '' : 's'} held · Stock: ${data.totals.tables} tables, ${data.totals.chairs} chairs`;
    render();
  }

  async function patch(id, body) {
    const res = await fetch('/admin/api/bookings/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409 && json.canForce) {
      if (confirm(json.error + '\n\nConfirm anyway?')) return patch(id, { ...body, force: true });
      return false;
    }
    if (!res.ok) { alert(json.error || 'Update failed'); return false; }
    await load();
    return true;
  }

  function depositBlock(b) {
    if (!b.deposit || !['confirmed', 'completed'].includes(b.status)) return '';
    const label = { due: 'Not received yet', received: 'Holding', returned: 'Returned ✓', kept: 'Kept (damage/loss)' }[b.depositStatus];
    let btns = '';
    if (b.depositStatus === 'due') btns = `<button class="btn btn-ghost" data-a="dep-received">Mark deposit received</button>`;
    if (b.depositStatus === 'received') {
      if (b.paymentMethod === 'bank_transfer') btns += `<a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(wa(b, messages.askRefundDetails(b)))}">Ask for refund bank details</a>`;
      btns += `<button class="btn btn-ok" data-a="dep-return">Deposit returned → message them</button><button class="btn btn-bad" data-a="dep-keep">Keep deposit</button>`;
    }
    if (b.depositStatus === 'returned' || b.depositStatus === 'kept') btns = `<button class="btn btn-ghost" data-a="dep-undo">Undo</button>`;
    return `<div class="dep"><div class="inline"><strong>Deposit ${money(b.deposit)}</strong> · ${label}</div>
      ${b.depositStatus === 'received' && b.paymentMethod === 'bank_transfer' ? '<p class="hint">Send the money from your banking app, then tap “Deposit returned”.</p>' : ''}
      ${b.depositStatus === 'received' && b.paymentMethod === 'cash' ? '<p class="hint">Hand the cash back at collection, then tap “Deposit returned”.</p>' : ''}
      <div class="actions" style="margin-top:8px">${btns}</div></div>`;
  }

  function card(b) {
    const dq = b.deliveryQuote;
    let deliveryInfo = 'Customer collects';
    if (b.delivery) {
      const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address + ', ' + b.postcode)}`;
      deliveryInfo = `<a href="${esc(maps)}" target="_blank" rel="noopener">${esc(b.address)}, ${esc(b.postcode)}</a>`;
      if (dq && !dq.error) deliveryInfo += `<br><span class="meta">~${dq.oneWayMiles} mi each way (${dq.method === 'road' ? 'by road' : 'estimated'}) · ${dq.totalMiles} mi total · fuel ≈ ${money(dq.fuelCost)}${dq.outOfArea ? ' · <strong>outside area</strong>' : ''}</span>`;
      else if (dq?.error) deliveryInfo += `<br><span class="meta">${esc(dq.error)}</span>`;
    }
    let actions = '';
    if (b.status === 'pending') {
      actions = `<button class="btn btn-ok" data-a="confirm">Confirm &amp; message</button><button class="btn btn-bad" data-a="decline">Decline &amp; message</button>`;
    } else if (b.status === 'confirmed') {
      actions = `<button class="btn btn-ok" data-a="complete">Collected back – mark complete</button><a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(wa(b, messages.confirm(b)))}">Resend confirmation</a><button class="btn btn-bad" data-a="cancel">Cancel</button>`;
    } else if (b.status === 'declined' || b.status === 'cancelled') {
      actions = `<button class="btn btn-ghost" data-a="reopen">Re-open</button>`;
    }
    actions += `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${esc(wa(b, messages.generic(b)))}">WhatsApp</a><a class="btn btn-ghost" href="tel:${esc(b.phone)}">Call</a>`;

    return `<section class="card bk" data-id="${esc(b.id)}">
      <div class="bk-top">
        <div><h3>${esc(b.name)} <span class="badge ${esc(b.status)}">${esc(b.status)}</span></h3>
        <div class="meta">${esc(b.ref)} · requested ${new Date(b.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
        <div style="text-align:right"><strong style="font-size:20px">${money(b.amountDue)}</strong><div class="meta">${esc(b.paymentLabel)}</div></div>
      </div>
      ${b.wouldOverbook ? `<div class="note bad">⚠️ Not enough stock: only ${b.stockLeft.tables} tables / ${b.stockLeft.chairs} chairs free on these dates.</div>` : ''}
      <div class="grid">
        <div><small>Dates</small>${esc(b.dates)} (${b.days}d)</div>
        <div><small>Items</small>${b.tables} tables · ${b.chairs} chairs</div>
        <div><small>Phone</small>${esc(b.phone)}</div>
        ${b.email ? `<div><small>Email</small><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></div>` : ''}
        <div><small>Hire</small>${money(b.hireTotal)}</div>
        <div><small>Booking fee</small>${b.bookingFee ? money(b.bookingFee) : '—'}</div>
        <div><small>Deposit</small>${b.deposit ? money(b.deposit) : '—'}</div>
      </div>
      <div><small class="meta">DELIVERY</small><br>${deliveryInfo}</div>
      ${b.delivery ? `<div class="inline">Delivery fee £<input type="number" step="0.5" min="0" value="${b.deliveryFee ?? ''}" placeholder="TBC" data-f="fee" /><button class="btn btn-ghost" data-a="save-fee" style="padding:7px 12px">Save</button></div>` : ''}
      ${b.notes ? `<div class="note warn"><strong>Customer note:</strong> ${esc(b.notes)}</div>` : ''}
      <textarea class="an" placeholder="Private notes (only you see these)" data-f="notes">${esc(b.adminNotes)}</textarea>
      ${depositBlock(b)}
      <div class="actions">${actions}</div>
    </section>`;
  }

  function render() {
    $('tabs').innerHTML = TABS.map(([k, label, f]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${label} (${data.bookings.filter(f).length})</button>`).join('');
    const f = TABS.find((t) => t[0] === tab)[2];
    const list = data.bookings.filter(f);
    $('list').innerHTML = list.length ? list.map(card).join('') : '<div class="card empty">Nothing here yet.</div>';
  }

  $('tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } };

  $('list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-a]');
    if (!btn) return;
    const el = btn.closest('[data-id]');
    const b = data.bookings.find((x) => x.id === el.dataset.id);
    const a = btn.dataset.a;
    // Open WhatsApp synchronously inside the click so pop-up blockers allow it
    const openWa = (text) => window.open(wa(b, text), '_blank', 'noopener');

    if (a === 'confirm') {
      if (b.delivery && b.deliveryFee == null && !confirm('Delivery fee is still TBC. Confirm anyway?')) return;
      const w = window.open('about:blank', '_blank');
      const ok = await patch(b.id, { status: 'confirmed' });
      const updated = data.bookings.find((x) => x.id === b.id);
      if (ok && w) w.location = wa(updated, messages.confirm(updated)); else if (w) w.close();
    }
    if (a === 'decline') { if (!confirm(`Decline ${b.name}'s request?`)) return; openWa(messages.decline(b)); patch(b.id, { status: 'declined' }); }
    if (a === 'complete') patch(b.id, { status: 'completed' });
    if (a === 'cancel') { if (confirm('Cancel this booking? It frees up the stock.')) patch(b.id, { status: 'cancelled' }); }
    if (a === 'reopen') patch(b.id, { status: 'pending' });
    if (a === 'dep-received') patch(b.id, { depositStatus: 'received' });
    if (a === 'dep-return') { if (!confirm(`Have you returned ${money(b.deposit)} to ${b.name}?`)) return; openWa(messages.depositReturned(b)); patch(b.id, { depositStatus: 'returned' }); }
    if (a === 'dep-keep') { if (confirm('Keep the deposit (e.g. damage)? Add a note explaining why.')) patch(b.id, { depositStatus: 'kept' }); }
    if (a === 'dep-undo') patch(b.id, { depositStatus: 'received' });
    if (a === 'save-fee') patch(b.id, { deliveryFee: el.querySelector('[data-f=fee]').value });
  });

  // autosave private notes when you click away
  $('list').addEventListener('change', (e) => {
    if (e.target.dataset.f !== 'notes') return;
    const id = e.target.closest('[data-id]').dataset.id;
    fetch('/admin/api/bookings/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminNotes: e.target.value }) });
  });

  load();
  setInterval(() => { if (!document.querySelector('textarea:focus, input:focus')) load(); }, 60000);
})();
