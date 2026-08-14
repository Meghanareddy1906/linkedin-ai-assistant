require('dotenv').config();
const { chromium } = require('playwright');
const pool = require('../db/db');
const twilio = require('twilio');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const isDryRun = process.argv.includes('--dry-run');

async function getApprovedPosts() {
  const result = await pool.query(`
    SELECT id, topic, draft_text FROM post_drafts
    WHERE approved = TRUE AND posted = FALSE
    ORDER BY created_at ASC
  `);
  return result.rows;
}

async function markPosted(id) {
  await pool.query(`UPDATE post_drafts SET posted = TRUE WHERE id = $1`, [id]);
}

async function postToLinkedIn(page, content, isDryRun) {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click "Start a post" box
  const startPost = page.locator('[aria-label="Start a post"]').first();
  await startPost.click();
  await page.waitForTimeout(2000);

  // Type in editor
  const editor = page.locator('div.ql-editor[aria-placeholder="What do you want to talk about?"]').first();
  await editor.waitFor({ timeout: 10000 });
  await editor.click();
  await editor.fill(content);
  await page.waitForTimeout(1000);

  if (isDryRun) {
    console.log(`  [DRY RUN] Post drafted in LinkedIn UI - not clicking Post button.`);
    await page.waitForTimeout(5000); // keep open so you can see it
    await page.keyboard.press('Escape');
    return;
  }

  // Click Post button
  const postButton = page.getByRole('button', { name: /^post$/i });
  await postButton.click();
  await page.waitForTimeout(3000);
}

async function run() {
  const posts = await getApprovedPosts();

  if (posts.length === 0) {
    console.log('No approved posts to publish.');
    await pool.end();
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: 'data/auth.json',
    viewport: { width: 1366, height: 768 }
  });
  const page = await context.newPage();

  for (const post of posts) {
    console.log(`\n[Post] ID: ${post.id} | Topic: ${post.topic}`);
    try {
      await postToLinkedIn(page, post.draft_text, isDryRun);

      if (!isDryRun) {
        await markPosted(post.id);
        console.log(`  ✅ Posted to LinkedIn`);
        await twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_FROM,
          to: `whatsapp:${process.env.TWILIO_WHATSAPP_TO}`,
          body: `✅ LinkedIn post published!\n\nTopic: ${post.topic}`
        });
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
  }

  await browser.close();
  await pool.end();
  console.log('\nAll done.');
}

run();