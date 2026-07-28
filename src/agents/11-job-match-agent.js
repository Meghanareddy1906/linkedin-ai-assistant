/**
 * Job Search Agent
 *
 * What this does:
 * - Reads data/job-search-results.json (captured by
 *   src/scrapers/10-read-job-search.js)
 * - Reads your own profile data (data/profile-data.json) for context
 * - For each job NOT already analyzed (checked via the database), asks
 *   Gemini to score the match (0-100) and explain why, based on your
 *   actual skills/experience
 * - Saves results to the "jobs" table, and a JSON snapshot to
 *   data/job-matches.json, sorted by match score
 *
 * This does NOT apply to any jobs. It only ranks and explains matches
 * for you to review yourself, per our approach of keeping all outward
 * actions human-executed.
 *
 * Run with: node src/agents/11-job-match-agent.js
 */

require('dotenv').config();
const fs = require('fs');
const pool = require('../db/db');

const JOBS_FILE = 'data/job-search-results.json';
const PROFILE_FILE = 'data/profile-data.json';
const OUTPUT_FILE = 'data/job-matches.json';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

async function scoreJobMatch(myProfile, job) {
  const skillsText = (myProfile.skills || []).join(', ') || 'None listed';
  const experienceText = (myProfile.experience || [])
    .map((e) => `${e.title} at ${e.companyAndType}`)
    .join('; ') || 'None listed';

  const prompt = `You are evaluating how well a job matches a candidate's profile.

CANDIDATE PROFILE:
Headline: ${myProfile.headline || 'N/A'}
Skills: ${skillsText}
Experience: ${experienceText}
Education: ${(myProfile.education || []).map((e) => e.degreeAndField).join(', ') || 'N/A'}

JOB LISTING:
Title: ${job.title}
Company: ${job.company || 'N/A'}
Location: ${job.location || 'N/A'}

Respond in EXACTLY this format, nothing else:
SCORE: (a number from 0-100 representing match quality)
REASON: (one concise sentence explaining the score, based on actual overlap between the candidate's skills/experience and what this job title typically requires)`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 150 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);

  return {
    score: scoreMatch ? parseInt(scoreMatch[1]) : null,
    reason: reasonMatch ? reasonMatch[1].trim() : text,
  };
}

async function main() {
  if (!API_KEY) {
    console.error('No GEMINI_API_KEY found in .env');
    process.exit(1);
  }

  if (!fs.existsSync(JOBS_FILE)) {
    console.error(`No ${JOBS_FILE} found. Run src/scrapers/10-read-job-search.js first.`);
    process.exit(1);
  }

  if (!fs.existsSync(PROFILE_FILE)) {
    console.error(`No ${PROFILE_FILE} found. Run src/scrapers/6-read-profile.js first.`);
    process.exit(1);
  }

  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
  const myProfile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));

  console.log(`Loaded ${jobs.length} job listing(s).`);

  let skippedCount = 0;

  for (const job of jobs) {
    const existing = await pool.query(
      'SELECT match_score, match_reasoning FROM jobs WHERE title = $1 AND company = $2',
      [job.title, job.company]
    );

    if (existing.rows.length > 0 && existing.rows[0].match_score !== null) {
      console.log(`Skipping "${job.title}" at ${job.company} - already analyzed.`);
      skippedCount++;
      continue;
    }

    console.log(`\nAnalyzing "${job.title}" at ${job.company || 'unknown company'}...`);

    try {
      const { score, reason } = await scoreJobMatch(myProfile, job);
      console.log(`  -> Score: ${score}/100 - ${reason}`);

      await pool.query(
        `INSERT INTO jobs (title, company, location, job_url, match_score, match_reasoning, analyzed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (title, company) DO UPDATE
         SET match_score = $5, match_reasoning = $6, analyzed_at = NOW()`,
        [job.title, job.company, job.location, job.url, score, reason]
      );
    } catch (err) {
      console.error(`  Error analyzing "${job.title}":`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Pull all analyzed jobs, sorted by score, for the final output
  const allAnalyzed = await pool.query(
    `SELECT title, company, location, job_url, match_score, match_reasoning
     FROM jobs WHERE match_score IS NOT NULL
     ORDER BY match_score DESC`
  );

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allAnalyzed.rows, null, 2));
  console.log(`\nSaved ${allAnalyzed.rows.length} ranked job match(es) to ${OUTPUT_FILE}`);
  console.log(`(${skippedCount} skipped - already analyzed previously)`);

  console.log('\nTop 3 matches:');
  allAnalyzed.rows.slice(0, 3).forEach((j, i) => {
    console.log(`${i + 1}. ${j.title} at ${j.company} - ${j.match_score}/100`);
  });

  await pool.end();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
