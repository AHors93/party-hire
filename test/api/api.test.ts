// Starts the real app on a random port with a throwaway data file, then talks to it over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Settings must be in place before the app (and its config) is loaded
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-hire-test-'));
Object.assign(process.env, {
  DATA_FILE: path.join(dir, 'bookings.json'),
  ADMIN_PASSWORD: 'test-password',
  BANK_DETAILS: 'Name: SECRET BANK DETAILS',
  TOTAL_TABLES: '10',
  TOTAL_CHAIRS: '60',
  TABLE_PRICE: '7.5',
  CHAIR_PRICE: '1.5',
  BOOKING_FEE: '1.5',
  DEPOSIT_PERCENT: '10',
  HOME_POSTCODE: '', // keep tests offline: no postcode lookups
  NTFY_TOPIC: '',
});

let server: Server;
let base = '';
let ipCounter = 0;

before(async () => {
  const { app } = await import('../../src/app');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Each call looks like a different visitor, so the booking rate limit doesn't get in the way
function call(method: string, url: string, body?: unknown, opts: { auth?: string; ip?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': opts.ip ?? `10.0.0.${++ipCounter}`,
  };
  if (opts.auth !== undefined) headers.Authorization = 'Basic ' + Buffer.from(opts.auth).toString('base64');
  return fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const admin = (method: string, url: string, body?: unknown) => call(method, url, body, { auth: 'owner:test-password' });

const todayUK = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
function daysFromNow(n: number): string {
  const d = new Date(todayUK() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bookingBody(over: Record<string, unknown> = {}) {
  return {
    start: daysFromNow(20), end: daysFromNow(21), tables: 2, chairs: 10,
    name: 'Sam Tester', phone: '07123 456789', email: 'sam@example.com',
    delivery: false, paymentMethod: 'cash', notes: '', ...over,
  };
}

async function book(over: Record<string, unknown> = {}) {
  const res = await call('POST', '/api/bookings', bookingBody(over));
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  return json as { id: string; ref: string };
}

async function availability(day: string) {
  const res = await call('GET', `/api/availability?from=${day}&to=${day}`);
  return ((await res.json()) as { days: Record<string, { tables: number; chairs: number }> }).days[day];
}

// ---------------------------------------------------------------------------

test('public config shows prices but never your bank details', async () => {
  const res = await call('GET', '/api/config');
  const text = await res.text();
  assert.equal(res.status, 200);
  const cfg = JSON.parse(text);
  assert.equal(cfg.tablePrice, 7.5);
  assert.equal(cfg.totalTables, 10);
  assert.ok(!text.includes('SECRET BANK DETAILS'));
});

test('quote endpoint prices a hire', async () => {
  const res = await call('POST', '/api/quote', { start: daysFromNow(30), end: daysFromNow(31), tables: 2, chairs: 10 });
  const q = await res.json();
  assert.deepEqual(q.errors, []);
  assert.equal(q.hireTotal, 60);
  assert.equal(q.deposit, 6);
});

test('a booking with missing details is rejected with helpful errors', async () => {
  const res = await call('POST', '/api/bookings', { tables: 0, chairs: 0 });
  assert.equal(res.status, 400);
  const { errors } = await res.json();
  assert.ok(errors.includes('Please choose your dates.'));
  assert.ok(errors.includes('Please enter your name.'));
  assert.ok(errors.includes('Please choose how you would like to pay.'));
});

test('dates in the past and hires longer than the max are rejected', async () => {
  let res = await call('POST', '/api/bookings', bookingBody({ start: daysFromNow(-3), end: daysFromNow(-2) }));
  assert.ok((await res.json()).errors.includes('Start date is in the past.'));
  res = await call('POST', '/api/bookings', bookingBody({ start: daysFromNow(5), end: daysFromNow(30) }));
  assert.ok((await res.json()).errors.some((e: string) => e.startsWith('Maximum hire')));
});

test('delivery bookings need an address and postcode', async () => {
  const res = await call('POST', '/api/bookings', bookingBody({ delivery: true }));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors.includes('Please enter your delivery address and postcode.'));
});

test('a valid booking is saved as pending with the right totals', async () => {
  const { id, ref } = await book({ start: daysFromNow(40), end: daysFromNow(41) });
  assert.match(ref, /^PH-[0-9A-F]{6}$/);
  const res = await call('GET', `/api/bookings/${id}`);
  const { booking } = await res.json();
  assert.equal(booking.status, 'pending');
  assert.equal(booking.hireTotal, 60);
  assert.equal(booking.total, 61.5); // + £1.50 booking fee, collection is free
  assert.equal(booking.deposit, 6);
  assert.equal(booking.amountDue, 67.5);
});

test("the customer's status page only shows their first name, not their phone or email", async () => {
  const { id } = await book({ start: daysFromNow(42), end: daysFromNow(42) });
  const text = await (await call('GET', `/api/bookings/${id}`)).text();
  assert.ok(text.includes('"name":"Sam"'));
  assert.ok(!text.includes('Tester'));
  assert.ok(!text.includes('07123'));
  assert.ok(!text.includes('sam@example.com'));
});

test('unknown booking ids return 404', async () => {
  assert.equal((await call('GET', '/api/bookings/does-not-exist')).status, 404);
});

test('bots that fill the hidden field are ignored', async () => {
  const before = (await (await admin('GET', '/admin/api/bookings')).json()).bookings.length;
  const res = await call('POST', '/api/bookings', bookingBody({ website: 'http://spam.example' }));
  assert.equal(res.status, 200);
  const afterCount = (await (await admin('GET', '/admin/api/bookings')).json()).bookings.length;
  assert.equal(afterCount, before);
});

test('admin needs the right password', async () => {
  assert.equal((await call('GET', '/admin/api/bookings')).status, 401);
  assert.equal((await call('GET', '/admin/api/bookings', undefined, { auth: 'owner:wrong' })).status, 401);
  assert.equal((await admin('GET', '/admin/api/bookings')).status, 200);
  assert.equal((await call('GET', '/admin')).status, 401);
});

test('only CONFIRMED bookings use up stock', async () => {
  const day = daysFromNow(50);
  const { id } = await book({ start: day, end: day, tables: 3, chairs: 20 });
  assert.deepEqual(await availability(day), { tables: 10, chairs: 60 }); // pending: nothing reserved

  const res = await admin('PATCH', `/admin/api/bookings/${id}`, { status: 'confirmed' });
  assert.equal(res.status, 200);
  assert.deepEqual(await availability(day), { tables: 7, chairs: 40 });

  await admin('PATCH', `/admin/api/bookings/${id}`, { status: 'cancelled' });
  assert.deepEqual(await availability(day), { tables: 10, chairs: 60 }); // cancelling frees it again
});

test('customers cannot request more than is left', async () => {
  const day = daysFromNow(55);
  const { id } = await book({ start: day, end: day, tables: 8, chairs: 0 });
  await admin('PATCH', `/admin/api/bookings/${id}`, { status: 'confirmed' });
  const res = await call('POST', '/api/bookings', bookingBody({ start: day, end: day, tables: 5, chairs: 0 }));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).errors[0].includes('only 2 tables'));
});

test('confirming a booking that would overbook warns first, and can be forced', async () => {
  const day = daysFromNow(60);
  const a = await book({ start: day, end: day, tables: 8, chairs: 0 });
  const b = await book({ start: day, end: day, tables: 8, chairs: 0 }); // allowed: a is only pending
  assert.equal((await admin('PATCH', `/admin/api/bookings/${a.id}`, { status: 'confirmed' })).status, 200);

  const warn = await admin('PATCH', `/admin/api/bookings/${b.id}`, { status: 'confirmed' });
  assert.equal(warn.status, 409);
  assert.equal((await warn.json()).canForce, true);

  const forced = await admin('PATCH', `/admin/api/bookings/${b.id}`, { status: 'confirmed', force: true });
  assert.equal(forced.status, 200);
});

test('admin can set the delivery fee and the total updates', async () => {
  const { id } = await book({ start: daysFromNow(65), end: daysFromNow(65), tables: 1, chairs: 0 });
  const res = await admin('PATCH', `/admin/api/bookings/${id}`, { deliveryFee: '12.5' });
  const { booking } = await res.json();
  assert.equal(booking.deliveryFee, 12.5);
  assert.equal(booking.total, 7.5 + 12.5 + 1.5);
  assert.equal((await admin('PATCH', `/admin/api/bookings/${id}`, { deliveryFee: -1 })).status, 400);
});

test('deposit can be marked received then returned', async () => {
  const { id } = await book({ start: daysFromNow(70), end: daysFromNow(70) });
  await admin('PATCH', `/admin/api/bookings/${id}`, { status: 'confirmed' });
  await admin('PATCH', `/admin/api/bookings/${id}`, { depositStatus: 'received' });
  const { booking } = await (await admin('PATCH', `/admin/api/bookings/${id}`, { depositStatus: 'returned' })).json();
  assert.equal(booking.depositStatus, 'returned');
  assert.ok(booking.depositReturnedAt);
  assert.equal((await admin('PATCH', `/admin/api/bookings/${id}`, { depositStatus: 'lost' })).status, 400);
});

test('bookings are saved to the data file', async () => {
  const { id } = await book({ start: daysFromNow(75), end: daysFromNow(75) });
  const saved = JSON.parse(fs.readFileSync(process.env.DATA_FILE!, 'utf8'));
  assert.ok(saved.some((b: { id: string }) => b.id === id));
});

test('the same visitor is limited to 5 booking attempts an hour', async () => {
  const ip = '10.99.99.99';
  for (let i = 0; i < 5; i++) await call('POST', '/api/bookings', {}, { ip });
  const res = await call('POST', '/api/bookings', {}, { ip });
  assert.equal(res.status, 429);
});
