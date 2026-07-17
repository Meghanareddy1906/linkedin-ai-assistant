/**
 * Read-only inbox scraper
 *
 * What this does:
 * - Reuses your saved auth.json session (no login needed)
 * - Navigates to LinkedIn's messaging page
 * - Extracts each conversation: who it's with, the most recent message
 *   preview, and whether it's unread
 * - Saves everything to inbox-data.json so you can inspect what was
 *   captured
 *
 * This is READ-ONLY. It does not send anything, click anything that
 * changes state, or interact with LinkedIn beyond looking at the page.
 *
 * IMPORTANT: LinkedIn's page structure changes periodically, so the
 * selectors below may need adjusting. If this script captures 0 results
 * or looks wrong, that's expected on the first run — we'll inspect the
 * actual page together and fix the selectors.
 *
 * Run with: node 3-read-inbox.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'data/auth.json';
const OUTPUT_FILE = 'data/inbox-data.json';

async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`No ${AUTH_FILE} found. Run 1-login-and-save-session.js first.`);
    process.exit(1);
  }

  console.log('Launching browser with saved session...');

  const browser = await chromium.launch({
    headless: false, // keep visible so you can see what's happening
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  console.log('Navigating to LinkedIn messaging...');
  await page.goto('https://www.linkedin.com/messaging/', {
    waitUntil: 'domcontentloaded',
  });

  // Give the page time to load the conversation list (LinkedIn loads a lot
  // of this dynamically via JavaScript after the initial page load)
  console.log('Waiting for conversation list to load...');
  await page.waitForTimeout(5000);

  // Try to find conversation list items.
  // NOTE: This selector is a best guess at LinkedIn's current structure.
  // If it captures nothing, we'll open DevTools together and find the
  // correct one.
  const conversations = await page.evaluate(() => {
    const results = [];

    // LinkedIn messaging list items are typically list elements within
    // the conversation list container
    const items = document.querySelectorAll('li.msg-conversation-listitem');

    items.forEach((item) => {
      const nameEl = item.querySelector('.msg-conversation-listitem__participant-names');
      const previewEl = item.querySelector('.msg-conversation-card__message-snippet');
      const timeEl = item.querySelector('time');
      const isUnread = item.classList.contains('msg-conversation-listitem--unread') ||
                        item.querySelector('.notification-badge') !== null;

      results.push({
        name: nameEl ? nameEl.textContent.trim() : 'UNKNOWN (selector may need fixing)',
        preview: previewEl ? previewEl.textContent.trim() : '',
        timestamp: timeEl ? timeEl.getAttribute('datetime') || timeEl.textContent.trim() : '',
        unread: isUnread,
      });
    });

    return results;
  });

  console.log(`\nFound ${conversations.length} conversation(s).`);

  if (conversations.length === 0) {
    console.log('\n⚠️  No conversations captured. This likely means LinkedIn\'s');
    console.log('page structure differs from what this script expects.');
    console.log('Leaving the browser open so we can inspect the actual HTML');
    console.log('together via DevTools (right-click a conversation → Inspect).');
  } else {
    // Save results to a local JSON file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(conversations, null, 2));
    console.log(`Saved to ${OUTPUT_FILE}`);
    console.log('\nPreview of first result:');
    console.log(conversations[0]);
  }

  console.log('\nLeaving browser open for 20 seconds for you to inspect...');
  await page.waitForTimeout(20000);

  await browser.close();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
