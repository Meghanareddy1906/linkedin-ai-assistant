# LinkedIn Assistant

A personal AI-powered LinkedIn assistant with a multi-agent architecture.
Read-only browser automation gathers data from LinkedIn; AI agents draft
suggestions; all outward actions (sending messages, posting, connecting)
are reviewed and executed manually by the user, per the project's
compliance-first design.

## Project Structure

```
linkedin-assistant/
├── src/
│   ├── session/          # Login and session persistence
│   │   ├── 1-login-and-save-session.js
│   │   └── 2-verify-session.js
│   ├── scrapers/         # Read-only data extraction from LinkedIn
│   │   ├── 3-read-inbox.js
│   │   ├── 4-read-full-threads.js
│   │   └── 6-read-profile.js
│   └── agents/           # AI-powered drafting/analysis
│       └── 5-draft-replies.js
├── data/                 # Generated data (gitignored - contains
│                            personal info, never committed)
├── .env                  # API keys (gitignored)
├── .gitignore
├── package.json
└── README.md
```

## Setup

```bash
npm install
npx playwright install chromium
```

Create a `.env` file in the project root with:
```
GEMINI_API_KEY=your_key_here
```

## Running the scripts

All commands are run from the project root (not from inside `src/`).

**1. Log in and save your session** (run this first, and again any time
your session expires):
```bash
node src/session/1-login-and-save-session.js
```

**2. Verify the saved session still works:**
```bash
node src/session/2-verify-session.js
```

**3. Read inbox conversation previews:**
```bash
node src/scrapers/3-read-inbox.js
```

**4. Read full message threads:**
```bash
node src/scrapers/4-read-full-threads.js
```

**5. Draft AI-powered replies** (requires threads-data.json from step 4,
and a GEMINI_API_KEY in .env):
```bash
node src/agents/5-draft-replies.js
```

**6. Read your own profile data:**
```bash
node src/scrapers/6-read-profile.js
```

## Important notes

- All scripts are **read-only automation** except the Gemini drafting
  script, which only generates text - nothing is ever sent to LinkedIn
  automatically. Sending messages, connecting, or posting is always done
  manually by the user after reviewing AI-drafted suggestions.
- The `data/` folder contains real personal data (messages, profile info)
  and is excluded from git via `.gitignore`. Never remove it from
  `.gitignore`.
- `auth.json` (inside `data/`) contains live session credentials - treat
  it like a password.
