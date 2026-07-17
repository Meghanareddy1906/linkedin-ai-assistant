/**
 * Draft replies using Gemini (free tier)
 *
 * What this does:
 * - Reads threads-data.json (captured by 4-read-full-threads.js)
 * - For each conversation thread, sends the message history to Gemini
 *   and asks it to draft a reply
 * - Saves all drafted replies to drafted-replies.json
 *
 * This does NOT send anything to LinkedIn. It only generates draft text
 * for you to review and manually send yourself, per our approach of
 * keeping all outward actions human-executed.
 *
 * Run with: node 5-draft-replies.js
 */

require('dotenv').config();
const fs = require('fs');

const INPUT_FILE = 'data/threads-data.json';
const OUTPUT_FILE = 'data/drafted-replies.json';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite'; // free tier model
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

async function draftReply(participantName, messages) {
  // Build a readable transcript of the conversation for the prompt
  const transcript = messages
    .map((m) => `${m.sender || '(them)'}: ${m.text}`)
    .join('\n');

  const prompt = `You are helping draft a LinkedIn reply. Below is a message thread with ${participantName}.

Conversation so far:
${transcript}

Draft a short, natural, professional-but-friendly reply to the most recent message. Keep it concise (2-4 sentences), match the tone of the conversation, and do not use overly formal or robotic language. Only output the reply text itself, nothing else.`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Extract the generated text from Gemini's response structure
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

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`No ${INPUT_FILE} found. Run 4-read-full-threads.js first.`);
    process.exit(1);
  }

  const threads = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`Loaded ${threads.length} thread(s) from ${INPUT_FILE}`);

  const drafts = [];

  for (const thread of threads) {
    if (!thread.messages || thread.messages.length === 0) {
      console.log(`Skipping ${thread.participant} - no messages captured.`);
      continue;
    }

    console.log(`\nDrafting reply for ${thread.participant}...`);

    try {
      const draft = await draftReply(thread.participant, thread.messages);
      console.log(`  -> "${draft.substring(0, 80)}${draft.length > 80 ? '...' : ''}"`);

      drafts.push({
        participant: thread.participant,
        lastMessage: thread.messages[thread.messages.length - 1].text,
        draftedReply: draft,
      });
    } catch (err) {
      console.error(`  Error drafting reply for ${thread.participant}:`, err.message);
    }

    // Small pause between API calls to stay well within free tier rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(drafts, null, 2));
  console.log(`\nSaved ${drafts.length} drafted repl${drafts.length === 1 ? 'y' : 'ies'} to ${OUTPUT_FILE}`);
  console.log('\nReview these drafts, then send anything you approve manually in LinkedIn.');
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
