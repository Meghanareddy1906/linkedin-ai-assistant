/**
 * WhatsApp Approval Digest
 *
 * What this does:
 * - Reads pending AI-drafted content from the database:
 *   - Newly drafted replies (from drafted_replies table)
 *   - Newly drafted connection notes (from connections table)
 *   - Top-ranked job matches (from jobs table, score >= 70)
 * - Sends a summary digest to your WhatsApp via Twilio
 * - You review the digest and reply "approve <name/job>" to get the
 *   ready-to-use text or link sent back, then act on it yourself
 *   directly in LinkedIn
 *
 * This does NOT send anything to LinkedIn or submit any job
 * applications - it only notifies you about drafts/matches ready for
 * your review, per our approach of keeping all outward actions
 * human-executed.
 *
 * NOTE: Twilio's WhatsApp messages have a 1600 character hard limit, so
 * this version keeps items short (name/title only, no long previews)
 * and caps how many items show per category - full detail comes back
 * when you approve a specific item.
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

const JOB_MATCH_THRESHOLD = 70;
const MAX_ITEMS_PER_CATEGORY = 5;
const MAX_MESSAGE_LENGTH = 1500; // safety margin under Twilio's 1600 limit

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
  const result = await pool.query(`
    SELECT DISTINCT ON (c.id) c.participant_name, dr.created_at
    FROM drafted_replies dr
    JOIN conversations c ON c.id = dr.conversation_id
    WHERE dr.approved = FALSE
    ORDER BY c.id, dr.created_at DESC
  `);
  return result.rows;
}

async function getPendingConnectionNotes() {
  const result = await pool.query(`
    SELECT name FROM connections
    WHERE draft_note IS NOT NULL AND approved = FALSE
    ORDER BY drafted_at DESC
  `);
  return result.rows;
}

async function getTopJobMatches() {
  const result = await pool.query(
    `SELECT title, company, match_score FROM jobs
     WHERE match_score >= $1 AND approved = FALSE
     ORDER BY match_score DESC LIMIT $2`,
    [JOB_MATCH_THRESHOLD, MAX_ITEMS_PER_CATEGORY]
  );
  return result.rows;
}

function buildDigestMessage(replies, notes, jobs) {
  const repliesShown = replies.slice(0, MAX_ITEMS_PER_CATEGORY);
  const notesShown = notes.slice(0, MAX_ITEMS_PER_CATEGORY);
  const jobsShown = jobs.slice(0, MAX_ITEMS_PER_CATEGORY);

  let message = `*LinkedIn Assistant - Pending Review*\n\n`;

  if (repliesShown.length === 0 && notesShown.length === 0 && jobsShown.length === 0) {
    return message + `Nothing new to review right now.`;
  }

  if (repliesShown.length > 0) {
    message += `*💬 Replies (${replies.length})*\n`;
    repliesShown.forEach((r, i) => {
      message += `${i + 1}. ${r.participant_name}\n`;
    });
    if (replies.length > repliesShown.length) {
      message += `...+${replies.length - repliesShown.length} more\n`;
    }
    message += `\n`;
  }

  if (notesShown.length > 0) {
    message += `*🤝 Connections (${notes.length})*\n`;
    notesShown.forEach((n, i) => {
      message += `${i + 1}. ${n.name}\n`;
    });
    if (notes.length > notesShown.length) {
      message += `...+${notes.length - notesShown.length} more\n`;
    }
    message += `\n`;
  }

  if (jobsShown.length > 0) {
    message += `*💼 Job Matches (${jobs.length})*\n`;
    jobsShown.forEach((j, i) => {
      message += `${i + 1}. ${j.title} @ ${j.company} (${j.match_score}/100)\n`;
    });
    message += `\n`;
  }

  message += `Reply "approve <name>" for full details, or "skip <name>" to dismiss.`;

  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_MESSAGE_LENGTH - 20) + '\n...(truncated)';
  }

  return message;
}

async function main() {
  checkEnvVars();
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  console.log('Fetching pending items from database...');
  const replies = await getPendingReplies();
  const notes = await getPendingConnectionNotes();
  const jobs = await getTopJobMatches();

  console.log(
    `Found ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, ` +
    `${notes.length} connection note(s), and ${jobs.length} job match(es).`
  );

  const message = buildDigestMessage(replies, notes, jobs);
  console.log(`\nMessage length: ${message.length} characters (limit: 1600)`);
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
