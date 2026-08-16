/**
 * Auto-Send Executor
 *
 * Processes approved-but-unsent items from the database
 * Can be run as a standalone script for offline/WhatsApp automation
 */

require('dotenv').config();
const twilio = require('twilio');
const pool = require('../db/db');
const { sendReplyById, sendConnectionById, sendPostById } = require('./send-actions');

const DELAY_BETWEEN_ACTIONS_MS = 4000;

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  TWILIO_WHATSAPP_TO,
} = process.env;

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

async function getPendingReplies() {
  const result = await pool.query(`
    SELECT dr.id, c.participant_name
    FROM drafted_replies dr
    JOIN conversations c ON c.id = dr.conversation_id
    WHERE dr.approved = TRUE AND dr.sent = FALSE
    ORDER BY dr.created_at ASC
  `);
  return result.rows;
}

async function getPendingConnections() {
  const result = await pool.query(`
    SELECT id, name
    FROM connections
    WHERE approved = TRUE AND sent = FALSE
    ORDER BY drafted_at ASC
  `);
  return result.rows;
}

async function getPendingPosts() {
  const result = await pool.query(`
    SELECT id, topic
    FROM post_drafts
    WHERE approved = TRUE AND posted = FALSE
    ORDER BY created_at ASC
  `);
  return result.rows;
}

async function main() {
  const twilioClient = getTwilioClient();

  console.log('Fetching approved-but-unsent items from database...');
  const [replies, connections, posts] = await Promise.all([
    getPendingReplies(),
    getPendingConnections(),
    getPendingPosts(),
  ]);

  console.log(
    `Found: ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, ` +
    `${connections.length} connection(s), ` +
    `${posts.length} post(s).`
  );

  if (replies.length + connections.length + posts.length === 0) {
    console.log('Nothing to send. Exiting.');
    await pool.end();
    return;
  }

  // Process replies
  for (const reply of replies) {
    console.log(`\n[Reply] To: ${reply.participant_name} (id: ${reply.id})`);
    try {
      const result = await sendReplyById(reply.id);
      if (result.success) {
        console.log(`  ✅ ${result.message}`);
        await sendWhatsApp(twilioClient, `✅ ${result.message}`);
      } else {
        console.error(`  ❌ ${result.message}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
    await sleep(DELAY_BETWEEN_ACTIONS_MS);
  }

  // Process connections
  for (const conn of connections) {
    console.log(`\n[Connection] Name: ${conn.name} (id: ${conn.id})`);
    try {
      const result = await sendConnectionById(conn.id);
      if (result.success) {
        console.log(`  ✅ ${result.message}`);
        await sendWhatsApp(twilioClient, `✅ ${result.message}`);
      } else {
        console.error(`  ❌ ${result.message}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
    await sleep(DELAY_BETWEEN_ACTIONS_MS);
  }

  // Process posts
  for (const post of posts) {
    console.log(`\n[Post] Topic: ${post.topic} (id: ${post.id})`);
    try {
      const result = await sendPostById(post.id);
      if (result.success) {
        console.log(`  ✅ ${result.message}`);
        await sendWhatsApp(twilioClient, `✅ ${result.message}`);
      } else {
        console.error(`  ❌ ${result.message}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
    await sleep(DELAY_BETWEEN_ACTIONS_MS);
  }

  await pool.end();
  console.log('\nAll done.');
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});