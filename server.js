// Load .env when running locally (Replit uses Secrets instead)
try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(); } catch {}

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cfg = require('./lib/config');
const Store = require('./lib/store');
const { isValidDate, todayUK, addDays, dayCount, eachDay, prettyRange } = require('./lib/dates');
const { lookupPostcode, drivingMiles } = require('./lib/distance');
const { hireQuote, deliveryQuote, round2 } = require('./lib/pricing');

const store = new Store(cfg.dataFile);
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '20kb' }));

const STATUSES = ['pending', 'confirmed', 'declined', 'completed', 'cancelled'];
const BLOCKING = new Set(['confirmed']); // only confirmed bookings use up stock
const PAYMENT_METHODS = { cash: 'Cash', bank_transfer: 'Bank transfer' };
const DEPOSIT_STATUSES = ['due', 'received', 'returned', 'kept'];

// ---------- helpers ----------
function usageByDay(from, to, excludeId) {
  const usage = {};
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

function remainingForRange(start, end, excludeId) {
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

function validateItems(body) {
  const errors = [];
  const { start, end } = body;
  const tables = Number(body.tables);
  const chairs = Number(body.chairs);
  if (!isValidDate(start) || !isValidDate(end)) errors.push('Please choose your dates.');
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

async function buildDeliveryQuote(postcode) {
  if (!cfg.homePostcode) return { error: 'Delivery pricing not set up yet – we will quote you directly.' };
  let home, dest;
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

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function publicView(b) {
  return {
    id: b.id, ref: b.ref, status: b.status, name: b.name.split(' ')[0],
    start: b.start, end: b.end, dates: prettyRange(b.start, b.end), days: b.days,
    tables: b.tables, chairs: b.chairs, delivery: b.delivery,
    paymentMethod: PAYMENT_METHODS[b.paymentMethod] || b.paymentMethod,
    hireTotal: b.hireTotal, deliveryFee: b.deliveryFee, bookingFee: b.bookingFee || 0, total: b.total,
    deposit: b.deposit || 0, depositStatus: b.depositStatus, amountDue: round2(b.total + (b.deposit || 0)),
    createdAt: b.createdAt,
  };
}

function bookingUrl(req, b) {
  const base = cfg.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/b/${b.id}`;
}

async function notifyOwner(req, b) {
  if (!cfg.ntfyTopic) return;
  const base = cfg.publicUrl || `${req.protocol}://${req.get('host')}`;
  const lines = [
    `${b.name} – ${b.tables} tables, ${b.chairs} chairs`,
    `${prettyRange(b.start, b.end)} (${b.days} day${b.days > 1 ? 's' : ''})`,
    b.delivery ? `Delivery to ${b.postcode}${b.deliveryQuote?.oneWayMiles ? ` (~${b.deliveryQuote.oneWayMiles} mi)` : ''}` : 'Collection',
    `Est. total £${b.total.toFixed(2)}${b.deposit ? ` + £${b.deposit.toFixed(2)} deposit` : ''} · ${PAYMENT_METHODS[b.paymentMethod]}`,
  ];
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(cfg.ntfyTopic)}`, {
      method: 'POST',
      body: lines.join('\n'),
      headers: { Title: `New booking request ${b.ref}`, Click: `${base}/admin`, Tags: 'chair,tada' },
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.warn('ntfy notification failed:', e.message);
  }
}

// Very small in-memory rate limiter for public POSTs
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests – please try again later.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

function adminAuth(req, res, next) {
  if (!cfg.adminPassword) return res.status(503).send('Set ADMIN_PASSWORD to use the admin page.');
  const [type, encoded] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = Buffer.from(pass);
    const b = Buffer.from(cfg.adminPassword);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Bookings admin"').status(401).send('Login required');
}

// ---------- public API ----------
app.get('/api/config', (req, res) => {
  res.json({
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
  });
});

app.get('/api/availability', (req, res) => {
  const from = isValidDate(req.query.from) ? req.query.from : todayUK();
  let to = isValidDate(req.query.to) ? req.query.to : addDays(from, 41);
  if (dayCount(from, to) > 120) to = addDays(from, 119);
  const usage = usageByDay(from, to);
  const days = {};
  for (const d of eachDay(from, to)) {
    const u = usage[d] || { tables: 0, chairs: 0 };
    days[d] = { tables: Math.max(0, cfg.totalTables - u.tables), chairs: Math.max(0, cfg.totalChairs - u.chairs) };
  }
  res.json({ days });
});

app.post('/api/quote', rateLimit(60, 60_000), async (req, res) => {
  const v = validateItems(req.body);
  const out = { errors: v.errors };
  if (!v.errors.length) {
    Object.assign(out, hireQuote(v, cfg));
    out.remaining = remainingForRange(v.start, v.end);
  }
  if (req.body.delivery && req.body.postcode) out.delivery = await buildDeliveryQuote(req.body.postcode);
  res.json(out);
});

app.post('/api/bookings', rateLimit(5, 60 * 60_000), async (req, res) => {
  const body = req.body || {};
  if (body.website) return res.json({ ok: true }); // honeypot – bots fill hidden fields

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
  if (!PAYMENT_METHODS[paymentMethod]) errors.push('Please choose how you would like to pay.');
  if (delivery && (!postcode || !address)) errors.push('Please enter your delivery address and postcode.');

  if (!errors.length) {
    const left = remainingForRange(v.start, v.end);
    if (v.tables > left.tables || v.chairs > left.chairs)
      errors.push(`Sorry, only ${left.tables} tables and ${left.chairs} chairs are free for those dates.`);
  }
  if (errors.length) return res.status(400).json({ errors });

  const hire = hireQuote(v, cfg);
  let dq = null;
  if (delivery) {
    dq = await buildDeliveryQuote(postcode);
    if (dq.badPostcode) return res.status(400).json({ errors: ["That postcode doesn't look right."] });
  }
  const deliveryFee = dq && !dq.error && !dq.outOfArea ? dq.fee : null;

  const booking = {
    id: crypto.randomBytes(9).toString('base64url'),
    ref: 'PH-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    status: 'pending',
    name, phone, email,
    start: v.start, end: v.end, days: hire.days,
    tables: v.tables, chairs: v.chairs,
    delivery, address, postcode: dq?.postcode || postcode,
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.insert(booking);
  notifyOwner(req, booking);
  res.json({ ok: true, id: booking.id, ref: booking.ref, statusUrl: bookingUrl(req, booking) });
});

app.get('/api/bookings/:id', (req, res) => {
  const b = store.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  res.json({ booking: publicView(b), contactPhone: cfg.contactPhone, businessName: cfg.businessName });
});

// ---------- admin ----------
app.get('/admin', adminAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use('/admin/api', adminAuth);

app.get('/admin/api/bookings', (req, res) => {
  const list = [...store.all()].sort((a, b) => (a.start === b.start ? b.createdAt.localeCompare(a.createdAt) : a.start.localeCompare(b.start)));
  res.json({
    bookings: list.map((b) => {
      const left = remainingForRange(b.start, b.end, b.id);
      return {
        ...b,
        paymentLabel: PAYMENT_METHODS[b.paymentMethod] || b.paymentMethod,
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
  });
});

app.patch('/admin/api/bookings/:id', (req, res) => {
  const b = store.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const patch = {};
  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
    if (req.body.status === 'confirmed' && b.status !== 'confirmed' && !req.body.force) {
      const left = remainingForRange(b.start, b.end, b.id);
      if (b.tables > left.tables || b.chairs > left.chairs)
        return res.status(409).json({ error: `Only ${left.tables} tables / ${left.chairs} chairs free on those dates.`, canForce: true });
    }
    patch.status = req.body.status;
  }
  if (req.body.deliveryFee !== undefined) {
    const fee = req.body.deliveryFee === null || req.body.deliveryFee === '' ? null : Number(req.body.deliveryFee);
    if (fee !== null && (isNaN(fee) || fee < 0)) return res.status(400).json({ error: 'Bad delivery fee' });
    patch.deliveryFee = fee === null ? null : round2(fee);
    patch.total = round2(b.hireTotal + (patch.deliveryFee || 0) + (b.bookingFee || 0));
  }
  if (req.body.adminNotes !== undefined) patch.adminNotes = str(req.body.adminNotes, 2000);
  if (req.body.paid !== undefined) patch.paid = Boolean(req.body.paid);
  if (req.body.depositStatus !== undefined) {
    if (!DEPOSIT_STATUSES.includes(req.body.depositStatus)) return res.status(400).json({ error: 'Bad deposit status' });
    patch.depositStatus = req.body.depositStatus;
    if (req.body.depositStatus === 'returned') patch.depositReturnedAt = new Date().toISOString();
  }
  res.json({ booking: store.update(b.id, patch) });
});

// ---------- pages ----------
app.get('/b/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'status.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', extensions: ['html'] }));
app.use((req, res) => res.status(404).send('Not found'));

app.listen(cfg.port, '0.0.0.0', () => {
  console.log(`${cfg.businessName} bookings running on port ${cfg.port}`);
  if (!cfg.adminPassword) console.warn('⚠️  ADMIN_PASSWORD is not set – the admin page is disabled.');
  if (!cfg.homePostcode) console.warn('⚠️  HOME_POSTCODE is not set – delivery costs will not be estimated.');
});
