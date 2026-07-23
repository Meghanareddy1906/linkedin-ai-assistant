/**
 * WhatsApp Approval Digest
 *
 * What this does:
 * - Reads pending AI-drafted content from the database:
 *   - Newly drafted replies (from drafted_replies table)
 *   - Newly drafted connection notes (from connections table)
 * - Sends a summary digest to your WhatsApp via Twilio
 * - You review the digest and manually go send/approve anything you
 *   like directly in the actual LinkedIn app
 *
 * This does NOT send anything to LinkedIn - it only notifies you (via
 * WhatsApp) about drafts that are ready for your review, per our
 * approach of keeping all outward actions human-executed.
 *
 * Run with: node src/notify/send-whatsapp-digest.js
 */

require('dotenv').config();
const twilio = require('twilio');
const pool = require('../db/db');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  TWILIO_WHATSAPP_TO,
} = process.env;

function checkEnvVars() {
  const missing = [];
  if (!TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
  if (!TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN');
  if (!TWILIO_WHATSAPP_FROM) missing.push('TWILIO_WHATSAPP_FROM');
  if (!TWILIO_WHATSAPP_TO) missing.push('TWILIO_WHATSAPP_TO');

  if (missing.length > 0) {
    console.error('Missing required .env variables:', missing.join(', '));
    process.exit(1);
  }
}

async function getPendingReplies() {
  // Get the most recent draft per conversation, along with participant name
  const result = await pool.query(`
    SELECT DISTINCT ON (c.id)
      c.participant_name,
      dr.draft_text,
      dr.created_at
    FROM drafted_replies dr
    JOIN conversations c ON c.id = dr.conversation_id
    ORDER BY c.id, dr.created_at DESC
  `);
  return result.rows;
}

async function getPendingConnectionNotes() {
  const result = await pool.query(`
    SELECT name, headline, draft_note, drafted_at
    FROM connections
    WHERE draft_note IS NOT NULL
    ORDER BY drafted_at DESC
  `);
  return result.rows;
}

function buildDigestMessage(replies, notes) {
  let message = `*LinkedIn Assistant - Pending Review*\n\n`;

  if (replies.length === 0 && notes.length === 0) {
    message += `Nothing new to review right now.`;
    return message;
  }

  if (replies.length > 0) {
    message += `*💬 Drafted Replies (${replies.length})*\n`;
    replies.slice(0, 5).forEach((r, i) => {
      const preview = r.draft_text.length > 100
        ? r.draft_text.substring(0, 100) + '...'
        : r.draft_text;
      message += `${i + 1}. *${r.participant_name}*\n   "${preview}"\n`;
    });
    if (replies.length > 5) {
      message += `   ...and ${replies.length - 5} more\n`;
    }
    message += `\n`;
  }

  if (notes.length > 0) {
    message += `*🤝 Connection Notes (${notes.length})*\n`;
    notes.slice(0, 5).forEach((n, i) => {
      const preview = n.draft_note.length > 100
        ? n.draft_note.substring(0, 100) + '...'
        : n.draft_note;
      message += `${i + 1}. *${n.name}*\n   "${preview}"\n`;
    });
    if (notes.length > 5) {
      message += `   ...and ${notes.length - 5} more\n`;
    }
    message += `\n`;
  }

  message += `Review the full drafts in your project's data folder, then send anything you approve manually in LinkedIn.`;

  return message;
}

async function main() {
  checkEnvVars();

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  console.log('Fetching pending drafts from database...');
  const replies = await getPendingReplies();
  const notes = await getPendingConnectionNotes();

  console.log(`Found ${replies.length} drafted repl${replies.length === 1 ? 'y' : 'ies'} and ${notes.length} connection note(s).`);

  const message = buildDigestMessage(replies, notes);

  console.log('\n--- Message preview ---');
  console.log(message);
  console.log('------------------------\n');

  console.log('Sending to WhatsApp...');

  try {
    const result = await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: TWILIO_WHATSAPP_TO,
      body: message,
    });
    console.log(`✅ Sent! Message SID: ${result.sid}`);
    console.log('Check your WhatsApp.');
  } catch (err) {
    console.error('❌ Failed to send:', err.message);
    if (err.message.includes('not currently opted in')) {
      console.error('\nYour sandbox session may have expired (24hr timeout).');
      console.error('Re-send the join code from your phone to reconnect.');
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
