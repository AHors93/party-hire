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

## Put it on Railway (recommended, about 10 minutes)

Railway runs the site all the time, keeps your bookings file safe on a volume, and **updates the live site by itself every time code is pushed to GitHub**.
The Hobby plan is $5/month and includes $5 of usage, which an app this size should fit inside.

1. Go to [railway.com](https://railway.com), sign in with GitHub, and pick the **Hobby** plan.
2. **New Project → Deploy from GitHub repo → party-hire.** If it isn't listed, click *Configure GitHub App* and give Railway access to the repo.
   The first deploy starts straight away. It may complain until step 3 is done, which is fine.
3. Open the service → **Variables → Raw Editor**, paste in your settings from `.env.example` with your real values, and save. At least set
   `ADMIN_PASSWORD`, `HOME_POSTCODE`, `TOTAL_TABLES`, `TOTAL_CHAIRS`, `BANK_DETAILS`, `CONTACT_PHONE` and `BUSINESS_NAME`. Don't set `PORT`; Railway does that.
4. **Add storage for bookings:** right-click the service on the project canvas (or press ⌘K / Ctrl+K and type "volume") → **Attach volume**, with mount path `/data`.
   The app finds it automatically and saves bookings to `/data/bookings.json`. **Without a volume, bookings are lost on every update.**
5. **Settings → Networking → Generate Domain** gives you a `something.up.railway.app` address. You can also add your own domain there.
6. Add a variable `PUBLIC_URL` set to that address (e.g. `https://party-hire-production.up.railway.app`) so links in WhatsApp messages point to it.
7. Check it works: open the site, then `/admin`. Then do the `TRUST_PROXY` step below.

Updates are automatic from then on: anything pushed to the `main` branch on GitHub goes live within a couple of minutes.
Because the site uses a volume, it's offline for a few seconds during each update. Build and start commands live in `railway.json`.

**Backups:** in admin, **⬇ Download bookings** gives you a spreadsheet of every booking, and **Full backup** downloads the raw data file. Do this now and then.
To restore a backup, upload it to the volume as `bookings.json` (or ask for help).

## Or put it on Replit



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
npm start              # builds the TypeScript, then serves http://localhost:3000
```

## Code layout (TypeScript)

```
src/server.ts        Express server and API routes
src/lib/             config, dates, pricing, distance lookup, JSON file store
src/client/          browser code for the booking, admin and status pages
src/shared/types.d.ts  types shared by server and browser (Booking, quotes, API responses)
public/              HTML + CSS (compiled browser code lands in public/js/)
```

`npm start` runs `npm run build` first, which compiles `src/` to `dist/` (server) and `public/js/` (browser).
Both output folders are git-ignored. Use `npm run typecheck` to check types without building.

## Rate limiting (TRUST_PROXY)

Each visitor can send 5 booking requests an hour. To tell visitors apart, the app reads the `X-Forwarded-For` header that your host's proxies (Railway or Replit) add.
By default it trusts that header completely, so a determined spammer could fake it to get past the limit.
They still can't block your calendar, because only bookings you confirm use up stock.

To lock it down once the site is live:

1. On your phone (mobile data, not Wi-Fi), open `https://your-url/admin/api/whoami` and log in.
2. Look at `forwardedFor`. It's a list of IPs: your phone's IP first, then one IP for each proxy.
3. Count the IPs **after** your phone's IP, plus one. Set the variable/secret `TRUST_PROXY` to that number, then redeploy.
4. Open the page again. `ip` should now be your phone's IP.

If `ip` shows a host/cloud address instead of yours, the number is too high or low. Leaving `TRUST_PROXY` blank keeps the current behaviour.

## Tests

```
npm test            # unit + API tests (~1 second)
npm run test:e2e    # end-to-end in a real browser (Playwright)
npm run test:all    # type-check + all of the above
```

The first time on a new computer, run `npx playwright install chromium` to download the test browser.

- `test/unit/`: pricing, deposit rounding, delivery fees, dates.
- `test/api/`: the real server, covering validation, overbooking, stock only reserved once confirmed, the admin password, privacy of the status page, and rate limiting.
- `test/e2e/`: a browser books as a customer, then logs into admin, confirms (checks the WhatsApp message), and checks the status page and calendar update. It also checks the phone layout.

Tests use a throwaway data file and their own settings, so your real bookings, `.env` and phone notifications are never touched.
If a browser test fails, `npx playwright show-report` shows screenshots and a step-by-step trace.

## Want automatic deposit refunds later?

That needs card payments. Add Stripe Checkout to take the deposit by card, and the "Deposit returned" button can then call Stripe's refund API so the money goes back automatically.
