/**
 * STEP 8: Read suggested connections
 *
 * What this does:
 * - Reuses your saved auth.json session
 * - Navigates to LinkedIn's "My Network" page
 * - Reads the list of suggested people (name, headline, profile link)
 * - Saves everything to data/suggested-connections.json
 *
 * This is READ-ONLY. It does not click "Connect", "Follow", or "Dismiss"
 * on anything - it only reads what's already displayed on the page.
 *
 * NOTE: Based on what we learned from the profile scraper, LinkedIn often
 * scrolls an inner container rather than the browser window, and may
 * lazy-render content. This script checks for that pattern proactively.
 * If it still comes back empty, we'll inspect the actual page HTML
 * together, same as before.
 *
 * Run with: node src/scrapers/8-read-suggested-connections.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'data/auth.json';
const OUTPUT_FILE = 'data/suggested-connections.json';

async function extractSuggestions(page) {
  return page.evaluate(() => {
    const results = [];

    // Real selector found via DevTools inspection: suggestion cards use
    // a componentkey starting with "auto-component-". Each card has two
    // <p> tags in order: name first, then headline. No real profile link
    // exists in the HTML (LinkedIn handles navigation via JS click
    // handler here), so profileUrl stays null.
    const cards = document.querySelectorAll('[componentkey^="auto-component-"]');

    cards.forEach((card) => {
      const paragraphs = card.querySelectorAll('p');
      const name = paragraphs[0] ? paragraphs[0].textContent.trim() : null;
      const headline = paragraphs[1] ? paragraphs[1].textContent.trim() : null;

      if (name) {
        results.push({ name, headline, profileUrl: null });
      }
    });

    return results;
  });
}

async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`No ${AUTH_FILE} found. Run src/session/1-login-and-save-session.js first.`);
    process.exit(1);
  }

  console.log('Launching browser with saved session...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  console.log('Navigating to My Network page...');
  await page.goto('https://www.linkedin.com/mynetwork/', {
    waitUntil: 'domcontentloaded',
  });

  console.log('Waiting for page to load...');
  await page.waitForTimeout(4000);

  let suggestionsMap = new Map();

  function mergeIntoMap(snapshot) {
    for (const item of snapshot) {
      const key = `${item.name}|||${item.headline}`;
      suggestionsMap.set(key, item);
    }
  }

  // Try scrolling the inner <main> container first (this is what fixed
  // the profile scraper), falling back to window scroll if that doesn't
  // apply here.
  console.log('Scrolling to load more suggestions...');
  let previousScrollTop = -1;
  let currentScrollTop = 0;
  let steps = 0;
  const MAX_STEPS = 15;

  // Capture an initial snapshot before scrolling
  mergeIntoMap(await extractSuggestions(page));

  while (previousScrollTop !== currentScrollTop && steps < MAX_STEPS) {
    currentScrollTop = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (main && main.scrollHeight > main.clientHeight) {
        main.scrollBy(0, 600);
        return main.scrollTop;
      }
      // Fallback: try window scroll if main isn't the scrollable one
      window.scrollBy(0, 600);
      return window.scrollY;
    });
    await page.waitForTimeout(900);

    mergeIntoMap(await extractSuggestions(page));

    if (currentScrollTop === previousScrollTop) break;
    previousScrollTop = currentScrollTop;
    steps++;
  }

  const allSuggestions = Array.from(suggestionsMap.values());

  console.log(`\nFound ${allSuggestions.length} suggested connection(s).`);

  if (allSuggestions.length === 0) {
    console.log('\n⚠️  No suggestions captured. Taking a screenshot for debugging...');
    await page.screenshot({ path: 'data/debug-screenshot.png', fullPage: true });
    console.log('Check data/debug-screenshot.png - we may need to inspect the actual');
    console.log('HTML structure together, same as we did for the profile scraper.');
  } else {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allSuggestions, null, 2));
    console.log(`Saved to ${OUTPUT_FILE}`);
    console.log('\nFirst result:', allSuggestions[0]);
  }

  console.log('\nLeaving browser open for 15 seconds...');
  await page.waitForTimeout(15000);

  await browser.close();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
