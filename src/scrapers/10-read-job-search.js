/**
 * STEP 10: Read job search results
 *
 * What this does:
 * - Reuses your saved auth.json session
 * - Searches LinkedIn Jobs for keywords passed as command-line arguments
 * - Extracts job listings: title, company, location, posted date, link
 * - Saves combined, deduplicated results to data/job-search-results.json
 *
 * Run with: node src/scrapers/10-read-job-search.js "Software Engineer" "San Francisco"
 */

const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'data/auth.json';
const OUTPUT_FILE = 'data/job-search-results.json';

// Get keywords and location from command-line arguments
const keywords = process.argv[2] || 'Software Engineer';
const location = process.argv[3] || 'India';

// Single search query from the dashboard
const SEARCHES = [
  { keywords: keywords, location: location },
];

function buildSearchUrl(keywords, location) {
  const params = new URLSearchParams({
    keywords: keywords,
    location: location,
  });
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

async function extractJobCards(page) {
  return page.evaluate(() => {
    const results = [];

    const cards = document.querySelectorAll(
      '[data-testid*="job-card"], li[componentkey^="entity-collection-item-"], .job-card-container'
    );

    cards.forEach((card) => {
      const titleEl = card.querySelector(
        '.job-card-list__title, .artdeco-entity-lockup__title, a[href*="/jobs/view/"]'
      );
      const companyEl = card.querySelector('.artdeco-entity-lockup__subtitle');
      const locationEl = card.querySelector('.artdeco-entity-lockup__caption');
      const linkEl = card.querySelector('a[href*="/jobs/view/"]');

      const title = titleEl ? titleEl.textContent.trim() : null;
      if (title) {
        results.push({
          title,
          company: companyEl ? companyEl.textContent.trim() : null,
          location: locationEl ? locationEl.textContent.trim() : null,
          url: linkEl ? linkEl.href : null,
        });
      }
    });

    return results;
  });
}

async function scrapeSearch(page, keywords, location) {
  const url = buildSearchUrl(keywords, location);
  console.log(`\nSearching: "${keywords}" in "${location}"...`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  let jobsMap = new Map();

  function mergeIntoMap(snapshot) {
    for (const job of snapshot) {
      const key = `${job.title}|||${job.company}`;
      jobsMap.set(key, job);
    }
  }

  mergeIntoMap(await extractJobCards(page));

  let previousScrollTop = -1;
  let currentScrollTop = 0;
  let steps = 0;
  const MAX_STEPS = 15;

  while (previousScrollTop !== currentScrollTop && steps < MAX_STEPS) {
    currentScrollTop = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (main && main.scrollHeight > main.clientHeight) {
        main.scrollBy(0, 600);
        return main.scrollTop;
      }
      window.scrollBy(0, 600);
      return window.scrollY;
    });
    await page.waitForTimeout(900);

    mergeIntoMap(await extractJobCards(page));

    if (currentScrollTop === previousScrollTop) break;
    previousScrollTop = currentScrollTop;
    steps++;
  }

  const jobs = Array.from(jobsMap.values());
  console.log(`  -> Found ${jobs.length} job(s) for this search.`);
  return jobs;
}

async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`No ${AUTH_FILE} found. Run src/session/1-login-and-save-session.js first.`);
    process.exit(1);
  }

  console.log(`Launching browser with saved session...`);
  console.log(`Searching for: "${keywords}" in "${location}"`);
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  let allJobsMap = new Map();

  for (const search of SEARCHES) {
    const jobs = await scrapeSearch(page, search.keywords, search.location);
    for (const job of jobs) {
      const key = `${job.title}|||${job.company}`;
      allJobsMap.set(key, job);
    }
  }

  const allJobs = Array.from(allJobsMap.values());
  console.log(`\nTotal unique jobs across all searches: ${allJobs.length}`);

  if (allJobs.length === 0) {
    console.log('\n⚠️  No jobs captured. Taking a screenshot for debugging...');
    try {
      await page.screenshot({ path: 'data/debug-screenshot.png', fullPage: true, timeout: 10000 });
      console.log('Check data/debug-screenshot.png');
    } catch (err) {
      console.log('(Screenshot also timed out - not critical, continuing.)');
    }
  } else {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allJobs, null, 2));
    console.log(`Saved to ${OUTPUT_FILE}`);
    console.log('\nFirst result:', allJobs[0]);
  }

  console.log('\nLeaving browser open for 15 seconds...');
  await page.waitForTimeout(15000);

  await browser.close();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
