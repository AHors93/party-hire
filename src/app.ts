// The Express app: routes and logic, without starting a server (so tests can start it themselves).
import path from 'path';
import crypto from 'crypto';
import express, { type Request, type RequestHandler } from 'express';
import cfg from './lib/config';
import Store from './lib/store';
import { isValidDate, todayUK, addDays, dayCount, eachDay, prettyRange } from './lib/dates';
import { lookupPostcode, drivingMiles, type Place } from './lib/distance';
import { hireQuote, deliveryQuote, round2 } from './lib/pricing';
import type {
  AdminBookingsResponse,
  AdminPatchBody,
  AvailabilityResponse,
  Booking,
  BookingStatus,
  CreateBookingResponse,
  DeliveryQuote,
  DeliveryQuoteOk,
  DepositStatus,
  PaymentMethod,
  PublicBooking,
  PublicBookingResponse,
  PublicConfig,
  QuoteResponse,
  Stock,
} from './shared/types';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const store = new Store(cfg.dataFile);
export const app = express();
app.set('trust proxy', cfg.trustProxy);
app.use(express.json({ limit: '20kb' }));

const STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'declined', 'completed', 'cancelled'];
const BLOCKING = new Set<BookingStatus>(['confirmed']); // only confirmed bookings use up stock
const PAYMENT_METHODS: Record<PaymentMethod, string> = { cash: 'Cash', bank_transfer: 'Bank transfer' };
const DEPOSIT_STATUSES: readonly DepositStatus[] = ['due', 'received', 'returned', 'kept'];

const isPaymentMethod = (v: unknown): v is PaymentMethod => typeof v === 'string' && v in PAYMENT_METHODS;
const isStatus = (v: unknown): v is BookingStatus => STATUSES.includes(v as BookingStatus);
const isDepositStatus = (v: unknown): v is DepositStatus => DEPOSIT_STATUSES.includes(v as DepositStatus);
const isPriced = (q: DeliveryQuote | null): q is DeliveryQuoteOk => !!q && q.error === undefined;
const paymentLabel = (m: string): string => PAYMENT_METHODS[m as PaymentMethod] || m;

// ---------- helpers ----------
function usageByDay(from: string, to: string, excludeId?: string): Record<string, Stock> {
  const usage: Record<string, Stock> = {};
  for (const b of store.all()) {
    if (!BLOCKING.has(b.status) || b.id === excludeId) continue;
    if (b.end < from || b.start > to) continue;
    for (const d of eachDay(b.start > from ? b.start : from, b.end < to ? b.end : to)) {
      usage[d] = usage[d] || { tables: 0, chairs: 0 };
      usage[d].tables += b.tables;
      usage[d].chairs += b.chairs;
    }
  }
  return usage;
}

function remainingForRange(start: string, end: string, excludeId?: string): Stock {
  const usage = usageByDay(start, end, excludeId);
  let tables = cfg.totalTables;
  let chairs = cfg.totalChairs;
  for (const d of eachDay(start, end)) {
    const u = usage[d] || { tables: 0, chairs: 0 };
    tables = Math.min(tables, cfg.totalTables - u.tables);
    chairs = Math.min(chairs, cfg.totalChairs - u.chairs);
  }
  return { tables: Math.max(0, tables), chairs: Math.max(0, chairs) };
}

interface ValidatedItems {
  errors: string[];
  tables: number;
  chairs: number;
  start: string;
  end: string;
}

function validateItems(body: Record<string, unknown>): ValidatedItems {
  const errors: string[] = [];
  const start = isValidDate(body.start) ? body.start : '';
  const end = isValidDate(body.end) ? body.end : '';
  const tables = Number(body.tables);
  const chairs = Number(body.chairs);
  if (!start || !end) errors.push('Please choose your dates.');
  else {
    if (start < todayUK()) errors.push('Start date is in the past.');
    if (end < start) errors.push('End date is before start date.');
    if (dayCount(start, end) > cfg.maxHireDays) errors.push(`Maximum hire is ${cfg.maxHireDays} days.`);
  }
  if (!Number.isInteger(tables) || tables < 0 || tables > cfg.totalTables) errors.push('Invalid number of tables.');
  if (!Number.isInteger(chairs) || chairs < 0 || chairs > cfg.totalChairs) errors.push('Invalid number of chairs.');
  if (tables + chairs === 0) errors.push('Please add at least one table or chair.');
  return { errors, tables, chairs, start, end };
}

