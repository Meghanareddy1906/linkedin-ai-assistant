/**
 * STEP 4: Read full message threads
 *
 * What this does:
 * - Reuses your saved auth.json session
 * - Navigates to LinkedIn messaging
 * - Finds each conversation in the list
 * - CLICKS into each one (this is still read-only — clicking to open/view
 *   a conversation does not send anything or change any data)
 * - Extracts every message in that thread: who sent it, the text, and
 *   roughly when
 * - Saves everything to threads-data.json
 *
 * This is still READ-ONLY. It only opens conversations to view them, the
 * same as you would by clicking on them yourself. It does not type,
 * send, or modify anything.
 *
 * NOTE: Like the previous script, the exact selectors here are a best
 * guess at LinkedIn's current structure. If results look empty or wrong,
 * we'll inspect the actual page together and adjust.
 *
 * Run with: node 4-read-full-threads.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'auth.json';
const OUTPUT_FILE = 'threads-data.json';

async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`No ${AUTH_FILE} found. Run 1-login-and-save-session.js first.`);
    process.exit(1);
  }

  console.log('Launching browser with saved session...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  console.log('Navigating to LinkedIn messaging...');
  await page.goto('https://www.linkedin.com/messaging/', {
    waitUntil: 'domcontentloaded',
  });

  console.log('Waiting for conversation list to load...');
  await page.waitForTimeout(5000);

  // Get the count of conversations in the list first
  const conversationCount = await page.locator('li.msg-conversation-listitem').count();
  console.log(`Found ${conversationCount} conversation(s) in the list.`);

  if (conversationCount === 0) {
    console.log('\n⚠️  No conversations found in the list.');
    console.log('Taking a screenshot to inspect the page...');
    await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
    console.log('Check debug-screenshot.png to see what the page looked like.');
    await browser.close();
    return;
  }

  const allThreads = [];

  // Loop through each conversation, click it, and extract the thread
  for (let i = 0; i < conversationCount; i++) {
    console.log(`\nOpening conversation ${i + 1} of ${conversationCount}...`);

    // Re-locate the list each time since clicking can change the DOM
    const conversationItems = page.locator('li.msg-conversation-listitem');
    const item = conversationItems.nth(i);

    // Get the participant name before clicking, for reference
    const participantName = await item
      .locator('.msg-conversation-listitem__participant-names')
      .textContent()
      .catch(() => 'UNKNOWN');

    await item.click();

    // Wait for the message thread panel to load
    await page.waitForTimeout(2500);

    // Extract all messages in the currently open thread
    const messages = await page.evaluate(() => {
      const results = [];
      const messageEls = document.querySelectorAll('.msg-s-event-listitem');

      messageEls.forEach((el) => {
        const senderEl = el.querySelector('.msg-s-message-group__name');
        const textEl = el.querySelector('.msg-s-event-listitem__body');
        const timeEl = el.querySelector('time');

        // Only push if there's actual message text (avoids empty group headers)
        if (textEl) {
          results.push({
            sender: senderEl ? senderEl.textContent.trim() : null, // null = same as previous sender
            text: textEl.textContent.trim(),
            timestamp: timeEl
              ? timeEl.getAttribute('datetime') || timeEl.textContent.trim()
              : null,
          });
        }
      });

      return results;
    });

    console.log(`  -> ${participantName.trim()}: captured ${messages.length} message(s)`);

    allThreads.push({
      participant: participantName.trim(),
      messageCount: messages.length,
      messages: messages,
    });

    // Small pause between conversations to behave more like a human
    // browsing (not strictly necessary here since this is read-only, but
    // good habit for anything touching LinkedIn's pages repeatedly)
    await page.waitForTimeout(1000);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allThreads, null, 2));
  console.log(`\nSaved ${allThreads.length} thread(s) to ${OUTPUT_FILE}`);

  if (allThreads.length > 0 && allThreads[0].messages.length === 0) {
    console.log('\n⚠️  Note: conversations were found and opened, but no messages');
    console.log('were captured inside them. This likely means the message-item');
    console.log('selector needs adjusting. Taking a screenshot for reference...');
    await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
  }

  console.log('\nLeaving browser open for 15 seconds...');
  await page.waitForTimeout(15000);

  await browser.close();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
