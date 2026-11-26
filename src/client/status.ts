import type { BookingStatus, DepositStatus, PublicBookingResponse } from '../shared/types';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => '£' + Number(n).toFixed(2);

const STATUS_MESSAGES: Record<BookingStatus, string> = {
  pending: "We've got your request and will message you shortly to confirm.",
  confirmed: "You're booked in! See you soon.",
  completed: 'All done – thanks for hiring with us!',
  declined: "Sorry, we couldn't do this booking. Please get in touch if you'd like other dates.",
  cancelled: 'This booking was cancelled.',
};

const DEPOSIT_LABELS: Record<DepositStatus, string> = {
  due: 'to pay', received: 'held – returned after collection', returned: 'returned ✓', kept: 'retained',
};

async function main(): Promise<void> {
  const id = location.pathname.split('/').pop() ?? '';
  const out = document.getElementById('out')!;
  const res = await fetch('/api/bookings/' + encodeURIComponent(id));
  if (!res.ok) { out.innerHTML = '<div class="note bad">We couldn\'t find that booking.</div>'; return; }
  const { booking: b, contactPhone, businessName } = (await res.json()) as PublicBookingResponse;
  document.getElementById('biz')!.textContent = businessName;
  const msg = STATUS_MESSAGES[b.status];
  const dep = b.depositStatus ? DEPOSIT_LABELS[b.depositStatus] : '';
  out.innerHTML = `
    <h2>Hi ${esc(b.name)} <span class="badge ${esc(b.status)}">${esc(b.status)}</span></h2>
    <p>${esc(msg)}</p>
    <table>
      <tr><td>Reference</td><td><span class="ref">${esc(b.ref)}</span></td></tr>
      <tr><td>Dates</td><td>${esc(b.dates)} (${b.days} day${b.days > 1 ? 's' : ''})</td></tr>
      <tr><td>Items</td><td>${b.tables} tables, ${b.chairs} chairs</td></tr>
      <tr><td>${b.delivery ? 'Delivery & collection' : 'Collection'}</td><td>${b.delivery ? (b.deliveryFee == null ? 'TBC' : money(b.deliveryFee)) : 'Free'}</td></tr>
      ${b.bookingFee ? `<tr><td>Booking fee</td><td>${money(b.bookingFee)}</td></tr>` : ''}
      <tr><td>Payment</td><td>${esc(b.paymentMethod)}</td></tr>
      <tr class="total"><td>Total</td><td>${money(b.total)}</td></tr>
      ${b.deposit ? `<tr class="sub"><td>Refundable deposit (${esc(dep)})</td><td>${money(b.deposit)}</td></tr>` : ''}
    </table>`;
  const footer = document.getElementById('footer')!;
  if (contactPhone) footer.innerHTML = `Questions? Call or WhatsApp <a href="tel:${esc(contactPhone)}">${esc(contactPhone)}</a>`;
}

void main();
