import type {
  AvailabilityResponse,
  CreateBookingResponse,
  DeliveryQuote,
  DeliveryQuoteOk,
  PublicConfig,
  QuoteResponse,
  Stock,
} from '../shared/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement | HTMLTextAreaElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const money = (n: number) => '£' + Number(n).toFixed(2);
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dayCount = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000) + 1;
const pretty = (s: string) =>
  new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const isPriced = (q: DeliveryQuote | null | undefined): q is DeliveryQuoteOk => !!q && q.error === undefined;
const ceil50p = (n: number) => Math.ceil(n * 2) / 2;

type Qty = 'tables' | 'chairs';

interface State {
  cfg: PublicConfig;
  avail: Record<string, Stock>;
  view: Date;
  start: string | null;
  end: string | null;
  tables: number;
  chairs: number;
  delivery: boolean;
  deliveryQuote: DeliveryQuote | null;
  quoting: boolean;
}

// cfg and view are filled in by init() before anything reads them
const state = {
  avail: {}, start: null, end: null,
  tables: 0, chairs: 0, delivery: true, deliveryQuote: null, quoting: false,
} as unknown as State;

class ApiError extends Error {
  constructor(message: string, public data: { error?: string; errors?: string[] }) {
    super(message);
  }
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || 'Request failed', json);
  return json as T;
}

// ---------- availability ----------
async function loadAvailability(from: string, to: string): Promise<void> {
  const { days } = await api<AvailabilityResponse>(`/api/availability?from=${from}&to=${to}`);
  Object.assign(state.avail, days);
}
const availFor = (d: string): Stock => state.avail[d] || { tables: state.cfg.totalTables, chairs: state.cfg.totalChairs };
const isFull = (d: string) => { const a = availFor(d); return a.tables === 0 && a.chairs === 0; };

function rangeRemaining(): Stock {
  if (!state.start) return { tables: state.cfg.totalTables, chairs: state.cfg.totalChairs };
  const end = state.end || state.start;
  let t = Infinity, c = Infinity;
  for (let d = state.start; d <= end; d = addDays(d, 1)) { const a = availFor(d); t = Math.min(t, a.tables); c = Math.min(c, a.chairs); }
  return { tables: t, chairs: c };
}

// ---------- calendar ----------
async function renderCalendar(): Promise<void> {
  const y = state.view.getUTCFullYear(), m = state.view.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  $('month-label').textContent = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const today = state.cfg.today;
  const thisMonth = today.slice(0, 7);
  button('prev').disabled = iso(first).slice(0, 7) <= thisMonth;
  const horizon = addDays(today, 365);
  button('next').disabled = iso(last) >= horizon;

  const from = iso(first) < today ? today : iso(first);
  if (from <= iso(last) && !state.avail[from]) { try { await loadAvailability(from, iso(last)); } catch { /* show as available */ } }

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
    if (state.start && end && d >= state.start && d <= end) cls.push(d === state.start || d === end ? 'sel' : 'in-range');
    const title = full ? 'Fully booked' : past ? '' : `${a.tables} tables, ${a.chairs} chairs free`;
    cal.insertAdjacentHTML('beforeend', `<button class="${cls.join(' ')}" data-d="${d}" ${past || full ? 'disabled' : ''} title="${title}">${day}</button>`);
  }
  renderChosen();
}

function pickDay(d: string): void {
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
  const start = state.start;
  const end = state.end || start;
  // make sure we have availability for every day in the range (it can span months)
  loadAvailability(start, end).catch(() => {}).finally(() => { void renderCalendar(); clampQty(); update(); });
}

function renderChosen(): void {
  if (!state.start) { $('chosen').textContent = ''; return; }
  const end = state.end || state.start;
  const n = dayCount(state.start, end);
  $('chosen').textContent = (state.start === end ? pretty(state.start) : `${pretty(state.start)} → ${pretty(end)}`) + ` · ${n} day${n > 1 ? 's' : ''}`;
}

