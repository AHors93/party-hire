import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hireQuote, deliveryQuote, round2 } from '../../src/lib/pricing';

const prices = { tablePrice: 7.5, chairPrice: 1.5, depositPercent: 10 };
const delivery = {
  deliveryTrips: 2, mpg: 40, fuelPricePerLitre: 1.4, freeDeliveryMiles: 0,
  minDeliveryFee: 0, deliveryBaseFee: 0, maxDeliveryMiles: 30,
};

test('hire is priced per item, per day', () => {
  const q = hireQuote({ tables: 2, chairs: 10, start: '2026-12-05', end: '2026-12-06' }, prices);
  assert.deepEqual(q, { days: 2, tablesCost: 30, chairsCost: 30, hireTotal: 60, deposit: 6 });
});

test('a one-day hire counts as 1 day', () => {
  const q = hireQuote({ tables: 1, chairs: 0, start: '2026-12-05', end: '2026-12-05' }, prices);
  assert.equal(q.days, 1);
  assert.equal(q.hireTotal, 7.5);
});

test('deposit rounds UP to the nearest 50p', () => {
  // 10% of £7.50 is 75p, which rounds up to £1
  const q = hireQuote({ tables: 1, chairs: 0, start: '2026-12-05', end: '2026-12-05' }, prices);
  assert.equal(q.deposit, 1);
});

test('no deposit when the deposit percent is 0', () => {
  const q = hireQuote({ tables: 5, chairs: 20, start: '2026-12-05', end: '2026-12-05' }, { ...prices, depositPercent: 0 });
  assert.equal(q.deposit, 0);
});

test('delivery fee is fuel for two return trips, rounded up to 50p', () => {
  // 6 miles each way x 2 x 2 trips = 24 miles; 24/40 gal x 4.546 L x £1.40 = £3.82 -> £4.00
  const q = deliveryQuote(6, delivery);
  assert.equal(q.totalMiles, 24);
  assert.equal(q.fuelCost, 3.82);
  assert.equal(q.fee, 4);
  assert.equal(q.outOfArea, false);
});

test('delivery is free inside the free-delivery radius', () => {
  assert.equal(deliveryQuote(2, { ...delivery, freeDeliveryMiles: 3 }).fee, 0);
});

test('minimum delivery fee and base fee apply', () => {
  assert.equal(deliveryQuote(1, { ...delivery, minDeliveryFee: 5 }).fee, 5);
  assert.equal(deliveryQuote(6, { ...delivery, deliveryBaseFee: 5 }).fee, 9); // £3.82 + £5 -> £9.00
});

test('beyond the max delivery distance is flagged out of area (0 = no limit)', () => {
  assert.equal(deliveryQuote(31, delivery).outOfArea, true);
  assert.equal(deliveryQuote(31, { ...delivery, maxDeliveryMiles: 0 }).outOfArea, false);
});

test('round2 rounds to pennies', () => {
  assert.equal(round2(3.81864), 3.82);
  assert.equal(round2(10), 10);
});
