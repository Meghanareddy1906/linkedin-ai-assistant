/**
 * Content/Posting Agent
 *
 * What this does:
 * - Drafts a LinkedIn post using Gemini, in one of two modes:
 *   1. No topic given: draws from your actual profile data (recent
 *      experience, projects) to suggest a post about your own work
 *   2. Topic given as a command-line argument: drafts a post about that
 *      specific topic instead
 * - Saves the draft to data/post-drafts.json (appends, keeps history)
 *
 * This does NOT publish anything to LinkedIn. It only drafts a post for
 * you to review, edit, and post yourself, per our approach of keeping
 * all outward actions human-executed - this is especially important
 * for posts, since they're public and permanent once published.
 *
 * Usage:
 *   node src/agents/12-content-agent.js
 *     -> drafts a post based on your profile/recent work
 *
 *   node src/agents/12-content-agent.js "excited about my new AI project"
 *     -> drafts a post about that specific topic instead
 */

require('dotenv').config();
const fs = require('fs');
const pool = require('../db/db');
const twilio = require('twilio');

const PROFILE_FILE = 'data/profile-data.json';
const OUTPUT_FILE = 'data/post-drafts.json';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

function buildPrompt(profile, customTopic) {
  const experienceText = (profile.experience || [])
    .map((e) => `${e.title} at ${e.companyAndType}`)
    .join('; ') || 'None listed';

  const basePersona = `You are drafting a LinkedIn post for this person:
Name: ${profile.name || 'N/A'}
Headline: ${profile.headline || 'N/A'}
Recent experience: ${experienceText}`;

  if (customTopic) {
    return `${basePersona}

Draft a LinkedIn post about: "${customTopic}"

Guidelines:
- Professional but personal tone - not corporate or robotic
- 3-5 short paragraphs, easy to skim
- Include a natural hook in the first line to stop scrolling
- End with a light call-to-action or open question to encourage engagement (optional, only if it fits naturally)
- No excessive hashtags - at most 3, only if genuinely relevant
- Output ONLY the post text, nothing else`;
  }

  return `${basePersona}

Draft a LinkedIn post about their own recent work/experience above - pick
whichever project or role seems most interesting to highlight. The post
should feel authentic and specific, not generic ("excited to share...").

Guidelines:
- Professional but personal tone - not corporate or robotic
- 3-5 short paragraphs, easy to skim
- Include a natural hook in the first line to stop scrolling
- Be specific about what was actually built/learned, not vague
- No excessive hashtags - at most 3, only if genuinely relevant
- Output ONLY the post text, nothing else`;
}

async function main() {
  if (!API_KEY) {
    console.error('No GEMINI_API_KEY found in .env');
    process.exit(1);
  }

  if (!fs.existsSync(PROFILE_FILE)) {
    console.error(`No ${PROFILE_FILE} found. Run src/scrapers/6-read-profile.js first.`);
    process.exit(1);
  }

  const profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
  const customTopic = process.argv[2] || null;

  console.log(
    customTopic
      ? `Drafting a post about: "${customTopic}"...`
      : `Drafting a post based on your profile/recent work...`
  );

  const prompt = buildPrompt(profile, customTopic);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 500 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const draft =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    '(No draft generated - check response structure)';

  console.log('\n--- Drafted post ---\n');
  console.log(draft);
  console.log('\n---------------------\n');

  // Append to a running history of post drafts rather than overwriting
  let history = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    history = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
  }
  history.push({
    topic: customTopic || '(based on profile)',
    draft,
    createdAt: new Date().toISOString(),
  });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(history, null, 2));
  console.log(`Saved to ${OUTPUT_FILE} (${history.length} draft(s) total)`);

  // Generate short topic using Gemini
  const topicResponse = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `Give a 3-5 word topic/title for this LinkedIn post. Only reply with the topic, nothing else.\n\n${draft}` }]
      }]
    })
  });
  const topicData = await topicResponse.json();
  const topic = topicData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '(based on profile)';

  const insertResult = await pool.query(
    'INSERT INTO post_drafts (topic, draft_text, approved, posted) VALUES ($1, $2, FALSE, FALSE) RETURNING id',
    [topic, draft]
  );
  const postId = insertResult.rows[0].id;
  console.log('Draft saved to post_drafts table.');

  // Send WhatsApp notification
  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilioClient.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: `whatsapp:${process.env.TWILIO_WHATSAPP_TO}`,
    body: `📝 *New LinkedIn Post Draft* (ID: ${postId})\nTopic: ${customTopic || '(based on profile)'}\n\n${draft}\n\nReply *approve ${customTopic || 'post'}* to approve or *skip ${customTopic || 'post'}* to reject.`
  });
  console.log('📱 Draft sent for approval on WhatsApp.');

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
