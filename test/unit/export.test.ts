import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingsToCsv } from '../../src/lib/export';
import type { Booking } from '../../src/shared/types';

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'abc123', ref: 'PH-AAAAAA', status: 'confirmed', name: 'Sam Smith', phone: '07123 456789', email: '',
    start: '2026-12-05', end: '2026-12-06', days: 2, tables: 2, chairs: 10, delivery: true,
    address: '1 High St, Flat 2', postcode: 'M1 1AE', paymentMethod: 'bank_transfer', notes: '',
    tablesCost: 30, chairsCost: 30, hireTotal: 60, deliveryQuote: null, deliveryFee: 4, bookingFee: 1.5,
    total: 65.5, deposit: 6, depositStatus: 'due', adminNotes: '',
    createdAt: '2026-11-26T10:30:00.000Z', updatedAt: '2026-11-26T10:30:00.000Z', ...over,
  };
}

const rows = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

test('CSV has a header row and one row per booking, earliest date first', () => {
  const csv = bookingsToCsv([booking({ ref: 'PH-LATER1', start: '2027-01-10' }), booking({ ref: 'PH-SOONER' })]);
  assert.ok(csv.startsWith('﻿'), 'starts with BOM so Excel reads £ correctly');
  const r = rows(csv);
  assert.equal(r.length, 3);
  assert.ok(r[0].startsWith('Reference,Status,Requested,Start date'));
  assert.ok(r[1].startsWith('PH-SOONER,confirmed,2026-11-26 10:30,2026-12-05'));
  assert.ok(r[2].startsWith('PH-LATER1'));
  assert.ok(r[1].includes(',Bank transfer,60,4,1.5,65.5,6,due,'));
});

test('commas, quotes and new lines are quoted properly', () => {
  const r = rows(bookingsToCsv([booking({ notes: 'Gate code "1234",\nround the back' })]));
  assert.ok(r[1].includes('"1 High St, Flat 2"'));
  assert.ok(bookingsToCsv([booking({ notes: 'Gate code "1234",\nround the back' })]).includes('"Gate code ""1234"",\nround the back"'));
});

test('text that looks like a spreadsheet formula is neutralised', () => {
  const csv = bookingsToCsv([booking({ name: '=HYPERLINK("http://evil","click")', notes: '+44 7000' })]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""click"")"`));
  assert.ok(csv.includes(",'+44 7000,"));
  assert.ok(!/,=HYPERLINK/.test(csv));
});

test('empty list still gives a header row', () => {
  assert.equal(rows(bookingsToCsv([])).length, 1);
});
