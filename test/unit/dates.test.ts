import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate, addDays, dayCount, eachDay, prettyRange } from '../../src/lib/dates';
import { normalisePostcode } from '../../src/lib/distance';

test('isValidDate accepts real YYYY-MM-DD dates only', () => {
  assert.equal(isValidDate('2026-12-01'), true);
  assert.equal(isValidDate('2028-02-29'), true); // leap year
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('01/12/2026'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate(undefined), false);
  assert.equal(isValidDate(20261201), false);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('dayCount is inclusive (Sat to Sun is 2 days)', () => {
  assert.equal(dayCount('2026-12-05', '2026-12-05'), 1);
  assert.equal(dayCount('2026-12-05', '2026-12-06'), 2);
  // across the October clock change in the UK
  assert.equal(dayCount('2026-10-24', '2026-10-26'), 3);
});

test('eachDay lists every day in the range', () => {
  assert.deepEqual(eachDay('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
});

test('prettyRange formats one day or a range', () => {
  assert.equal(prettyRange('2026-12-05', '2026-12-05'), 'Sat 5 Dec');
  assert.equal(prettyRange('2026-12-05', '2026-12-06'), 'Sat 5 Dec – Sun 6 Dec');
});

test('normalisePostcode strips spaces and upper-cases', () => {
  assert.equal(normalisePostcode(' m1 1ae '), 'M11AE');
  assert.equal(normalisePostcode(undefined), '');
});
