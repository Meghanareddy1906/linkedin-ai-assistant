/**
 * STEP 1: Manual login + session save
 *
 * What this does:
 * - Opens a real, visible Chromium browser (not headless, so you can see it)
 * - Navigates to LinkedIn's login page
 * - Waits for YOU to manually log in (enter email/password, solve any
 *   verification challenge, etc.)
 * - Once it detects you're logged in, saves the session (cookies, local
 *   storage) to a file called auth.json
 *
 * Why manual login matters:
 * - You want LinkedIn to see a normal login flow (real typing, real clicks,
 *   possibly 2FA) exactly as if you logged in yourself — because you are.
 * - This script does NOT automate the login itself. It only automates
 *   opening the browser and saving the result after you log in.
 *
 * Run with: node 1-login-and-save-session.js
 */

const { chromium } = require('playwright');

const AUTH_FILE = 'auth.json';

async function main() {
  console.log('Launching browser...');

  const browser = await chromium.launch({
    headless: false, // must be visible so you can log in manually
  });

  const context = await browser.newContext({
    // A realistic viewport and user agent help the session look normal
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  console.log('Navigating to LinkedIn login page...');
  await page.goto('https://www.linkedin.com/login');

  console.log('\n----------------------------------------');
  console.log('ACTION NEEDED:');
  console.log('Please log in manually in the browser window that just opened.');
  console.log('Enter your email/password, solve any CAPTCHA or verification');
  console.log('LinkedIn asks for, and wait until your feed loads.');
  console.log('This script will detect that automatically and continue.');
  console.log('----------------------------------------\n');

  // Wait until the URL changes to the logged-in feed page.
  // LinkedIn redirects to /feed once login succeeds.
  await page.waitForURL('**/feed/**', { timeout: 0 }); // timeout 0 = wait forever

  console.log('Login detected! Waiting a few seconds for the page to settle...');
  await page.waitForTimeout(3000);

  // Save the session (cookies + local storage) to disk
  await context.storageState({ path: AUTH_FILE });

  console.log(`\nSession saved to ${AUTH_FILE}`);
  console.log('You will NOT need to log in manually again — the next script');
  console.log('will reuse this saved session.');

  await browser.close();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
