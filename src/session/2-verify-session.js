/**
 * Verify saved session works
 *
 * What this does:
 * - Opens a new browser using the auth.json session saved in step 1
 * - Navigates directly to LinkedIn's feed
 * - Checks whether you land on the feed (logged in) or get redirected to
 *   the login page (session didn't persist)
 *
 * This proves the foundation of the whole project: that Playwright can
 * reuse a saved LinkedIn session without you manually logging in every time.
 *
 * Run with: node 2-verify-session.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'data/auth.json';

async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`No ${AUTH_FILE} found. Run 1-login-and-save-session.js first.`);
    process.exit(1);
  }

  console.log('Launching browser with saved session...');

  const browser = await chromium.launch({
    headless: false, // keep visible for now so you can see what's happening
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE, // reuse the saved cookies/session
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  console.log('Navigating directly to LinkedIn feed...');
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });

  await page.waitForTimeout(3000);

  const currentUrl = page.url();

  if (currentUrl.includes('/feed')) {
    console.log('\n✅ SUCCESS: Session persisted. You are logged in without');
    console.log('re-entering credentials.');
    console.log(`Current URL: ${currentUrl}`);
  } else if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    console.log('\n❌ FAILED: You were redirected to login/verification.');
    console.log(`Current URL: ${currentUrl}`);
    console.log('This can happen if:');
    console.log('- The session expired');
    console.log('- LinkedIn flagged something and wants re-verification');
    console.log('- auth.json is stale/invalid');
    console.log('Try re-running 1-login-and-save-session.js to get a fresh session.');
  } else {
    console.log('\n⚠️ UNCLEAR: Landed on an unexpected page.');
    console.log(`Current URL: ${currentUrl}`);
  }

  console.log('\nLeaving browser open for 15 seconds so you can inspect it...');
  await page.waitForTimeout(15000);

  await browser.close();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
