# LinkedIn Assistant — Day 1: Environment + Playwright Setup

This covers exactly today's scope: get Playwright installed, log into
LinkedIn once manually, save the session, and confirm it persists.

No scraping, no agents, no WhatsApp yet — just proving the foundation works.

## Prerequisites

- Node.js installed (v18 or later recommended). Check with:
  ```
  node --version
  ```
  If you don't have it, install from https://nodejs.org

## Step-by-step

### 1. Get the project files onto your machine

Download/copy this `linkedin-assistant` folder to your computer. It already
has `package.json` set up with Playwright and dotenv as dependencies.

### 2. Install dependencies

Open a terminal in the `linkedin-assistant` folder and run:

```bash
npm install
```

This installs the Playwright and dotenv packages listed in package.json.

### 3. Install the actual browser binaries

Playwright needs to download real browser binaries (Chromium) separately
from the npm package. Run:

```bash
npx playwright install chromium
```

This may take a minute or two — it's downloading an actual browser.

### 4. Run the login script

```bash
node 1-login-and-save-session.js
```

What will happen:
- A real Chrome-like browser window will pop open (not headless — you'll
  see it)
- It navigates to LinkedIn's login page
- **You log in manually** — type your email and password yourself, solve
  any CAPTCHA or verification step LinkedIn shows you, just like you
  normally would
- Once you land on your feed, the script detects this automatically and
  saves your session to a new file called `auth.json`
- The terminal will print a confirmation and the browser will close

**Important:** `auth.json` contains your live session cookies — treat it
like a password. It's already excluded from git via `.gitignore`. Don't
share it or commit it anywhere.

### 5. Verify the session persists

Close everything, then run:

```bash
node 2-verify-session.js
```

What will happen:
- A new browser opens, this time using the saved `auth.json` instead of
  asking you to log in
- It navigates straight to your LinkedIn feed
- The terminal will print ✅ SUCCESS if you're logged in automatically, or
  ❌ FAILED if you got redirected to login/verification

If it succeeds, you've proven the core mechanism the whole project depends
on: **persisting a LinkedIn session so the assistant can read your account
without you logging in every time.**

## Troubleshooting

- **Browser doesn't open / errors on launch**: re-run
  `npx playwright install chromium` — the binary may not have downloaded
  correctly.
- **Script hangs after login**: LinkedIn's URL after login is usually
  `linkedin.com/feed/...`. If LinkedIn changed their post-login redirect,
  you may need to just manually navigate to your feed after logging in —
  the script is waiting for that URL pattern.
- **Session verify fails (❌ FAILED)**: this is common on the first few
  tries. Re-run the login script to get a fresh `auth.json`. If it keeps
  failing, LinkedIn may be flagging the browser context as suspicious —
  try leaving more time between the two scripts, or check if LinkedIn sent
  you a security email.
- **LinkedIn shows a CAPTCHA or "verify it's you" prompt**: this is normal,
  solve it manually in the browser window as you would normally. Just note
  it happened — from our earlier discussion, this is worth logging over
  time as an early signal of how LinkedIn is treating this browser session.

## What's next (not today)

Once both scripts work reliably, the next step is building a read-only
scraper that pulls specific data (inbox messages, profile info) using this
same saved session — but that's a separate step for after this is solid.
