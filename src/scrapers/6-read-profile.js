/**
 * Read-only profile scraper
 *
 * What this does:
 * - Reuses your saved auth.json session
 * - Navigates to YOUR OWN LinkedIn profile page
 * - Extracts key sections: name, headline, location, About, Experience,
 *   Education, and Skills
 * - Saves everything to profile-data.json
 *
 * This is READ-ONLY - it only visits and reads your own public profile
 * page, the same as opening it in a normal browser. It does not edit,
 * change, or click anything that alters your profile.
 *
 * IMPORTANT TECHNICAL NOTE: LinkedIn virtualizes long sections like
 * Experience/Education/Skills - meaning their HTML only exists in the
 * page while that section is near the visible viewport, and may be
 * removed again once you scroll past it. Because of this, we extract
 * data on every scroll step (not just once at the end) and keep the
 * best (longest) result seen for each section.
 *
 * Run with: node 6-read-profile.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'data/auth.json';
const OUTPUT_FILE = 'data/profile-data.json';

// Runs inside the browser page - extracts whatever is currently in the DOM
async function extractSnapshot(page) {
  return page.evaluate(() => {
    const getText = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.textContent.trim() : null;
    };

    const name =
      getText('a[componentkey^="ProfileVerificationTriggerRef-"] h2') ||
      getText('h2');

    let location = null;
    const contactInfoLink = Array.from(document.querySelectorAll('a')).find(
      (a) => a.textContent.trim() === 'Contact info'
    );
    if (contactInfoLink) {
      const container = contactInfoLink.closest('div');
      const firstP = container ? container.querySelector('p') : null;
      location = firstP ? firstP.textContent.trim() : null;
    }

    const headlineCandidate = Array.from(document.querySelectorAll('p')).find(
      (p) => p.textContent.includes('|') && p.textContent.trim().length > 20
    );
    const headline = headlineCandidate ? headlineCandidate.textContent.trim() : null;
    const about = getText('#about ~ div .display-flex.ph5.pv3 span[aria-hidden="true"]');

    const expSection = document.querySelector(
      '[data-testid^="profile_ExperienceTopLevelSection"]'
    );
    let experience = [];
    if (expSection) {
      const entries = Array.from(
        expSection.querySelectorAll('[componentkey^="entity-collection-item-"]')
      );
      experience = entries.map((entry) => {
        const allPs = Array.from(entry.querySelectorAll('p'));
        const relevantPs = allPs.filter(
          (p) => !p.querySelector('a[href*="skill-associations-details"]')
        );
        const texts = relevantPs.map((p) => p.textContent.trim());
        return {
          title: texts[0] || null,
          companyAndType: texts[1] || null,
          duration: texts[2] || null,
          location: texts[3] || null,
        };
      });
    }

    const eduSection = document.querySelector(
      '[data-testid^="profile_EducationTopLevelSection"]'
    );
    let education = [];
    if (eduSection) {
      const entries = Array.from(
        eduSection.querySelectorAll('[componentkey^="entity-collection-item-"]')
      );
      education = entries.map((entry) => {
        const allPs = Array.from(entry.querySelectorAll('p'));
        const relevantPs = allPs.filter(
          (p) => !p.querySelector('a[href*="skill-associations-details"]')
        );
        const texts = relevantPs.map((p) => p.textContent.trim());
        return {
          school: texts[0] || null,
          degreeAndField: texts[1] || null,
          dates: texts[2] || null,
        };
      });
    }

    const skillsSection = document.querySelector('[data-testid^="profile_Skills"]');
    let skills = [];
    if (skillsSection) {
      const entries = Array.from(
        skillsSection.querySelectorAll('[componentkey^="entity-collection-item-"]')
      );
      skills = entries
        .map((entry) => {
          const nameP = entry.querySelector('p');
          return nameP ? nameP.textContent.trim() : null;
        })
        .filter(Boolean);
    }

    return { name, headline, location, about, skills, experience, education };
  });
}

// Merges a new snapshot into the accumulated best result. For text fields,
// keeps the first non-null value found. For array fields, keeps whichever
// version (existing or new) has more items, since virtualization can
// cause a section to shrink back to empty after you scroll past it.
function mergeSnapshot(accumulated, snapshot) {
  return {
    name: accumulated.name || snapshot.name,
    headline: accumulated.headline || snapshot.headline,
    location: accumulated.location || snapshot.location,
    about: accumulated.about || snapshot.about,
    skills: snapshot.skills.length > accumulated.skills.length ? snapshot.skills : accumulated.skills,
    experience:
      snapshot.experience.length > accumulated.experience.length
        ? snapshot.experience
        : accumulated.experience,
    education:
      snapshot.education.length > accumulated.education.length
        ? snapshot.education
        : accumulated.education,
  };
}

async function main() {
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`No ${AUTH_FILE} found. Run 1-login-and-save-session.js first.`);
    process.exit(1);
  }

  console.log('Launching browser with saved session...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  console.log('Navigating to your profile...');
  await page.goto('https://www.linkedin.com/in/me/', {
    waitUntil: 'domcontentloaded',
  });

  console.log('Waiting for profile to load...');
  try {
    await page.waitForSelector('a[componentkey^="ProfileVerificationTriggerRef-"] h2', {
      timeout: 15000,
    });
  } catch (e) {
    console.log('Name element did not appear within 15 seconds - continuing anyway.');
  }

  await page.waitForTimeout(2000);

  let profileData = {
    name: null,
    headline: null,
    location: null,
    about: null,
    skills: [],
    experience: [],
    education: [],
  };

  // Take an initial snapshot before scrolling (captures top card info)
  profileData = mergeSnapshot(profileData, await extractSnapshot(page));

  console.log('Scrolling through page, extracting sections as they render...');
  let previousHeight = 0;
  let currentHeight = await page.evaluate(() => document.body.scrollHeight);
  let steps = 0;
  const MAX_STEPS = 40; // safety cap so this can't scroll forever

  while (previousHeight !== currentHeight && steps < MAX_STEPS) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(900);

    // Extract and merge on every step, not just at the end
    profileData = mergeSnapshot(profileData, await extractSnapshot(page));

    previousHeight = currentHeight;
    currentHeight = await page.evaluate(() => document.body.scrollHeight);
    steps++;
  }

  console.log(`Finished scrolling after ${steps} step(s).`);

  // Diagnostics: confirm we're actually on the expected page, and list
  // every data-testid value currently present in the DOM - this tells us
  // definitively whether the Experience/Education/Skills containers
  // exist under a different name, or don't exist at all right now.
  console.log('\nCurrent page URL:', page.url());
  const allTestIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid')
    )
  );
  console.log('All data-testid values found on page:', allTestIds);

  // Always take a screenshot at this point for visual confirmation,
  // regardless of whether extraction succeeded
  await page.screenshot({ path: 'data/debug-screenshot.png', fullPage: true });
  console.log('Screenshot saved to data/debug-screenshot.png for visual confirmation.');

  console.log('\nCaptured profile data:');
  console.log(profileData);

  const hasData = profileData.name || profileData.headline;

  if (!hasData) {
    console.log('\n⚠️  No profile data captured at all.');
  } else {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(profileData, null, 2));
    console.log(`\nSaved to ${OUTPUT_FILE}`);

    if (profileData.experience.length === 0) {
      console.log('Note: still no experience captured - may need further debugging.');
    }
    if (profileData.education.length === 0) {
      console.log('Note: still no education captured - may need further debugging.');
    }
    if (profileData.skills.length === 0) {
      console.log('Note: still no skills captured - may need further debugging.');
    }
  }

  console.log('\nLeaving browser open for 15 seconds...');
  await page.waitForTimeout(15000);

  await browser.close();
}

main().catch((err) => {
  console.error('Something went wrong:', err);
  process.exit(1);
});
