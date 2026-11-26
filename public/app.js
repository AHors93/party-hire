(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '£' + Number(n).toFixed(2);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const dayCount = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000) + 1;
  const pretty = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const ceil50p = (n) => Math.ceil(n * 2) / 2;

  const state = {
    cfg: null, avail: {}, view: null, start: null, end: null,
    tables: 0, chairs: 0, delivery: true, deliveryQuote: null, quoting: false,
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || 'Request failed'), { data: json });
    return json;
  }

  // ---------- availability ----------
  async function loadAvailability(from, to) {
    const { days } = await api(`/api/availability?from=${from}&to=${to}`);
    Object.assign(state.avail, days);
  }
  const availFor = (d) => state.avail[d] || { tables: state.cfg.totalTables, chairs: state.cfg.totalChairs };
  const isFull = (d) => { const a = availFor(d); return a.tables === 0 && a.chairs === 0; };

  function rangeRemaining() {
    if (!state.start) return { tables: state.cfg.totalTables, chairs: state.cfg.totalChairs };
    const end = state.end || state.start;
    let t = Infinity, c = Infinity;
    for (let d = state.start; d <= end; d = addDays(d, 1)) { const a = availFor(d); t = Math.min(t, a.tables); c = Math.min(c, a.chairs); }
    return { tables: t, chairs: c };
  }

  // ---------- calendar ----------
  async function renderCalendar() {
    const y = state.view.getUTCFullYear(), m = state.view.getUTCMonth();
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(y, m + 1, 0));
    $('month-label').textContent = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const today = state.cfg.today;
    const thisMonth = today.slice(0, 7);
    $('prev').disabled = iso(first).slice(0, 7) <= thisMonth;
    const horizon = addDays(today, 365);
    $('next').disabled = iso(last) >= horizon;

    const from = iso(first) < today ? today : iso(first);
    if (from <= iso(last) && !state.avail[from]) { try { await loadAvailability(from, iso(last)); } catch {} }

    const cal = $('cal');
    cal.innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('');
    const offset = (first.getUTCDay() + 6) % 7;
    for (let i = 0; i < offset; i++) cal.insertAdjacentHTML('beforeend', '<div></div>');
    const end = state.end || state.start;
    for (let day = 1; day <= last.getUTCDate(); day++) {
      const d = iso(new Date(Date.UTC(y, m, day)));
      const past = d < today || d > horizon;
      const full = !past && isFull(d);
      const a = availFor(d);
      const limited = !past && !full && (a.tables < state.cfg.totalTables * 0.3 || a.chairs < state.cfg.totalChairs * 0.3);
      const cls = ['day'];
      if (past) cls.push('past');
      if (limited) cls.push('limited');
      if (state.start && d >= state.start && d <= end) cls.push(d === state.start || d === end ? 'sel' : 'in-range');
      const title = full ? 'Fully booked' : past ? '' : `${a.tables} tables, ${a.chairs} chairs free`;
      cal.insertAdjacentHTML('beforeend', `<button class="${cls.join(' ')}" data-d="${d}" ${past || full ? 'disabled' : ''} title="${title}">${day}</button>`);
    }
    renderChosen();
  }

  function pickDay(d) {
    if (!state.start || state.end || d < state.start) {
      state.start = d; state.end = null;
    } else if (d === state.start) {
      state.end = d;
    } else {
      let blocked = false;
      for (let x = state.start; x <= d; x = addDays(x, 1)) if (isFull(x)) blocked = true;
      if (blocked || dayCount(state.start, d) > state.cfg.maxHireDays) { state.start = d; state.end = null; }
      else state.end = d;
    }
    const end = state.end || state.start;
    // make sure we have availability for every day in the range (it can span months)
    loadAvailability(state.start, end).catch(() => {}).finally(() => { renderCalendar(); clampQty(); update(); });
  }

  function renderChosen() {
    if (!state.start) { $('chosen').textContent = ''; return; }
    const end = state.end || state.start;
    const n = dayCount(state.start, end);
    $('chosen').textContent = (state.start === end ? pretty(state.start) : `${pretty(state.start)} → ${pretty(end)}`) + ` · ${n} day${n > 1 ? 's' : ''}`;
  }

  // ---------- quantities ----------
  function clampQty() {
    const r = rangeRemaining();
    state.tables = Math.max(0, Math.min(state.tables, r.tables));
    state.chairs = Math.max(0, Math.min(state.chairs, r.chairs));
    $('tables').value = state.tables;
    $('chairs').value = state.chairs;
    $('t-left').textContent = state.start ? `${r.tables} available` : `${money(state.cfg.tablePrice)} per day`;
    $('c-left').textContent = state.start ? `${r.chairs} available` : `${money(state.cfg.chairPrice)} per day`;
  }

  // ---------- delivery ----------
  let quoteTimer;
  function scheduleDeliveryQuote() {
    clearTimeout(quoteTimer);
    const pc = $('postcode').value.trim();
    if (!state.delivery || pc.replace(/\s/g, '').length < 5) { state.deliveryQuote = null; renderDeliveryNote(); update(); return; }
    quoteTimer = setTimeout(async () => {
      state.quoting = true; renderDeliveryNote();
      try {
        const q = await api('/api/quote', { method: 'POST', body: JSON.stringify({ delivery: true, postcode: pc }) });
        state.deliveryQuote = q.delivery || null;
      } catch { state.deliveryQuote = { error: "Couldn't estimate delivery right now – we'll confirm it with you." }; }
      state.quoting = false; renderDeliveryNote(); update();
    }, 500);
  }

  function renderDeliveryNote() {
    const el = $('delivery-note');
    const q = state.deliveryQuote;
    if (!state.delivery) { el.innerHTML = ''; return; }
    if (state.quoting) { el.innerHTML = '<div class="note">Working out distance…</div>'; return; }
    if (!q) { el.innerHTML = '<p class="hint">Enter your postcode for a delivery estimate.</p>'; return; }
    if (q.error) { el.innerHTML = `<div class="note ${q.badPostcode ? 'bad' : 'warn'}">${esc(q.error)}</div>`; return; }
    if (q.outOfArea) { el.innerHTML = `<div class="note warn">${esc(q.postcode)} is about ${Math.round(q.oneWayMiles)} miles away – outside our usual area. Send the request anyway and we'll let you know if we can do it.</div>`; return; }
    el.innerHTML = `<div class="note ok">${esc(q.postcode)}${q.area ? ' (' + esc(q.area) + ')' : ''} · about ${q.oneWayMiles.toFixed(1)} miles away. Delivery &amp; collection: <strong>${q.fee === 0 ? 'FREE' : money(q.fee)}</strong></div>`;
  }

  // ---------- summary ----------
  function update() {
    const rows = [];
    let total = 0, hire = 0, days = 0;
    if (state.start) {
      days = dayCount(state.start, state.end || state.start);
      if (state.tables) { const c = state.tables * state.cfg.tablePrice * days; hire += c; rows.push([`${state.tables} table${state.tables > 1 ? 's' : ''} × ${days} day${days > 1 ? 's' : ''}`, money(c)]); }
      if (state.chairs) { const c = state.chairs * state.cfg.chairPrice * days; hire += c; rows.push([`${state.chairs} chair${state.chairs > 1 ? 's' : ''} × ${days} day${days > 1 ? 's' : ''}`, money(c)]); }
    }
    total = hire;
    const q = state.deliveryQuote;
    if (state.delivery) {
      if (q && !q.error && !q.outOfArea) { rows.push(['Delivery & collection (estimate)', q.fee === 0 ? 'FREE' : money(q.fee)]); total += q.fee; }
      else rows.push(['Delivery & collection', 'TBC']);
    } else rows.push(['Collection', 'Free']);
    const fee = state.cfg.bookingFee || 0;
    if (fee) { rows.push(['Booking fee*', money(fee)]); total += fee; }

    const tbl = $('summary');
    if (!hire) {
      tbl.innerHTML = '<tr class="sub"><td>Choose dates and items to see a price</td><td></td></tr>';
      $('deposit-note').innerHTML = '';
      return;
    }
    const deposit = state.cfg.depositPercent > 0 ? ceil50p(hire * state.cfg.depositPercent / 100) : 0;
    let html = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    html += `<tr class="total"><td>Total${state.delivery && !(q && !q.error && !q.outOfArea) ? ' (excl. delivery)' : ''}</td><td>${money(total)}</td></tr>`;
    if (deposit) {
      html += `<tr class="sub"><td>+ Refundable deposit (${state.cfg.depositPercent}%)</td><td>${money(deposit)}</td></tr>`;
      html += `<tr class="sub"><td>Payable up front</td><td>${money(total + deposit)}</td></tr>`;
    }
    tbl.innerHTML = html;
    $('deposit-note').innerHTML =
      (deposit ? `<p class="hint">The ${money(deposit)} deposit is returned in full once everything's collected back in good condition.</p>` : '') +
      (fee ? `<p class="hint">*A small fixed fee per booking that covers the running of this site and returning your deposit.</p>` : '');
  }

  // ---------- submit ----------
  async function submit(e) {
    e.preventDefault();
    const errs = [];
    if (!state.start) errs.push('Please choose your dates.');
    if (state.tables + state.chairs === 0) errs.push('Please add at least one table or chair.');
    const payment = document.querySelector('input[name=payment]:checked')?.value;
    if (!payment) errs.push('Please choose cash or bank transfer.');
    if ($('name').value.trim().length < 2) errs.push('Please enter your name.');
    if ($('phone').value.replace(/\D/g, '').length < 10) errs.push('Please enter a valid phone number.');
    if (state.delivery && (!$('postcode').value.trim() || !$('address').value.trim())) errs.push('Please enter your delivery address and postcode.');
    if (errs.length) return showErrors(errs);

    $('submit').disabled = true; $('submit').textContent = 'Sending…';
    try {
      const r = await api('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          start: state.start, end: state.end || state.start, tables: state.tables, chairs: state.chairs,
          delivery: state.delivery, postcode: $('postcode').value, address: $('address').value,
          name: $('name').value, phone: $('phone').value, email: $('email').value,
          paymentMethod: payment, notes: $('notes').value, website: $('website').value,
        }),
      });
      $('form-view').hidden = true;
      $('success-view').hidden = false;
      $('s-ref').textContent = r.ref;
      $('s-phone').textContent = $('phone').value;
      $('s-link').href = '/b/' + r.id;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showErrors(err.data?.errors || [err.message]);
      $('submit').disabled = false; $('submit').textContent = 'Send booking request';
    }
  }

  function showErrors(list) {
    $('errors').innerHTML = list.map((e) => `<div class="note bad">${esc(e)}</div>`).join('');
  }

  // ---------- init ----------
  async function init() {
    state.cfg = await api('/api/config');
    const c = state.cfg;
    document.title = `${c.businessName} – Book`;
    $('biz').textContent = c.businessName;
    $('p-table').textContent = money(c.tablePrice);
    $('p-chair').textContent = money(c.chairPrice);
    $('footer').innerHTML = c.contactPhone ? `Questions? Call or WhatsApp <a href="tel:${esc(c.contactPhone)}">${esc(c.contactPhone)}</a>` : '';
    if (!c.deliveryEnabled) $('delivery-note').innerHTML = '<p class="hint">We\'ll confirm the delivery cost with you.</p>';
    const t = new Date(c.today + 'T00:00:00Z');
    state.view = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));

    $('prev').onclick = () => { state.view.setUTCMonth(state.view.getUTCMonth() - 1); renderCalendar(); };
    $('next').onclick = () => { state.view.setUTCMonth(state.view.getUTCMonth() + 1); renderCalendar(); };
    $('cal').onclick = (e) => { const b = e.target.closest('button.day'); if (b && !b.disabled) pickDay(b.dataset.d); };

    document.querySelectorAll('.stepper button').forEach((b) => b.onclick = () => {
      // chairs usually come in bigger numbers, so step them by 1 but allow typing any amount
      state[b.dataset.q] += Number(b.dataset.d);
      clampQty(); update();
    });
    ['tables', 'chairs'].forEach((k) => $(k).oninput = () => { state[k] = parseInt($(k).value, 10) || 0; clampQty(); update(); });

    document.querySelectorAll('input[name=delivery]').forEach((r) => r.onchange = () => {
      state.delivery = document.querySelector('input[name=delivery]:checked').value === '1';
      $('delivery-fields').hidden = !state.delivery;
      scheduleDeliveryQuote(); update();
    });
    $('postcode').oninput = scheduleDeliveryQuote;
    $('details').onsubmit = submit;

    clampQty(); renderDeliveryNote(); update();
    await renderCalendar();
  }

  init().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<div class="note bad">Something went wrong loading the page. Please refresh.</div>`); console.error(e); });
})();
