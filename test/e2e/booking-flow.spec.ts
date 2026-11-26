// End-to-end: a real browser goes through the site the way a customer and the owner would.
import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = { username: 'owner', password: 'e2e-password' };

// Shared between the steps below
let bookedDay = '';
let ref = '';
let statusPath = '';

async function pickFirstFreeDay(page: Page): Promise<string> {
  const day = page.locator('#cal button.day:not([disabled])').first();
  await expect(day).toBeVisible();
  const d = (await day.getAttribute('data-d'))!;
  await day.click();
  await expect(page.locator('#chosen')).toContainText('1 day');
  return d;
}

test('homepage shows the business, prices from settings and the booking form', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Test Party Hire/);
  await expect(page.locator('.topbar [data-biz]')).toHaveText('Test Party Hire');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tables & chairs for your party');
  // TABLE_PRICE=8 in the test settings, so the page must show £8.00, not the £7.50 default
  await expect(page.locator('[data-price=table]').first()).toHaveText('£8.00');
  await expect(page.locator('#footer')).toContainText('07000 000000');

  await page.getByRole('link', { name: 'Check availability' }).click();
  await expect(page.locator('#book')).toBeInViewport();
});

test('submitting an empty form shows what is missing', async ({ page }) => {
  await page.goto('/#book');
  await page.getByRole('button', { name: 'Send booking request' }).click();
  const errors = page.locator('#errors');
  await expect(errors).toContainText('Please choose your dates.');
  await expect(errors).toContainText('Please add at least one table or chair.');
  await expect(errors).toContainText('Please choose cash or bank transfer.');
  await expect(errors).toContainText('Please enter your name.');
});

test('customer books 2 tables and 10 chairs for collection', async ({ page }) => {
  await page.goto('/#book');
  bookedDay = await pickFirstFreeDay(page);

  await page.getByRole('button', { name: 'More tables' }).click();
  await page.getByRole('button', { name: 'More tables' }).click();
  await page.locator('#chairs').fill('10');
  await page.getByText("I'll collect").click();

  // 2 x £8 + 10 x £1.50 = £31, + £1.50 booking fee = £32.50; deposit 10% of £31 = £3.10 -> £3.50
  const quote = page.locator('#summary');
  await expect(quote).toContainText('2 tables × 1 day');
  await expect(quote).toContainText('10 chairs × 1 day');
  await expect(quote.locator('tr.total')).toContainText('£32.50');
  await expect(quote).toContainText('£3.50');
  await expect(quote).toContainText('£36.00');

  await page.getByLabel('Name').fill('Playwright Tester');
  await page.getByLabel('Phone (WhatsApp if possible)').fill('07123 456789');
  await page.getByText('Cash', { exact: true }).click();
  await page.getByRole('button', { name: 'Send booking request' }).click();

  await expect(page.locator('#success-view')).toBeVisible();
  await expect(page.locator('#form-view')).toBeHidden();
  ref = (await page.locator('#s-ref').textContent())!;
  expect(ref).toMatch(/^PH-[0-9A-F]{6}$/);
  statusPath = (await page.locator('#s-link').getAttribute('href'))!;

  await page.locator('#s-link').click();
  await expect(page.locator('#out')).toContainText('Hi Playwright');
  await expect(page.locator('#out .badge')).toHaveText('pending');
  await expect(page.locator('#out')).toContainText(ref);
  await expect(page.locator('#out tr.total')).toContainText('£32.50');
});

test('a pending request does not block the calendar yet', async ({ page }) => {
  await page.goto('/#book');
  await expect(page.locator(`#cal button[data-d="${bookedDay}"]`)).toHaveAttribute('title', '10 tables, 60 chairs free');
});

test('admin page asks for a password', async ({ browser }) => {
  const ctx = await browser.newContext({ httpCredentials: { username: 'owner', password: 'wrong' } });
  const res = await (await ctx.newPage()).goto('/admin');
  expect(res?.status()).toBe(401);
  await ctx.close();
});

test('owner confirms the booking, and WhatsApp opens with the confirmation message', async ({ browser }) => {
  const ctx = await browser.newContext({ httpCredentials: ADMIN });
  // Catch the WhatsApp link instead of really going to wa.me
  await ctx.route('https://wa.me/**', (route) => route.fulfill({ body: 'whatsapp stub', contentType: 'text/plain' }));
  const page = await ctx.newPage();
  await page.goto('/admin');

  const card = page.locator('.bk', { hasText: ref });
  await expect(card).toBeVisible();
  await expect(card.locator('.badge')).toHaveText('pending');

  const popupPromise = page.waitForEvent('popup');
  await card.getByRole('button', { name: 'Confirm & message' }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/wa\.me/);
  const url = new URL(popup.url());
  expect(url.pathname).toBe('/447123456789'); // UK number converted for WhatsApp
  const message = url.searchParams.get('text')!;
  expect(message).toContain(`Your booking ${ref} is confirmed`);
  expect(message).toContain('Payment in cash on collection');
  expect(message).toContain('Total to pay: £36.00');

  await page.getByRole('button', { name: /Upcoming/ }).click();
  await expect(page.locator('.bk', { hasText: ref }).locator('.badge')).toHaveText('confirmed');
  await ctx.close();
});

test('customer status page now says confirmed', async ({ page }) => {
  await page.goto(statusPath);
  await expect(page.locator('#out .badge')).toHaveText('confirmed');
  await expect(page.locator('#out')).toContainText("You're booked in!");
});

test('confirmed booking reduces stock on the calendar', async ({ page }) => {
  await page.goto('/#book');
  await expect(page.locator(`#cal button[data-d="${bookedDay}"]`)).toHaveAttribute('title', '8 tables, 50 chairs free');

  // and the customer can't add more tables than are left on that day
  await page.locator(`#cal button[data-d="${bookedDay}"]`).click();
  await page.locator('#tables').fill('9');
  await expect(page.locator('#tables')).toHaveValue('8');
  await expect(page.locator('#t-left')).toHaveText('8 available');
});

test('delivery estimate appears in the quote', async ({ page }) => {
  // The real estimate calls postcode/route services; here we fake that answer to test the page itself
  await page.route('**/api/quote', (route) =>
    route.fulfill({
      json: {
        errors: [],
        delivery: { postcode: 'M20 2RN', area: 'Manchester', method: 'road', oneWayMiles: 6.2, totalMiles: 24.8, fuelCost: 3.94, fee: 4, outOfArea: false },
      },
    }),
  );
  await page.goto('/#book');
  await pickFirstFreeDay(page);
  await page.getByRole('button', { name: 'More tables' }).click();
  await page.getByLabel('Postcode').fill('M20 2RN');
  await expect(page.locator('#delivery-note')).toContainText('about 6.2 miles away');
  await expect(page.locator('#summary')).toContainText('Delivery & collection (estimate)');
  await expect(page.locator('#summary')).toContainText('£4.00');
});

test('works on a phone screen without sideways scrolling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Book now' }).first()).toBeVisible();
  await expect(page.locator('.nav-links')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});
