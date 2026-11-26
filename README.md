# Party table & chair hire – booking requests

A small website where customers:

1. pick dates on a calendar (fully booked days are blocked),
2. choose how many tables and chairs,
3. choose delivery (postcode → distance → fuel-based delivery estimate) or collection,
4. choose **cash** or **bank transfer**,
5. send a request. They get a reference and a link to check its status.

You get a phone notification and an admin page (`/admin`) where you can:

- **Confirm & message**: marks it confirmed and opens WhatsApp with a ready-made confirmation (items, total, deposit, and your bank details if they picked bank transfer).
- **Decline & message**, cancel, mark it complete once collected, and edit the delivery fee.
- **Deposit**: mark it received, then either *Deposit returned → message them* or *Keep deposit* (for damage).
  For bank transfers there's an "Ask for refund bank details" WhatsApp button. Customer bank details are never stored.
- Get a warning when confirming would overbook your stock.

Only **confirmed** bookings reserve stock, so spam requests can't block your calendar.

## Put it on Replit (about 5 minutes)

1. Create a new Repl → **Import** → upload this folder (or push it to GitHub and import from there).
2. Open **Secrets** (🔒) and add at least:
   - `ADMIN_PASSWORD`: something long
   - `HOME_POSTCODE`: where you drive from (customers never see it)
   - `TOTAL_TABLES` / `TOTAL_CHAIRS`: what you own
   - `BANK_DETAILS`: e.g. `Name: A Smith | Sort code: 00-00-00 | Account: 12345678`
   - `CONTACT_PHONE`, `BUSINESS_NAME`
   - See `.env.example` for everything else (fuel price, MPG, deposit %, max delivery miles…).
3. Press **Run** to test, then **Deploy** → **Reserved VM** (the cheapest one is fine).
   ⚠️ Use *Reserved VM*, not *Autoscale*: bookings are saved to `data/bookings.json`, and Autoscale doesn't keep files between restarts.
4. Set `PUBLIC_URL` to your deployed URL so links in messages point to the right place.
5. Put the URL in your Facebook advert and in your auto-reply.

Admin: `https://your-url/admin`. Any username works; the password is `ADMIN_PASSWORD`.

## Phone notifications (free)

Install the **ntfy** app (iOS/Android), subscribe to a topic name nobody would guess (e.g. `adam-party-hire-8f3k2`), and set `NTFY_TOPIC` to the same name. Each new request pings your phone, and tapping it opens the admin page.

## Delivery estimate

Distance is the driving distance from your postcode (via postcodes.io + OSRM, both free and need no key). If routing is down, it falls back to straight-line × 1.3.

```
fee = (one-way miles × 2 × DELIVERY_TRIPS) ÷ MPG × 4.546 × FUEL_PRICE_PER_LITRE + DELIVERY_BASE_FEE
```

The result is rounded up to the nearest 50p. With the defaults (40 mpg, £1.40/L, 2 trips), a customer 6 miles away pays about £4. Set `DELIVERY_BASE_FEE` if you want to charge for your time too.

## Run locally

```
cp .env.example .env   # edit it
npm install
npm start              # http://localhost:3000
```

## Want automatic deposit refunds later?

That needs card payments. Add Stripe Checkout to take the deposit by card, and the "Deposit returned" button can then call Stripe's refund API so the money goes back automatically.