// ---------- quantities ----------
function clampQty(): void {
  const r = rangeRemaining();
  state.tables = Math.max(0, Math.min(state.tables, r.tables));
  state.chairs = Math.max(0, Math.min(state.chairs, r.chairs));
  input('tables').value = String(state.tables);
  input('chairs').value = String(state.chairs);
  $('t-left').textContent = state.start ? `${r.tables} available` : `${money(state.cfg.tablePrice)} per day`;
  $('c-left').textContent = state.start ? `${r.chairs} available` : `${money(state.cfg.chairPrice)} per day`;
}

// ---------- delivery ----------
let quoteTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleDeliveryQuote(): void {
  clearTimeout(quoteTimer);
  const pc = input('postcode').value.trim();
  if (!state.delivery || pc.replace(/\s/g, '').length < 5) { state.deliveryQuote = null; renderDeliveryNote(); update(); return; }
  quoteTimer = setTimeout(async () => {
    state.quoting = true; renderDeliveryNote();
    try {
      const q = await api<QuoteResponse>('/api/quote', { method: 'POST', body: JSON.stringify({ delivery: true, postcode: pc }) });
      state.deliveryQuote = q.delivery || null;
    } catch { state.deliveryQuote = { error: "Couldn't estimate delivery right now – we'll confirm it with you." }; }
    state.quoting = false; renderDeliveryNote(); update();
  }, 500);
}

function renderDeliveryNote(): void {
  const el = $('delivery-note');
  const q = state.deliveryQuote;
  if (!state.delivery) { el.innerHTML = ''; return; }
  if (state.quoting) { el.innerHTML = '<div class="note">Working out distance…</div>'; return; }
  if (!q) { el.innerHTML = '<p class="hint">Enter your postcode for a delivery estimate.</p>'; return; }
  if (!isPriced(q)) { el.innerHTML = `<div class="note ${q.badPostcode ? 'bad' : 'warn'}">${esc(q.error)}</div>`; return; }
  if (q.outOfArea) { el.innerHTML = `<div class="note warn">${esc(q.postcode)} is about ${Math.round(q.oneWayMiles)} miles away – outside our usual area. Send the request anyway and we'll let you know if we can do it.</div>`; return; }
  el.innerHTML = `<div class="note ok">${esc(q.postcode)}${q.area ? ' (' + esc(q.area) + ')' : ''} · about ${q.oneWayMiles.toFixed(1)} miles away. Delivery &amp; collection: <strong>${q.fee === 0 ? 'FREE' : money(q.fee)}</strong></div>`;
}

// ---------- summary ----------
function update(): void {
  const rows: [string, string][] = [];
  let hire = 0, days = 0;
  if (state.start) {
    days = dayCount(state.start, state.end || state.start);
    if (state.tables) { const c = state.tables * state.cfg.tablePrice * days; hire += c; rows.push([`${state.tables} table${state.tables > 1 ? 's' : ''} × ${days} day${days > 1 ? 's' : ''}`, money(c)]); }
    if (state.chairs) { const c = state.chairs * state.cfg.chairPrice * days; hire += c; rows.push([`${state.chairs} chair${state.chairs > 1 ? 's' : ''} × ${days} day${days > 1 ? 's' : ''}`, money(c)]); }
  }
  let total = hire;
  const q = state.deliveryQuote;
  const priced = isPriced(q) && !q.outOfArea ? q : null;
  if (state.delivery) {
    if (priced) { rows.push(['Delivery & collection (estimate)', priced.fee === 0 ? 'FREE' : money(priced.fee)]); total += priced.fee; }
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
  html += `<tr class="total"><td>Total${state.delivery && !priced ? ' (excl. delivery)' : ''}</td><td>${money(total)}</td></tr>`;
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
async function submit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const errs: string[] = [];
  if (!state.start) errs.push('Please choose your dates.');
  if (state.tables + state.chairs === 0) errs.push('Please add at least one table or chair.');
  const payment = document.querySelector<HTMLInputElement>('input[name=payment]:checked')?.value;
  if (!payment) errs.push('Please choose cash or bank transfer.');
  if (input('name').value.trim().length < 2) errs.push('Please enter your name.');
  if (input('phone').value.replace(/\D/g, '').length < 10) errs.push('Please enter a valid phone number.');
  if (state.delivery && (!input('postcode').value.trim() || !input('address').value.trim())) errs.push('Please enter your delivery address and postcode.');
  if (errs.length) return showErrors(errs);

  const btn = button('submit');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await api<CreateBookingResponse>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({
        start: state.start, end: state.end || state.start, tables: state.tables, chairs: state.chairs,
        delivery: state.delivery, postcode: input('postcode').value, address: input('address').value,
        name: input('name').value, phone: input('phone').value, email: input('email').value,
        paymentMethod: payment, notes: input('notes').value, website: input('website').value,
      }),
    });
    $('form-view').hidden = true;
    $('success-view').hidden = false;
    $('s-ref').textContent = r.ref ?? '';
    $('s-phone').textContent = input('phone').value;
    $<HTMLAnchorElement>('s-link').href = '/b/' + r.id;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showErrors(err instanceof ApiError && err.data.errors ? err.data.errors : [err instanceof Error ? err.message : String(err)]);
    btn.disabled = false; btn.textContent = 'Send booking request';
  }
}

