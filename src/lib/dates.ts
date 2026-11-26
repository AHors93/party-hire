// Dates are handled as 'YYYY-MM-DD' strings in UK time to avoid timezone surprises.
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayUK(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

export function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Inclusive: Sat -> Sat is 1 day, Sat -> Sun is 2 days
export function dayCount(start: string, end: string): number {
  return Math.round((new Date(end + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime()) / 86400000) + 1;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function prettyDate(s: string): string {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export function prettyRange(start: string, end: string): string {
  return start === end ? prettyDate(start) : `${prettyDate(start)} – ${prettyDate(end)}`;
}
