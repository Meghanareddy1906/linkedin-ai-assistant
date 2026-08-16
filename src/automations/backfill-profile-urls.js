/**
 * Backfill missing profile URLs for connections
 * 
 * Scrapes LinkedIn to find profile URLs for connections that don't have them
 */

require('dotenv').config();
const { chromium } = require('playwright');
const pool = require('../db/db');

const AUTH_FILE = 'data/auth.json';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillProfileUrls() {
  let browser;
  
  try {
    // Get connections without profile URLs
    const result = await pool.query(`
      SELECT id, name, headline
      FROM connections
      WHERE profile_url IS NULL OR profile_url = ''
      ORDER BY created_at DESC
      LIMIT 20
    `);

    const connectionsToFix = result.rows;

    if (connectionsToFix.length === 0) {
      console.log('✓ All connections have profile URLs!');
      await pool.end();
      return;
    }

    console.log(`Found ${connectionsToFix.length} connections without profile URLs`);
    console.log('Starting browser to search for profiles...\n');

    // Launch browser
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: { width: 1366, height: 768 }
    });
    const page = await context.newPage();

    for (const conn of connectionsToFix) {
      console.log(`\n[${conn.id}] Searching for: ${conn.name}`);
      
      try {
        // Search LinkedIn for this person
        const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(conn.name)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);

        // Get first search result
        const firstResult = page.locator('li.reusable-search__result-container').first();
        const profileLink = firstResult.locator('a.app-aware-link[href*="/in/"]').first();
        
        const href = await profileLink.getAttribute('href').catch(() => null);
        
        if (href) {
          // Clean up the URL (remove query params)
          const cleanUrl = href.split('?')[0];
          
          // Update database
          await pool.query(`
            UPDATE connections 
            SET profile_url = $1 
            WHERE id = $2
          `, [cleanUrl, conn.id]);
          
          console.log(`  ✓ Found and saved: ${cleanUrl}`);
        } else {
          console.log(`  ✗ Could not find profile for ${conn.name}`);
        }
        
        await sleep(2000); // Rate limit
        
      } catch (error) {
        console.error(`  ✗ Error searching for ${conn.name}:`, error.message);
      }
    }

    await browser.close();
    await pool.end();
    console.log('\n✓ Backfill complete!');

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error('Error during backfill:', error);
    await pool.end();
    process.exit(1);
  }
}

backfillProfileUrls();