async function buildDeliveryQuote(postcode: unknown): Promise<DeliveryQuote> {
  if (!cfg.homePostcode) return { error: 'Delivery pricing not set up yet – we will quote you directly.' };
  let home: Place | null;
  let dest: Place | null;
  try {
    [home, dest] = await Promise.all([lookupPostcode(cfg.homePostcode), lookupPostcode(postcode)]);
  } catch {
    return { error: "Couldn't check that postcode right now – we'll confirm the delivery cost with you." };
  }
  if (!dest) return { error: "That postcode doesn't look right.", badPostcode: true };
  if (!home) return { error: 'Delivery pricing not set up yet – we will quote you directly.' };
  const route = await drivingMiles(home, dest);
  return { postcode: dest.postcode, area: dest.area, method: route.method, ...deliveryQuote(route.miles, cfg) };
}

const str = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max);

function publicView(b: Booking): PublicBooking {
  return {
    id: b.id, ref: b.ref, status: b.status, name: b.name.split(' ')[0],
    start: b.start, end: b.end, dates: prettyRange(b.start, b.end), days: b.days,
    tables: b.tables, chairs: b.chairs, delivery: b.delivery,
    paymentMethod: paymentLabel(b.paymentMethod),
    hireTotal: b.hireTotal, deliveryFee: b.deliveryFee, bookingFee: b.bookingFee || 0, total: b.total,
    deposit: b.deposit || 0, depositStatus: b.depositStatus, amountDue: round2(b.total + (b.deposit || 0)),
    createdAt: b.createdAt,
  };
}

function baseUrl(req: Request): string {
  return cfg.publicUrl || `${req.protocol}://${req.get('host')}`;
}

function bookingUrl(req: Request, b: Booking): string {
  return `${baseUrl(req)}/b/${b.id}`;
}

