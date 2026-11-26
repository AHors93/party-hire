// Dates are handled as 'YYYY-MM-DD' strings in UK time to avoid timezone surprises.
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function todayUK() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Inclusive: Sat -> Sat is 1 day, Sat -> Sun is 2 days
function dayCount(start, end) {
  return Math.round((new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000) + 1;
}

function eachDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function prettyDate(s) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function prettyRange(start, end) {
  return start === end ? prettyDate(start) : `${prettyDate(start)} – ${prettyDate(end)}`;
}

module.exports = { isValidDate, todayUK, addDays, dayCount, eachDay, prettyDate, prettyRange };
