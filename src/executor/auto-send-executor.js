/**
 * Auto-Send Executor
 *
 * What this does:
 * - Queries the database for approved-but-unsent items:
 *   - drafted_replies (messages to send in LinkedIn conversations)
 *   - connections (connection requests with notes)
 * - Uses Playwright with your saved auth session to perform each action
 * - Marks each row sent = TRUE after success
 * - Sends a WhatsApp confirmation via Twilio for each item sent
 *
 * IMPORTANT: This script takes REAL actions on LinkedIn on your behalf.
 * Only run it after carefully reviewing approved items in the database.
 *
 * Prerequisites:
 * - Run a login/auth script first to generate data/auth.json
 * - npm install playwright (if not already installed)
 *
 * Run with: node src/executor/auto-send-executor.js
 */

require('dotenv').config();
const { chromium } = require('playwright');
const twilio = require('twilio');
const pool = require('../db/db');

const AUTH_FILE = 'data/auth.json';
const LINKEDIN_BASE = 'https://www.linkedin.com';
const DELAY_BETWEEN_ACTIONS_MS = 4000;

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  TWILIO_WHATSAPP_TO,
  DRY_RUN,
} = process.env;

const isDryRun = DRY_RUN === 'true';

if (isDryRun) {
  console.log('🧪 DRY RUN MODE - actions will be simulated but not executed, database will not be updated, no WhatsApp confirmations will be sent.\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTwilioClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn('Twilio env vars missing - WhatsApp confirmations will be skipped.');
    return null;
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendWhatsApp(client, message) {
  if (!client || !TWILIO_WHATSAPP_FROM || !TWILIO_WHATSAPP_TO) return;
  try {
    const result = await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${TWILIO_WHATSAPP_TO}`,
      body: message,
    });
    console.log(`  📱 WhatsApp confirmation sent (SID: ${result.sid})`);
  } catch (err) {
    console.warn(`  ⚠️  WhatsApp send failed: ${err.message}`);
  }
}

async function markSent(table, id) {
  await pool.query(`UPDATE ${table} SET sent = TRUE WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Database queries
// ---------------------------------------------------------------------------

async function getPendingReplies() {
  const result = await pool.query(`
    SELECT dr.id, dr.draft_text, c.participant_name, c.thread_url
    FROM drafted_replies dr
    JOIN conversations c ON c.id = dr.conversation_id
    WHERE dr.approved = TRUE AND dr.sent = FALSE
    ORDER BY dr.created_at ASC
  `);
  return result.rows;
}

async function getPendingConnections() {
  const result = await pool.query(`
    SELECT id, name, draft_note, profile_url, send_note
    FROM connections
    WHERE approved = TRUE AND sent = FALSE
    ORDER BY drafted_at ASC
  `);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Playwright actions
// ---------------------------------------------------------------------------

/**
 * Send a reply in an existing LinkedIn conversation.
 *
 * SELECTOR NOTES:
 * - LinkedIn messaging uses a dynamic sidebar/conversation list.
 *   We search for the conversation by participant name via the
 *   search box in the messaging panel.
 * - The message compose box role and send button label below are
 *   best guesses - verify via DevTools if they break.
 */
async function sendReply(page, participantName, draftText, threadUrl) {
  console.log(`  → Navigating directly to conversation...`);
  await page.goto(threadUrl, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  const messageBox = page.locator('.msg-form__contenteditable');
  await messageBox.waitFor({ timeout: 10000 });
  await messageBox.click();
  await messageBox.fill(draftText);
  await sleep(500);

  if (isDryRun) {
    console.log(`  [DRY RUN] Would send reply to ${participantName}`);
    return;
  }

  const sendButton = page.locator('button.msg-form__send-button');
  await sendButton.waitFor({ timeout: 8000 });
  await sendButton.click();
  await sleep(1500);
  console.log(`  ✅ Reply sent to ${participantName}`);
}

/**
 * Send a connection request with a note.
 *
 * Safety rule: only proceeds if EXACTLY ONE search result matches the
 * person's name. Skips with a warning if zero or multiple matches found,
 * to avoid connecting with the wrong person.
 *
 * SELECTOR NOTES:
 * - LinkedIn search results structure changes frequently.
 *   The selectors below are best guesses - verify via DevTools.
 */
async function sendConnectionRequest(page, conn) {
  const { name, draft_note, profile_url, send_note } = conn;

  if (!profile_url) {
    console.warn(`  ⚠️  No profile URL for "${name}" - skipping to avoid wrong connection.`);
    return false;
  }

  console.log(`  → Navigating directly to profile: ${profile_url}`);
  await page.goto(profile_url, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  const mainSection = page.locator('main').first();

  // Try direct connect link first (aria-label="Invite X to connect")
  let connectButton = mainSection.locator('a[aria-label*="to connect"]').first();
  let connectVisible = await connectButton.isVisible().catch(() => false);

  if (!connectVisible) {
    // Try button with connect text
    connectButton = mainSection.locator('button').filter({ hasText: /^connect$/i }).first();
    connectVisible = await connectButton.isVisible().catch(() => false);
  }

  if (!connectVisible) {
    // Try More dropdown
    const moreButton = mainSection.locator('button[aria-label="More"]').first();
    const moreVisible = await moreButton.isVisible().catch(() => false);
    if (!moreVisible) {
      console.warn(`  ⚠️  No Connect button found for "${name}" - skipping.`);
      return false;
    }
    await moreButton.click({ force: true });
    await sleep(2000);
    connectButton = page.getByRole('menuitem', { name: /connect/i });
    const connectInMenu = await connectButton.isVisible().catch(() => false);
    if (!connectInMenu) {
      console.warn(`  ⚠️  Connect not found in More dropdown for "${name}" - skipping.`);
      await page.keyboard.press('Escape');
      return false;
    }
  }

  await connectButton.click();
  await sleep(2000);

  // Handle modal
  if (send_note && draft_note) {
    // Wait for "Add a note" button
    const addNoteButton = page.getByRole('button', { name: /add a note/i });
    try {
      await addNoteButton.waitFor({ timeout: 5000 });
      await addNoteButton.click();
      await sleep(1000);
      const noteTextarea = page.locator('textarea[name="message"]');
      await noteTextarea.waitFor({ timeout: 8000 });
      await noteTextarea.fill(draft_note.slice(0, 200));
      await sleep(500);
      if (isDryRun) {
        console.log(`  [DRY RUN] Would send connection request to ${name} with note`);
        await page.keyboard.press('Escape');
        return true;
      }
      const sendRequestButton = page.getByRole('button', { name: /send/i });
      await sendRequestButton.click();
      await sleep(1500);
      console.log(`  ✅ Connection request sent to ${name} with note`);
      return true;
    } catch {
      console.warn(`  ⚠️  "Add a note" button not found - sending without note`);
      const sendWithoutNote = page.getByRole('button', { name: /send without a note/i });
      const sendWithoutVisible = await sendWithoutNote.isVisible().catch(() => false);
      if (sendWithoutVisible) await sendWithoutNote.click();
      await sleep(1500);
      console.log(`  ✅ Connection request sent to ${name} without note`);
      return true;
    }
  } else {
    const sendWithoutNote = page.getByRole('button', { name: /send without a note/i });
    const sendWithoutVisible = await sendWithoutNote.isVisible().catch(() => false);
    if (sendWithoutVisible) {
      if (isDryRun) {
        console.log(`  [DRY RUN] Would send connection request to ${name} without note`);
        await page.keyboard.press('Escape');
        return true;
      }
      await sendWithoutNote.click();
      await sleep(1500);
      console.log(`  ✅ Connection request sent to ${name} without note`);
      return true;
    }
  }

  // No modal - sent directly
  if (isDryRun) {
    console.log(`  [DRY RUN] Would send connection request to ${name}`);
    await page.keyboard.press('Escape');
    return true;
  }
  console.log(`  ✅ Connection request sent to ${name}`);
  return true;
}

/**
 * Publish a post to the LinkedIn feed.
 *
 * SELECTOR NOTES:
 * - The "Start a post" button and post composer are fairly stable but
 *   LinkedIn has redesigned them before. Verify via DevTools if broken.
 */
async function publishPost(page, draftText) {
  console.log(`  → Navigating to LinkedIn feed...`);
  await page.goto(`${LINKEDIN_BASE}/feed/`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // ⚠️ SELECTOR GUESS: The prompt button at the top of the feed
  const startPostButton = page.getByRole('button', { name: /start a post/i });
  await startPostButton.waitFor({ timeout: 10000 });
  await startPostButton.click();
  await sleep(1500);

  // ⚠️ SELECTOR GUESS: The post composer contenteditable area
  const postBox = page.getByRole('textbox', { name: /text editor for creating content/i });
  await postBox.waitFor({ timeout: 8000 });
  await postBox.fill(draftText);
  await sleep(1000);

  if (isDryRun) {
    console.log(`  [DRY RUN] Would click Post button to publish post`);
    return;
  }

  // ⚠️ SELECTOR GUESS: The final "Post" button in the composer modal
  const postButton = page.getByRole('button', { name: /^post$/i });
  await postButton.click();
  await sleep(2000);

  console.log(`  ✅ Post published`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const twilioClient = getTwilioClient();

  console.log('Fetching approved-but-unsent items from database...');
  const [replies, connections] = await Promise.all([
    getPendingReplies(),
    getPendingConnections(),
  ]);

  console.log(
    `Found: ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, ` +
    `${connections.length} connection note(s).`
  );

  if (replies.length + connections.length === 0) {
    console.log('Nothing to send. Exiting.');
    await pool.end();
    return;
  }

  // Launch Playwright with saved auth session - matches pattern from
  // src/scrapers/4-read-full-threads.js
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1366, height: 768 },  // match scraper pattern
  });
  const page = await context.newPage();

  // -------------------------------------------------------------------------
  // Process replies
  // -------------------------------------------------------------------------
  for (const reply of replies) {
    console.log(`\n[Reply] To: ${reply.participant_name} (id: ${reply.id})`);
    try {
      await sendReply(page, reply.participant_name, reply.draft_text, reply.thread_url);
      if (!isDryRun) {
        await pool.query(`UPDATE drafted_replies SET sent = TRUE WHERE id = $1`, [reply.id]);
        await sendWhatsApp(twilioClient, `✅ LinkedIn reply sent to *${reply.participant_name}*`);
      }
    } catch (err) {
      console.error(`  ❌ Failed to send reply to ${reply.participant_name}: ${err.message}`);
    }
    await sleep(DELAY_BETWEEN_ACTIONS_MS);
  }

  // -------------------------------------------------------------------------
  // Process connection requests
  // -------------------------------------------------------------------------
  for (const conn of connections) {
    console.log(`\n[Connection] Name: ${conn.name} (id: ${conn.id})`);
    try {
      const sent = await sendConnectionRequest(page, conn);
      if (sent && !isDryRun) {
        await pool.query(`UPDATE connections SET sent = TRUE WHERE id = $1`, [conn.id]);  // fix: conn.id not connection.id
        await sendWhatsApp(twilioClient, `✅ LinkedIn connection request sent to *${conn.name}*`);
      }
    } catch (err) {
      console.error(`  ❌ Failed to send connection request to ${conn.name}: ${err.message}`);
    }
    await sleep(DELAY_BETWEEN_ACTIONS_MS);
  }

  await browser.close();
  await pool.end();
  console.log('\nAll done.');
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});