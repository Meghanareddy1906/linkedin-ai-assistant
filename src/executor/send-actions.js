/**
 * Reusable LinkedIn send actions
 * 
 * Each function handles the complete flow for sending one item:
 * - Launch browser with saved auth session
 * - Navigate and perform action
 * - Update database
 * - Close browser
 * - Return success/failure result
 */

require('dotenv').config();
const { chromium } = require('playwright');
const pool = require('../db/db');

const AUTH_FILE = 'data/auth.json';
const fs = require('fs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a reply by ID
 * @param {number} id - drafted_replies.id
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendReplyById(id) {
  let browser;
  try {
    // Check if auth file exists
    if (!fs.existsSync(AUTH_FILE)) {
      return { success: false, message: 'Authentication session not found. Please login first.' };
    }

    // Get reply data
    const result = await pool.query(`
      SELECT dr.id, dr.draft_text, c.participant_name, c.thread_url
      FROM drafted_replies dr
      JOIN conversations c ON c.id = dr.conversation_id
      WHERE dr.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Reply not found' };
    }

    const reply = result.rows[0];

    if (!reply.thread_url) {
      return { success: false, message: 'No conversation URL available' };
    }

    // Launch browser
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: { width: 1366, height: 768 }
    });
    const page = await context.newPage();

    // Navigate to conversation
    await page.goto(reply.thread_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Type message
    const messageBox = page.locator('.msg-form__contenteditable');
    await messageBox.waitFor({ timeout: 10000 });
    await messageBox.click();
    await messageBox.fill(reply.draft_text);
    await sleep(500);

    // Click send
    const sendButton = page.locator('button.msg-form__send-button');
    await sendButton.waitFor({ timeout: 8000 });
    await sendButton.click();
    await sleep(2000);

    // Update database
    await pool.query(`UPDATE drafted_replies SET sent = TRUE, sent_at = NOW() WHERE id = $1`, [id]);

    await browser.close();
    return { success: true, message: `Reply sent to ${reply.participant_name}` };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('Error sending reply:', error);
    return { success: false, message: error.message || 'Failed to send reply' };
  }
}

/**
 * Send a connection request by ID
 * @param {number} id - connections.id
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendConnectionById(id) {
  let browser;
  try {
    console.log(`\n========================================`);
    console.log(`[sendConnectionById] Starting for ID: ${id}`);
    console.log(`========================================\n`);
    
    const result = await pool.query(`
      SELECT id, name, draft_note, profile_url, send_note
      FROM connections
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Connection not found', error: 'NOT_FOUND' };
    }

    const conn = result.rows[0];
    console.log(`Name: ${conn.name}`);
    console.log(`Profile URL: ${conn.profile_url}`);
    console.log(`Send note: ${conn.send_note}`);

    if (!conn.profile_url) {
      return { 
        success: false, 
        message: `No profile URL for ${conn.name}`, 
        error: 'NO_URL' 
      };
    }

    console.log('\n[1] Launching browser...');
    browser = await chromium.launch({ 
      headless: false,
      slowMo: 500 // Increased from 300 to give page more time to render
    });
    
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: { width: 1366, height: 768 }
    });
    
    const page = await context.newPage();

    console.log(`[2] Navigating to profile...`);
    await page.goto(conn.profile_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000); // Let the page render after DOM is loaded

    console.log('[3] Looking for Connect button...');
    
    // Use the working selector from your inspection
    let connectButton = page.locator('a[aria-label*="Invite"][aria-label*="connect"]').first();
    let buttonFound = await connectButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (!buttonFound) {
      console.log('  Trying alternative Connect selector...');
      connectButton = page.locator('a:has(svg#connect-small)').first();
      buttonFound = await connectButton.isVisible({ timeout: 2000 }).catch(() => false);
    }

    if (!buttonFound) {
      console.log('  Checking More menu...');
      const moreButton = page.locator('button[aria-label="More"]').first();
      const moreVisible = await moreButton.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (moreVisible) {
        await moreButton.evaluate(btn => btn.click());
        await sleep(2000);
        
        connectButton = page.locator('div[role="menu"] *').filter({ hasText: /^Connect$/i }).first();
        buttonFound = await connectButton.isVisible({ timeout: 3000 }).catch(() => false);
      }
    }
    
    if (!buttonFound) {
      console.log('  ❌ Connect button not found!');
      await browser.close();
      return { 
        success: false, 
        message: `Cannot find Connect button for ${conn.name}`, 
        error: 'NO_CONNECT_BUTTON' 
      };
    }

    console.log('[4] Clicking Connect button...');
    await connectButton.evaluate(el => el.click());
    await sleep(4000); // Increased wait for modal to appear and fully render

    console.log('[5] Waiting for modal to fully load...');
    
    // Wait for the modal dialog to appear
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {
      console.log('  ⚠️  Modal dialog not detected');
    });
    
    await sleep(2000); // Additional wait for modal content to render

    console.log('[6] Handling connection modal...');

    const shouldSendNote = conn.send_note === true && conn.draft_note && conn.draft_note.trim().length > 0;
    
    if (shouldSendNote) {
      console.log('  Attempting to add note...');
      
      const addNoteButton = page.locator('button[aria-label="Add a note"]').first();
      const addNoteVisible = await addNoteButton.isVisible({ timeout: 3000 }).catch(() => false);
      
      if (addNoteVisible) {
        await addNoteButton.click();
        await sleep(2000);
        
        const premiumPopup = page.locator('text=Send unlimited personalized invites with Premium').first();
        const isPremiumPopup = await premiumPopup.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (isPremiumPopup) {
          console.log('  ⚠️  Premium required, sending without note...');
          const closeButton = page.locator('button[aria-label="Dismiss"]').first();
          await closeButton.click().catch(() => {});
          await sleep(1000);
        } else {
          const noteTextarea = page.locator('textarea[name="message"]').first();
          const textareaVisible = await noteTextarea.isVisible({ timeout: 3000 }).catch(() => false);
          
          if (textareaVisible) {
            const noteText = conn.draft_note.slice(0, 300);
            await noteTextarea.fill(noteText);
            await sleep(1000);
            
            const sendButton = page.locator('button[aria-label*="Send"]').filter({ hasText: 'Send' }).first();
            await sendButton.evaluate(btn => btn.click());
            await sleep(3000);
            
            await pool.query(`UPDATE connections SET sent = TRUE, sent_at = NOW() WHERE id = $1`, [id]);
            await browser.close();
            return { success: true, message: `Connection request with note sent to ${conn.name}` };
          }
        }
      }
    }

    // Send without note
    console.log('  Looking for "Send without a note" button...');
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'modal-state.png' });
    
    // Get all text content in the modal
    const modalText = await page.locator('[role="dialog"]').textContent().catch(() => '');
    console.log('  Modal contains:', modalText.substring(0, 200));
    
    // Try multiple selectors
    let sendButton = null;
    
    // Try 1: Direct aria-label
    sendButton = page.locator('button[aria-label="Send without a note"]');
    let found = await sendButton.count() > 0;
    
    if (!found) {
      // Try 2: Class-based selector
      console.log('  Trying class-based selector...');
      sendButton = page.locator('button.artdeco-button--2.artdeco-button--primary');
      const count = await sendButton.count();
      console.log(`  Found ${count} primary buttons`);
      
      if (count > 0) {
        // Get the last primary button (usually "Send without a note")
        sendButton = sendButton.last();
        found = true;
      }
    }
    
    if (!found) {
      // Try 3: Get all buttons and find by text
      console.log('  Trying text content search...');
      const allButtons = await page.locator('button').all();
      
      for (const btn of allButtons) {
        const text = await btn.textContent();
        if (text && text.toLowerCase().includes('send without')) {
          sendButton = btn;
          found = true;
          console.log('  ✓ Found by text content!');
          break;
        }
      }
    }
    
    if (!found) {
      console.log('  ❌ Could not find send button');
      await page.screenshot({ path: 'modal-error.png' });
      await browser.close();
      return {
        success: false,
        message: `Could not find send button for ${conn.name}`,
        error: 'NO_SEND_BUTTON'
      };
    }

    console.log('  ✓ Clicking send button...');
    await sendButton.evaluate(btn => btn.click());
    await sleep(3000);

    await pool.query(`UPDATE connections SET sent = TRUE, sent_at = NOW() WHERE id = $1`, [id]);
    console.log(`\n✓ Connection request sent and marked in database`);

    await browser.close();
    
    console.log(`\n========================================`);
    console.log(`✓ COMPLETED: ${conn.name}`);
    console.log(`========================================\n`);
    
    return { success: true, message: `Connection request sent to ${conn.name}` };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('\n❌ ERROR:', error);
    
    return { 
      success: false, 
      message: `Failed: ${error.message}`, 
      error: error.message 
    };
  }
}