function showErrors(list: string[]): void {
  $('errors').innerHTML = list.map((e) => `<div class="note bad">${esc(e)}</div>`).join('');
}

// ---------- init ----------
async function init(): Promise<void> {
  state.cfg = await api<PublicConfig>('/api/config');
  const c = state.cfg;
  document.title = `${c.businessName} – Book`;
  // Landing-page text that depends on your settings
  const fill = (sel: string, text: string) => document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
  const showIf = (sel: string, show: boolean) => document.querySelectorAll<HTMLElement>(sel).forEach((el) => { el.hidden = !show; });
  fill('[data-biz]', c.businessName);
  fill('[data-price=table]', money(c.tablePrice));
  fill('[data-price=chair]', money(c.chairPrice));
  fill('[data-deposit-pct]', String(c.depositPercent));
  fill('[data-max-miles]', String(c.maxDeliveryMiles));
  fill('[data-max-days]', String(c.maxHireDays));
  fill('#year', String(new Date().getFullYear()));
  showIf('[data-if-deposit]', c.depositPercent > 0);
  showIf('[data-if-miles]', c.deliveryEnabled && c.maxDeliveryMiles > 0);
  $('footer').innerHTML = c.contactPhone ? `Questions? Call or WhatsApp <a href="tel:${esc(c.contactPhone)}">${esc(c.contactPhone)}</a>` : '';
  if (!c.deliveryEnabled) $('delivery-note').innerHTML = '<p class="hint">We\'ll confirm the delivery cost with you.</p>';
  const t = new Date(c.today + 'T00:00:00Z');
  state.view = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));

  $('prev').onclick = () => { state.view.setUTCMonth(state.view.getUTCMonth() - 1); void renderCalendar(); };
  $('next').onclick = () => { state.view.setUTCMonth(state.view.getUTCMonth() + 1); void renderCalendar(); };
  $('cal').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.day');
    if (b && !b.disabled && b.dataset.d) pickDay(b.dataset.d);
  };

  document.querySelectorAll<HTMLButtonElement>('.stepper button').forEach((b) => {
    b.onclick = () => {
      // chairs usually come in bigger numbers, so step them by 1 but allow typing any amount
      state[b.dataset.q as Qty] += Number(b.dataset.d);
      clampQty(); update();
    };
  });
  (['tables', 'chairs'] as const).forEach((k) => {
    input(k).oninput = () => { state[k] = parseInt(input(k).value, 10) || 0; clampQty(); update(); };
  });

  document.querySelectorAll<HTMLInputElement>('input[name=delivery]').forEach((r) => {
    r.onchange = () => {
      state.delivery = document.querySelector<HTMLInputElement>('input[name=delivery]:checked')?.value === '1';
      $('delivery-fields').hidden = !state.delivery;
      scheduleDeliveryQuote(); update();
    };
  });
  input('postcode').oninput = scheduleDeliveryQuote;
  $<HTMLFormElement>('details').onsubmit = submit;

  clampQty(); renderDeliveryNote(); update();
  await renderCalendar();
}

init().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin', `<div class="note bad">Something went wrong loading the page. Please refresh.</div>`);
  console.error(e);
});
