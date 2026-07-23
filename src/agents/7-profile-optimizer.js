/**
 * Profile Optimization Agent
 *
 * What this does:
 * - Reads data/profile-data.json (captured by src/scrapers/6-read-profile.js)
 * - Sends it to Gemini, asking for a structured audit: gaps, weak
 *   phrasing, missing keywords, and concrete suggested improvements
 * - Saves the suggestions to data/profile-suggestions.json
 *
 * This does NOT edit your LinkedIn profile. It only generates suggestions
 * for you to review and apply yourself, per our approach of keeping all
 * outward changes human-executed.
 *
 * Run with: node src/agents/7-profile-optimizer.js
 */

require('dotenv').config();
const fs = require('fs');

const INPUT_FILE = 'data/profile-data.json';
const OUTPUT_FILE = 'data/profile-suggestions.json';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

function buildPrompt(profile) {
  const experienceText = (profile.experience || [])
    .map((e) => `- ${e.title || 'N/A'} at ${e.companyAndType || 'N/A'} (${e.duration || 'N/A'})`)
    .join('\n') || 'None listed';

  const educationText = (profile.education || [])
    .map((e) => `- ${e.school || 'N/A'}: ${e.degreeAndField || 'N/A'} (${e.dates || 'N/A'})`)
    .join('\n') || 'None listed';

  const skillsText = (profile.skills || []).join(', ') || 'None listed';

  return `You are a LinkedIn profile optimization expert. Review this profile and provide a structured audit.

PROFILE DATA:
Name: ${profile.name || 'N/A'}
Headline: ${profile.headline || '(not set)'}
Location: ${profile.location || 'N/A'}
About section: ${profile.about || '(not set)'}

Experience:
${experienceText}

Education:
${educationText}

Skills: ${skillsText}

Provide your audit in exactly this format, with clear section headers:

HEADLINE FEEDBACK:
(1-2 sentences on strengths/weaknesses, then a concrete suggested rewrite if improvement is possible)

ABOUT SECTION FEEDBACK:
(1-2 sentences of feedback; if missing, note this is a gap and suggest what it should cover)

MISSING KEYWORDS:
(List 3-5 specific keywords/skills this profile should include based on the experience/education shown, that aren't currently in the skills list)

GAPS TO ADDRESS:
(List any missing sections or weak spots - e.g. no headline, no About, thin experience descriptions)

TOP 3 ACTIONABLE NEXT STEPS:
(Exactly 3 numbered steps, each ONE sentence only, no sub-bullets, no repeated phrasing)

Be specific and concrete, not generic. Base suggestions on the actual content provided, not boilerplate advice. Keep each section concise - do not repeat the same sentence or phrase multiple times.`;
}

async function main() {
  if (!API_KEY) {
    console.error('No GEMINI_API_KEY found. Make sure your .env file has:');
    console.error('GEMINI_API_KEY=your_key_here');
    process.exit(1);
  }

  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`No ${INPUT_FILE} found. Run src/scrapers/6-read-profile.js first.`);
    process.exit(1);
  }

  const profile = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`Loaded profile data for ${profile.name || 'unknown'}.`);
  console.log('Sending to Gemini for analysis...\n');

  const prompt = buildPrompt(profile);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4, // lower temperature reduces repetition loop risk
        maxOutputTokens: 1024, // caps runaway output if a loop still occurs
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const suggestions =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    '(No suggestions generated - check response structure)';

  console.log(suggestions);

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        profileName: profile.name,
        suggestions: suggestions,
      },
      null,
      2
    )
  );

  console.log(`\nSaved to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
