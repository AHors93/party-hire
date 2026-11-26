// All settings come from environment variables (Replit "Secrets", or a .env file locally).
import path from 'path';

const num = (v: string | undefined, d: number): number =>
  v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v);

// TRUST_PROXY: how many proxies sit in front of the app (a number), "true"/"false", or a list of proxy IPs/ranges.
// Decides which visitor IP the rate limiter sees. Check /admin/api/whoami on the live site to pick it.
function trustProxy(v: string | undefined): boolean | number | string {
  if (v === undefined || v.trim() === '') return true; // previous behaviour
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^\d+$/.test(t)) return Number(t);
  return t;
}

const config = {
  port: num(process.env.PORT, 3000),
  businessName: process.env.BUSINESS_NAME || 'Party Table & Chair Hire',
  contactPhone: process.env.CONTACT_PHONE || '',
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),

  // Prices (per item, per day)
  tablePrice: num(process.env.TABLE_PRICE, 7.5),
  chairPrice: num(process.env.CHAIR_PRICE, 1.5),

  // Stock you own – used to stop double booking
  totalTables: num(process.env.TOTAL_TABLES, 10),
  totalChairs: num(process.env.TOTAL_CHAIRS, 60),
  maxHireDays: num(process.env.MAX_HIRE_DAYS, 14),

  // Delivery estimate
  homePostcode: (process.env.HOME_POSTCODE || '').trim(),
  mpg: num(process.env.MPG, 40),
  fuelPricePerLitre: num(process.env.FUEL_PRICE_PER_LITRE, 1.4),
  deliveryTrips: num(process.env.DELIVERY_TRIPS, 2), // drop-off + collection = 2 return trips
  deliveryBaseFee: num(process.env.DELIVERY_BASE_FEE, 0), // added on top of fuel
  minDeliveryFee: num(process.env.MIN_DELIVERY_FEE, 0),
  freeDeliveryMiles: num(process.env.FREE_DELIVERY_MILES, 0),
  maxDeliveryMiles: num(process.env.MAX_DELIVERY_MILES, 30),

  // Flat fee per booking – covers site running costs, deposit returns, card fees. 0 turns it off.
  bookingFee: num(process.env.BOOKING_FEE, 1.5),

  // Refundable deposit, as a % of the hire cost (not delivery). 0 turns it off.
  depositPercent: num(process.env.DEPOSIT_PERCENT, 10),

  // Payment – bank details are only ever put in YOUR confirmation message, never on the public site
  bankDetails: process.env.BANK_DETAILS || '',

  // Admin + notifications
  adminPassword: process.env.ADMIN_PASSWORD || '',
  ntfyTopic: process.env.NTFY_TOPIC || '',
  trustProxy: trustProxy(process.env.TRUST_PROXY),

  // Compiled file lives in dist/lib, so the project root is two levels up
  dataFile: process.env.DATA_FILE || path.join(__dirname, '..', '..', 'data', 'bookings.json'),
};

export type Config = typeof config;
export default config;