/**
 * Send a post by ID
 * @param {number} id - post_drafts.id
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendPostById(id) {
  let browser;
  try {
    // Check if auth file exists
    if (!fs.existsSync(AUTH_FILE)) {
      return { success: false, message: 'Authentication session not found. Please login first.' };
    }

    // Get post data
    const result = await pool.query(`
      SELECT id, topic, draft_text
      FROM post_drafts
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return { success: false, message: 'Post not found' };
    }

    const post = result.rows[0];

    // Launch browser
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: { width: 1366, height: 768 }
    });
    const page = await context.newPage();

    // Navigate to LinkedIn feed
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Click "Start a post" box
    const startPost = page.locator('[aria-label="Start a post"]').first();
    await startPost.waitFor({ timeout: 10000 });
    await startPost.click();
    await sleep(2000);

    // Type in editor
    const editor = page.locator('div.ql-editor[aria-placeholder="What do you want to talk about?"]').first();
    await editor.waitFor({ timeout: 10000 });
    await editor.click();
    await editor.fill(post.draft_text);
    await sleep(1000);

    // Click Post button
    const postButton = page.getByRole('button', { name: /^post$/i });
    await postButton.waitFor({ timeout: 8000 });
    await postButton.click();
    await sleep(3000);

    // Update database
    await pool.query(`UPDATE post_drafts SET posted = TRUE, sent_at = NOW() WHERE id = $1`, [id]);

    await browser.close();
    return { success: true, message: `Post published: ${post.topic}` };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('Error sending post:', error);
    return { success: false, message: error.message || 'Failed to publish post' };
  }
}

module.exports = {
  sendReplyById,
  sendConnectionById,
  sendPostById
};