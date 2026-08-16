const Database = require('better-sqlite3');
const db = new Database('./linkedin.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS message_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_name TEXT,
    draft_text TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS connection_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    headline TEXT,
    profile_url TEXT,
    draft_note TEXT,
    status TEXT DEFAULT 'pending',
    drafted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    company TEXT,
    job_url TEXT,
    match_score INTEGER,
    applied INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT,
    draft_text TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert sample data
db.prepare(`INSERT INTO connection_requests (name, headline, profile_url, draft_note) VALUES (?, ?, ?, ?)`).run(
  'John Doe', 'Software Engineer at Tech Corp', 'https://linkedin.com/in/johndoe', 'Hi John, I noticed your expertise in React!'
);

db.prepare(`INSERT INTO connection_requests (name, headline, profile_url, draft_note) VALUES (?, ?, ?, ?)`).run(
  'Jane Smith', 'Product Manager at Startup Inc', 'https://linkedin.com/in/janesmith', 'Hi Jane, would love to connect!'
);

console.log('✅ Database schema created and sample data inserted!');
db.close();