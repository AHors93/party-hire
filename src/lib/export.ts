// Turns bookings into a CSV file that opens cleanly in Excel, Numbers or Google Sheets.
import type { Booking } from '../shared/types';

const PAYMENT: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer' };

const COLUMNS: [header: string, value: (b: Booking) => string | number | boolean | null | undefined][] = [
  ['Reference', (b) => b.ref],
  ['Status', (b) => b.status],
  ['Requested', (b) => b.createdAt.slice(0, 16).replace('T', ' ')],
  ['Start date', (b) => b.start],
  ['End date', (b) => b.end],
  ['Days', (b) => b.days],
  ['Tables', (b) => b.tables],
  ['Chairs', (b) => b.chairs],
  ['Name', (b) => b.name],
  ['Phone', (b) => b.phone],
  ['Email', (b) => b.email],
  ['Delivery', (b) => (b.delivery ? 'Delivery' : 'Collection')],
  ['Address', (b) => b.address],
  ['Postcode', (b) => b.postcode],
  ['Payment method', (b) => PAYMENT[b.paymentMethod] ?? b.paymentMethod],
  ['Hire (£)', (b) => b.hireTotal],
  ['Delivery fee (£)', (b) => b.deliveryFee],
  ['Booking fee (£)', (b) => b.bookingFee],
  ['Total (£)', (b) => b.total],
  ['Deposit (£)', (b) => b.deposit],
  ['Deposit status', (b) => b.depositStatus],
  ['Customer notes', (b) => b.notes],
  ['Private notes', (b) => b.adminNotes],
  ['Booking ID', (b) => b.id],
];

function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Customers type their own name/notes: stop text like "=HYPERLINK(...)" running as a spreadsheet formula
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bookingsToCsv(bookings: Booking[]): string {
  const rows = [...bookings]
    .sort((a, b) => a.start.localeCompare(b.start) || a.createdAt.localeCompare(b.createdAt))
    .map((b) => COLUMNS.map(([, get]) => cell(get(b))).join(','));
  // The BOM makes Excel read £ signs and accents correctly
  return '﻿' + [COLUMNS.map(([h]) => cell(h)).join(','), ...rows].join('\r\n') + '\r\n';
}
