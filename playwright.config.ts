import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 3456;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1, // the tests share one server and build on each other's bookings
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Builds and starts the real app, exactly like `npm start`, with test settings
    command: 'npm run build && node dist/server.js',
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      DATA_FILE: path.join(os.tmpdir(), `party-hire-e2e-${Date.now()}.json`),
      ADMIN_PASSWORD: 'e2e-password',
      BUSINESS_NAME: 'Test Party Hire',
      CONTACT_PHONE: '07000 000000',
      TABLE_PRICE: '8',
      CHAIR_PRICE: '1.5',
      TOTAL_TABLES: '10',
      TOTAL_CHAIRS: '60',
      BOOKING_FEE: '1.5',
      DEPOSIT_PERCENT: '10',
      BANK_DETAILS: 'Name: Test | Sort code: 00-00-00 | Account: 12345678',
      HOME_POSTCODE: '', // no real postcode lookups during tests
      TELEGRAM_BOT_TOKEN: '', // never message your phone from tests
      TELEGRAM_CHAT_ID: '',
      PUBLIC_URL: '',
    },
  },
});
