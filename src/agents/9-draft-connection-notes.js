/**
 * Networking Agent
 *
 * What this does:
 * - Reads data/suggested-connections.json (captured by
 *   src/scrapers/8-read-suggested-connections.js)
 * - Reads your own profile data (data/profile-data.json) for context
 * - For each suggested connection NOT already processed (checked via the
 *   database), drafts a short, personalized connection note using Gemini
 * - Saves drafts to the "connections" table, and a JSON snapshot to
 *   data/connection-notes.json
 *
 * This does NOT send any connection requests. It only drafts notes for
 * you to review and send manually yourself, per our approach of keeping
 * all outward actions human-executed.
 *
 * Run with: node src/agents/9-draft-connection-notes.js
 */

require('dotenv').config();
const fs = require('fs');
const pool = require('../db/db');
const twilio = require('twilio');

const SUGGESTIONS_FILE = 'data/suggested-connections.json';
const PROFILE_FILE = 'data/profile-data.json';
const OUTPUT_FILE = 'data/connection-notes.json';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

async function draftNote(myProfile, candidate) {
  const prompt = `You are drafting a LinkedIn connection request note.

MY PROFILE:
Name: ${myProfile.name || 'N/A'}
Headline: ${myProfile.headline || 'N/A'}

PERSON I WANT TO CONNECT WITH:
Name: ${candidate.name}
Headline: ${candidate.headline || 'N/A'}

Write a short, genuine-sounding connection note (LinkedIn's limit is 300 characters, aim for under 200). It should mention something specific that makes this connection relevant - shared field, complementary skills, or mutual interest based on the headlines above. Do NOT be generic ("I'd like to add you to my network"). Do NOT use excessive flattery. Output ONLY the note text, nothing else.`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 150,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const note =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    '(No note generated - check response structure)';

  return note;
}

async function sendWhatsApp(message) {
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${process.env.TWILIO_WHATSAPP_TO}`,
      body: message,
    });
  } catch (err) {
    console.warn(`  ⚠️  WhatsApp send failed: ${err.message}`);
  }
}

async function main() {
  if (!API_KEY) {
    console.error('No GEMINI_API_KEY found in .env');
    process.exit(1);
  }

  if (!fs.existsSync(SUGGESTIONS_FILE)) {
    console.error(
      `No ${SUGGESTIONS_FILE} found. Run src/scrapers/8-read-suggested-connections.js first.`
    );
    process.exit(1);
  }

  if (!fs.existsSync(PROFILE_FILE)) {
    console.error(`No ${PROFILE_FILE} found. Run src/scrapers/6-read-profile.js first.`);
    process.exit(1);
  }

  const suggestions = JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf-8'));
  const myProfile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));

  console.log(`Loaded ${suggestions.length} suggested connection(s).`);

  const results = [];
  let skippedCount = 0;

  for (const candidate of suggestions) {
    // Check if we've already drafted a note for this person, keyed by
    // name (profile URL isn't reliably available from this scraper)
    const existing = await pool.query(
      'SELECT draft_note FROM connections WHERE name = $1',
      [candidate.name]
    );

    if (existing.rows.length > 0 && existing.rows[0].draft_note) {
      console.log(`Skipping ${candidate.name} - already drafted a note previously.`);
      skippedCount++;
      results.push({ name: candidate.name, note: existing.rows[0].draft_note, status: 'reused' });
      continue;
    }

    console.log(`\nDrafting note for ${candidate.name}...`);

    try {
      const note = await draftNote(myProfile, candidate);
      console.log(`  -> "${note}"`);

      await pool.query(
        `INSERT INTO connections (name, headline, profile_url, draft_note, drafted_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (name) DO UPDATE SET draft_note = $4, drafted_at = NOW()`,
        [candidate.name, candidate.headline, candidate.profileUrl, note]
      );

      // Send WhatsApp notification for approval
      const firstName = candidate.name.split(' ')[0].toLowerCase();
      await sendWhatsApp(
        `🤝 *New Connection Note* for ${candidate.name}:\n\n${note}\n\nReply *approve ${firstName}* to send or *skip ${firstName}* to reject.`
      );
      console.log(`  📱 WhatsApp notification sent for ${candidate.name}`);

      results.push({ name: candidate.name, note, status: 'newly generated' });
    } catch (err) {
      console.error(`  Error drafting note for ${candidate.name}:`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} note(s) to ${OUTPUT_FILE}`);
  console.log(`(${skippedCount} skipped - already drafted previously)`);
  console.log('\nReview these notes, then send connection requests manually in LinkedIn.');

  await pool.end();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