async function notifyOwner(req: Request, b: Booking): Promise<void> {
  if (!cfg.ntfyTopic) return;
  const dq = b.deliveryQuote;
  const miles = isPriced(dq) && dq.oneWayMiles ? ` (~${dq.oneWayMiles} mi)` : '';
  const lines = [
    `${b.name} – ${b.tables} tables, ${b.chairs} chairs`,
    `${prettyRange(b.start, b.end)} (${b.days} day${b.days > 1 ? 's' : ''})`,
    b.delivery ? `Delivery to ${b.postcode}${miles}` : 'Collection',
    `Est. total £${b.total.toFixed(2)}${b.deposit ? ` + £${b.deposit.toFixed(2)} deposit` : ''} · ${PAYMENT_METHODS[b.paymentMethod]}`,
  ];
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(cfg.ntfyTopic)}`, {
      method: 'POST',
      body: lines.join('\n'),
      headers: { Title: `New booking request ${b.ref}`, Click: `${baseUrl(req)}/admin`, Tags: 'chair,tada' },
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.warn('ntfy notification failed:', e instanceof Error ? e.message : e);
  }
}

// Very small in-memory rate limiter for public POSTs
const hits = new Map<string, number[]>();
function rateLimit(max: number, windowMs: number): RequestHandler {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.status(429).json({ error: 'Too many requests – please try again later.' });
      return;
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

const adminAuth: RequestHandler = (req, res, next) => {
  if (!cfg.adminPassword) {
    res.status(503).send('Set ADMIN_PASSWORD to use the admin page.');
    return;
  }
  const [type, encoded] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = Buffer.from(pass);
    const b = Buffer.from(cfg.adminPassword);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Bookings admin"').status(401).send('Login required');
};

// ---------- public API ----------
app.get('/api/config', (req, res) => {
  const body: PublicConfig = {
    businessName: cfg.businessName,
    contactPhone: cfg.contactPhone,
    tablePrice: cfg.tablePrice,
    chairPrice: cfg.chairPrice,
    totalTables: cfg.totalTables,
    totalChairs: cfg.totalChairs,
    maxHireDays: cfg.maxHireDays,
    deliveryEnabled: Boolean(cfg.homePostcode),
    maxDeliveryMiles: cfg.maxDeliveryMiles,
    depositPercent: cfg.depositPercent,
    bookingFee: cfg.bookingFee,
    paymentMethods: PAYMENT_METHODS,
    today: todayUK(),
  };
  res.json(body);
});

app.get('/api/availability', (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : todayUK();
  let to = isValidDate(req.query.to) ? req.query.to : addDays(from, 41);
  if (dayCount(from, to) > 120) to = addDays(from, 119);
  const usage = usageByDay(from, to);
  const days: AvailabilityResponse['days'] = {};
  for (const d of eachDay(from, to)) {
    const u = usage[d] || { tables: 0, chairs: 0 };
    days[d] = { tables: Math.max(0, cfg.totalTables - u.tables), chairs: Math.max(0, cfg.totalChairs - u.chairs) };
  }
  res.json({ days } satisfies AvailabilityResponse);
});

app.post('/api/quote', rateLimit(60, 60_000), async (req, res) => {
  const body: Record<string, unknown> = req.body || {};
  const v = validateItems(body);
  const out: QuoteResponse = { errors: v.errors };
  if (!v.errors.length) {
    Object.assign(out, hireQuote(v, cfg));
    out.remaining = remainingForRange(v.start, v.end);
  }
  if (body.delivery && body.postcode) out.delivery = await buildDeliveryQuote(body.postcode);
  res.json(out);
});

app.post('/api/bookings', rateLimit(5, 60 * 60_000), async (req, res) => {
  const body: Record<string, unknown> = req.body || {};
  if (body.website) {
    res.json({ ok: true } satisfies CreateBookingResponse); // honeypot – bots fill hidden fields
    return;
  }

  const v = validateItems(body);
  const errors = [...v.errors];
  const name = str(body.name, 80);
  const phone = str(body.phone, 30);
  const email = str(body.email, 120);
  const delivery = Boolean(body.delivery);
  const address = str(body.address, 300);
  const postcode = str(body.postcode, 10);
  const notes = str(body.notes, 1000);
  const paymentMethod = body.paymentMethod;

  if (name.length < 2) errors.push('Please enter your name.');
  if (phone.replace(/\D/g, '').length < 10) errors.push('Please enter a valid phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('That email address looks wrong.');
  if (!isPaymentMethod(paymentMethod)) errors.push('Please choose how you would like to pay.');
  if (delivery && (!postcode || !address)) errors.push('Please enter your delivery address and postcode.');

  if (!errors.length) {
    const left = remainingForRange(v.start, v.end);
    if (v.tables > left.tables || v.chairs > left.chairs)
      errors.push(`Sorry, only ${left.tables} tables and ${left.chairs} chairs are free for those dates.`);
  }
  if (errors.length || !isPaymentMethod(paymentMethod)) {
    res.status(400).json({ errors });
    return;
  }

  const hire = hireQuote(v, cfg);
  let dq: DeliveryQuote | null = null;
  if (delivery) {
    dq = await buildDeliveryQuote(postcode);
    if (dq.badPostcode) {
      res.status(400).json({ errors: ["That postcode doesn't look right."] });
      return;
    }
  }
  const deliveryFee = isPriced(dq) && !dq.outOfArea ? dq.fee : null;

  const now = new Date().toISOString();
  const booking: Booking = {
    id: crypto.randomBytes(9).toString('base64url'),
    ref: 'PH-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    status: 'pending',
    name, phone, email,
    start: v.start, end: v.end, days: hire.days,
    tables: v.tables, chairs: v.chairs,
    delivery, address, postcode: (isPriced(dq) ? dq.postcode : '') || postcode,
    paymentMethod,
    notes,
    tablesCost: hire.tablesCost, chairsCost: hire.chairsCost, hireTotal: hire.hireTotal,
    deliveryQuote: dq,
    deliveryFee,
    bookingFee: cfg.bookingFee,
    total: round2(hire.hireTotal + (deliveryFee || 0) + cfg.bookingFee),
    deposit: hire.deposit,
    depositStatus: hire.deposit > 0 ? 'due' : null,
    adminNotes: '',
    createdAt: now,
    updatedAt: now,
  };
  store.insert(booking);
  void notifyOwner(req, booking);
  res.json({ ok: true, id: booking.id, ref: booking.ref, statusUrl: bookingUrl(req, booking) } satisfies CreateBookingResponse);
});

app.get('/api/bookings/:id', (req, res) => {
  const b = store.get(req.params.id);
  if (!b) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }
  res.json({ booking: publicView(b), contactPhone: cfg.contactPhone, businessName: cfg.businessName } satisfies PublicBookingResponse);
});

// ---------- admin ----------
app.get('/admin', adminAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use('/admin/api', adminAuth);

// Shows how the server sees your connection, to choose TRUST_PROXY (see README)
app.get('/admin/api/whoami', (req, res) => {
  res.json({
    ip: req.ip,
    ips: req.ips,
    forwardedFor: req.headers['x-forwarded-for'] ?? null,
    socketAddress: req.socket.remoteAddress ?? null,
    trustProxy: cfg.trustProxy,
  });
});

app.get('/admin/api/bookings', (req, res) => {
  const list = [...store.all()].sort((a, b) =>
    a.start === b.start ? b.createdAt.localeCompare(a.createdAt) : a.start.localeCompare(b.start),
  );
  const body: AdminBookingsResponse = {
    bookings: list.map((b) => {
      const left = remainingForRange(b.start, b.end, b.id);
      return {
        ...b,
        paymentLabel: paymentLabel(b.paymentMethod),
        dates: prettyRange(b.start, b.end),
        statusUrl: bookingUrl(req, b),
        amountDue: round2(b.total + (b.deposit || 0)),
        wouldOverbook: b.status === 'pending' && (b.tables > left.tables || b.chairs > left.chairs),
        stockLeft: left,
      };
    }),
    businessName: cfg.businessName,
    bankDetails: cfg.bankDetails,
    totals: { tables: cfg.totalTables, chairs: cfg.totalChairs },
  };
  res.json(body);
});

app.patch('/admin/api/bookings/:id', (req, res) => {
  const b = store.get(req.params.id);
  if (!b) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const body: AdminPatchBody = req.body || {};
  const patch: Partial<Booking> = {};
  if (body.status !== undefined) {
    if (!isStatus(body.status)) {
      res.status(400).json({ error: 'Bad status' });
      return;
    }
    if (body.status === 'confirmed' && b.status !== 'confirmed' && !body.force) {
      const left = remainingForRange(b.start, b.end, b.id);
      if (b.tables > left.tables || b.chairs > left.chairs) {
        res.status(409).json({ error: `Only ${left.tables} tables / ${left.chairs} chairs free on those dates.`, canForce: true });
        return;
      }
    }
    patch.status = body.status;
  }
  if (body.deliveryFee !== undefined) {
    const fee = body.deliveryFee === null || body.deliveryFee === '' ? null : Number(body.deliveryFee);
    if (fee !== null && (isNaN(fee) || fee < 0)) {
      res.status(400).json({ error: 'Bad delivery fee' });
      return;
    }
    patch.deliveryFee = fee === null ? null : round2(fee);
    patch.total = round2(b.hireTotal + (patch.deliveryFee || 0) + (b.bookingFee || 0));
  }
  if (body.adminNotes !== undefined) patch.adminNotes = str(body.adminNotes, 2000);
  if (body.paid !== undefined) patch.paid = Boolean(body.paid);
  if (body.depositStatus !== undefined) {
    if (!isDepositStatus(body.depositStatus)) {
      res.status(400).json({ error: 'Bad deposit status' });
      return;
    }
    patch.depositStatus = body.depositStatus;
    if (body.depositStatus === 'returned') patch.depositReturnedAt = new Date().toISOString();
  }
  res.json({ booking: store.update(b.id, patch) });
});

// ---------- pages ----------
app.get('/b/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'status.html')));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));
app.use((req, res) => {
  res.status(404).send('Not found');
});
