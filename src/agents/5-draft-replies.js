/**
 * STEP 5: Draft replies using Gemini (free tier)
 *
 * What this does:
 * - Reads conversations and messages from the database (populated by
 *   src/scrapers/4-read-full-threads.js)
 * - For each conversation, checks whether an up-to-date draft already
 *   exists (i.e. no new messages since the last draft was generated).
 *   If so, SKIPS it - saves both API calls and time.
 * - For conversations with new messages, sends the full history to
 *   Gemini and drafts a reply
 * - Saves each new draft to the drafted_replies table, and also writes
 *   a JSON snapshot to drafted-replies.json for easy inspection
 *
 * This does NOT send anything to LinkedIn. It only generates draft text
 * for you to review and manually send yourself, per our approach of
 * keeping all outward actions human-executed.
 *
 * Run with: node src/agents/5-draft-replies.js
 */

require('dotenv').config();
const fs = require('fs');
const pool = require('../db/db');

const OUTPUT_FILE = 'data/drafted-replies.json';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite'; // free tier model
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

async function draftReply(participantName, messages) {
  const transcript = messages
    .map((m) => `${m.sender || '(them)'}: ${m.message_text}`)
    .join('\n');

  const prompt = `You are helping draft a LinkedIn reply. Below is a message thread with ${participantName}.

Conversation so far:
${transcript}

Draft a short, natural, professional-but-friendly reply to the most recent message. Keep it concise (2-4 sentences), match the tone of the conversation, and do not use overly formal or robotic language. Only output the reply text itself, nothing else.`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const draftText =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    '(No draft generated - check response structure)';

  return draftText;
}

async function main() {
  if (!API_KEY) {
    console.error('No GEMINI_API_KEY found. Make sure your .env file has:');
    console.error('GEMINI_API_KEY=your_key_here');
    process.exit(1);
  }

  // Get every conversation we've scraped, along with its current
  // message count
  const conversations = await pool.query(
    'SELECT id, participant_name, message_count FROM conversations ORDER BY id'
  );
  console.log(`Found ${conversations.rows.length} conversation(s) in the database.`);

  const drafts = [];
  let skippedCount = 0;

  for (const conv of conversations.rows) {
    if (conv.message_count === 0) {
      console.log(`Skipping ${conv.participant_name} - no messages stored.`);
      continue;
    }

    // Check if we already have a draft based on the current message count
    // - if so, nothing new has come in since we last drafted, so skip
    const existingDraft = await pool.query(
      `SELECT draft_text, based_on_message_count FROM drafted_replies
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [conv.id]
    );

    if (
      existingDraft.rows.length > 0 &&
      existingDraft.rows[0].based_on_message_count === conv.message_count
    ) {
      console.log(
        `Skipping ${conv.participant_name} - already have an up-to-date draft ` +
        `(no new messages since last draft).`
      );
      skippedCount++;
      drafts.push({
        participant: conv.participant_name,
        draftedReply: existingDraft.rows[0].draft_text,
        status: 'reused (no new messages)',
      });
      continue;
    }

    // Fetch the actual messages for this conversation to build the prompt
    const messagesResult = await pool.query(
      `SELECT sender, message_text FROM messages
       WHERE conversation_id = $1 ORDER BY id ASC`,
      [conv.id]
    );

    console.log(`\nDrafting reply for ${conv.participant_name}...`);

    try {
      const draft = await draftReply(conv.participant_name, messagesResult.rows);
      console.log(`  -> "${draft.substring(0, 80)}${draft.length > 80 ? '...' : ''}"`);

      // Save the new draft to the database
      await pool.query(
        `INSERT INTO drafted_replies (conversation_id, draft_text, based_on_message_count)
         VALUES ($1, $2, $3)`,
        [conv.id, draft, conv.message_count]
      );

      drafts.push({
        participant: conv.participant_name,
        draftedReply: draft,
        status: 'newly generated',
      });
    } catch (err) {
      console.error(`  Error drafting reply for ${conv.participant_name}:`, err.message);
    }

    // Small pause between API calls to stay well within free tier rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(drafts, null, 2));
  console.log(`\nSaved ${drafts.length} draft(s) to ${OUTPUT_FILE}`);
  console.log(`(${skippedCount} conversation(s) skipped - already up to date)`);
  console.log('\nReview these drafts, then send anything you approve manually in LinkedIn.');

  await pool.end();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
