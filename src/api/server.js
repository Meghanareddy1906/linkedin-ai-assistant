require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path'); // ADD THIS LINE
const { sendReplyById, sendConnectionById, sendPostById } = require('../executor/send-actions');
const jwt = require('jsonwebtoken');
const statusRoutes = require('./routes/status');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create settings table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    last_active_at TIMESTAMPTZ
  )
`).then(() => {
  // Insert default presence row if it doesn't exist
  return pool.query(`
    INSERT INTO settings (key, last_active_at)
    VALUES ('dashboard_presence', NOW())
    ON CONFLICT (key) DO NOTHING
  `);
}).catch(err => {
  console.error('Error creating settings table:', err);
});

// Gemini API setup (matching your working agents)
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

// In-memory sent history
let sentHistory = [];

// Helper function to call Gemini API
async function callGemini(prompt) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// Get pending items
app.get('/api/pending', async (req, res) => {
  try {
    const [replies, connections, jobs, posts] = await Promise.all([
      pool.query(`
        SELECT dr.*, c.participant_name 
        FROM drafted_replies dr
        LEFT JOIN conversations c ON dr.conversation_id = c.id
        WHERE dr.sent = false AND dr.dismissed = false
      `),
      pool.query("SELECT * FROM connections WHERE sent = false AND dismissed = false"),
      pool.query('SELECT * FROM jobs WHERE match_score >= 70 AND approved = false'),
      pool.query("SELECT * FROM post_drafts WHERE posted = false AND dismissed = false")
    ]);

    res.json({
      replies: replies.rows,
      connections: connections.rows,
      jobs: jobs.rows,
      posts: posts.rows
    });
  } catch (err) {
    console.error('Error fetching pending items:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Regenerate draft
app.post('/api/regenerate', async (req, res) => {
  const { type, id, customPrompt = '' } = req.body;

  try {
    let newDraft;
    let updateQuery;

    switch(type) {
      case 'reply': {
        // Get conversation context
        const replyData = await pool.query(`
          SELECT dr.*, c.participant_name, c.thread_url
          FROM drafted_replies dr
          LEFT JOIN conversations c ON dr.conversation_id = c.id
          WHERE dr.id = $1
        `, [id]);

        if (replyData.rows.length === 0) {
          return res.status(404).json({ error: 'Reply not found' });
        }

        const reply = replyData.rows[0];

        // Get conversation messages
        const messages = await pool.query(
          'SELECT sender, message_text FROM messages WHERE conversation_id = $1 ORDER BY id ASC',
          [reply.conversation_id]
        );

        const transcript = messages.rows
          .map(m => `${m.sender || '(them)'}: ${m.message_text}`)
          .join('\n');

        // Get profile data for context
        let profileContext = '';
        if (fs.existsSync('data/profile-data.json')) {
          const profile = JSON.parse(fs.readFileSync('data/profile-data.json', 'utf-8'));
          const currentRole = profile.experience?.[0]
            ? `${profile.experience[0].title} at ${profile.experience[0].companyAndType}`
            : null;

          profileContext = [
            profile.headline ? `Headline: ${profile.headline}` : null,
            currentRole ? `Current role: ${currentRole}` : null,
          ]
            .filter(Boolean)
            .join('\n');
        }

        let prompt = `You are helping draft a LinkedIn reply${profileContext ? ` for this person:\n${profileContext}\n\n` : '.'}
Below is a message thread with ${reply.participant_name}.

Conversation so far:
${transcript}

Draft a short, natural, professional-but-friendly reply to the most recent message. Keep it concise (2-4 sentences), match the tone of the conversation, and do not use overly formal or robotic language.

IMPORTANT: Never use placeholder text in brackets like [X]. Write complete sentences that are ready to send as-is.`;

        if (customPrompt) {
          prompt += `\n\nAdditional instructions: ${customPrompt}`;
        }

        prompt += `\n\nOnly output the reply text itself, nothing else.`;

        newDraft = await callGemini(prompt);
        updateQuery = 'UPDATE drafted_replies SET draft_text = $1 WHERE id = $2 RETURNING *';
        break;
      }

      case 'connection': {
        // Get connection data
        const connData = await pool.query('SELECT * FROM connections WHERE id = $1', [id]);
        
        if (connData.rows.length === 0) {
          return res.status(404).json({ error: 'Connection not found' });
        }

        const connection = connData.rows[0];

        let prompt = `You are a LinkedIn connection request assistant. Write a personalized connection note.

Person's Info:
Name: ${connection.name}
Headline: ${connection.headline || 'Not provided'}

Write a connection note that:
- Is friendly and professional
- References something specific from their profile
- Is under 200 characters (LinkedIn limit)
- Explains why you'd like to connect

IMPORTANT: Never use placeholder text in brackets. Write a complete note ready to send.`;

        if (customPrompt) {
          prompt += `\n\nAdditional instructions: ${customPrompt}`;
        }

        prompt += `\n\nOnly output the note text, no quotes.`;

        newDraft = await callGemini(prompt);
        updateQuery = 'UPDATE connections SET draft_note = $1 WHERE id = $2 RETURNING *';
        break;
      }

      case 'post': {
        // Get post data
        const postData = await pool.query('SELECT * FROM post_drafts WHERE id = $1', [id]);
        
        if (postData.rows.length === 0) {
          return res.status(404).json({ error: 'Post not found' });
        }

        const post = postData.rows[0];

        let prompt = `You are a LinkedIn content creator. Create a professional post about: ${post.topic}

The post should:
- Be engaging and valuable
- Use line breaks for readability
- Be 150-300 words
- Include a clear takeaway or call to action
- Sound authentic and conversational

IMPORTANT: Never use placeholder text in brackets. Write a complete post ready to publish.`;

        if (customPrompt) {
          prompt += `\n\nAdditional instructions: ${customPrompt}`;
        }

        prompt += `\n\nJust provide the post text, no quotes or hashtags unless truly relevant.`;

        newDraft = await callGemini(prompt);
        updateQuery = 'UPDATE post_drafts SET draft_text = $1 WHERE id = $2 RETURNING *';
        break;
      }

      default:
        return res.status(400).json({ error: 'Invalid type' });
    }

    // Update database with new draft
    const result = await pool.query(updateQuery, [newDraft, id]);
    
    res.json({ 
      success: true, 
      newDraft,
      item: result.rows[0]
    });

  } catch (err) {
    console.error('Error regenerating draft:', err);
    res.status(500).json({ error: 'Failed to regenerate draft' });
  }
});

// Job search endpoint
app.post('/api/jobs/search', async (req, res) => {
  const { keywords, location } = req.body;

  try {
    console.log(`Searching jobs: keywords="${keywords}", location="${location}"`);

    const { spawn } = require('child_process');
    const path = require('path');

    // Paths to the scraper files
    const scraperPath = path.join(__dirname, '../scrapers/10-read-job-search.js');
    const matcherPath = path.join(__dirname, '../agents/11-job-match-agent.js');

    // Run job scraper first
    const scraper = spawn('node', [scraperPath, keywords, location || '']);
    
    let scraperOutput = '';
    let scraperError = '';

    scraper.stdout.on('data', (data) => {
      scraperOutput += data.toString();
      console.log(`Job Scraper: ${data}`);
    });

    scraper.stderr.on('data', (data) => {
      scraperError += data.toString();
      console.error(`Job Scraper Error: ${data}`);
    });

    scraper.on('close', (code) => {
      console.log(`Job scraper finished with code ${code}`);
      
      if (code !== 0) {
        console.error('Scraper failed:', scraperError);
      }

      // Run job matcher
      const matcher = spawn('node', [matcherPath]);
      
      let matcherOutput = '';
      let matcherError = '';

      matcher.stdout.on('data', (data) => {
        matcherOutput += data.toString();
        console.log(`Job Matcher: ${data}`);
      });

      matcher.stderr.on('data', (data) => {
        matcherError += data.toString();
        console.error(`Job Matcher Error: ${data}`);
      });

      matcher.on('close', async (matchCode) => {
        console.log(`Job matcher finished with code ${matchCode}`);
        
        if (matchCode !== 0) {
          console.error('Matcher failed:', matcherError);
        }

        // Fetch updated jobs from database
        try {
          const result = await pool.query(
            'SELECT * FROM jobs WHERE match_score >= 70 AND approved = false ORDER BY created_at DESC'
          );
          
          console.log(`Returning ${result.rows.length} jobs to frontend`);
          
          res.json({ 
            success: true, 
            jobs: result.rows,
            message: `Found ${result.rows.length} matching jobs`
          });
        } catch (dbErr) {
          console.error('Database error:', dbErr);
          res.status(500).json({ 
            error: 'Failed to fetch jobs from database',
            details: dbErr.message 
          });
        }
      });
    });

  } catch (err) {
    console.error('Error in job search endpoint:', err);
    res.status(500).json({ 
      error: 'Failed to search jobs', 
      details: err.message 
    });
  }
});

// Post generation endpoint
app.post('/api/posts/generate', async (req, res) => {
  const { instructions } = req.body; // Changed from 'topic' to 'instructions'

  try {
    console.log(`Generating post with instructions: ${instructions || '(profile-based)'}`);

    // Read profile data for personalization context only
    let profileContext = '';
    if (fs.existsSync('data/profile-data.json')) {
      const profile = JSON.parse(fs.readFileSync('data/profile-data.json', 'utf-8'));
      const currentRole = profile.experience?.[0]
        ? `${profile.experience[0].title} at ${profile.experience[0].companyAndType}`
        : null;

      profileContext = [
        `Name: ${profile.name || 'User'}`,
        profile.headline ? `Headline: ${profile.headline}` : null,
        currentRole ? `Current role: ${currentRole}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    }

    let prompt;
    
    if (instructions && instructions.trim()) {
      // USER-DRIVEN: Use their instructions as the primary directive
      prompt = `You are writing a LinkedIn post${profileContext ? ` for:\n${profileContext}\n\n` : '.'}

User's instructions:
${instructions}

Write the post exactly as requested. Follow their specifications for:
- Tone and style (casual, formal, professional, etc.)
- Length (if specified)
- Structure and content
- Any specific elements they want included

Do not add restrictions or rules they didn't ask for. Never use placeholder text in brackets like [X]. Output only the post text itself, ready to publish.`;
    } else {
      // FALLBACK: Default profile-based generation
      prompt = `You are a LinkedIn content creator${profileContext ? ` writing for this person:\n${profileContext}\n\n` : '.'}

Based on their profile, create an engaging LinkedIn post that:
- Shares professional insights, career reflections, or industry observations
- Is conversational and authentic (150-250 words)
- Includes a clear takeaway or call-to-action
- Uses natural line breaks for readability

Write a complete post ready to publish. No placeholder text in brackets.`;
    }

    const draftText = await callGemini(prompt);

    // Save to database
    const result = await pool.query(
      'INSERT INTO post_drafts (topic, draft_text, created_at, approved, posted, dismissed) VALUES ($1, $2, NOW(), FALSE, FALSE, FALSE) RETURNING *',
      [instructions || 'Profile-based post', draftText]
    );

    res.json({ 
      success: true, 
      post: result.rows[0],
      message: 'Post draft generated successfully'
    });

  } catch (err) {
    console.error('Error generating post:', err);
    res.status(500).json({ error: 'Failed to generate post', details: err.message });
  }
});

// Heartbeat endpoint - updates last activity
app.post('/api/heartbeat', async (req, res) => {
  try {
    await pool.query(
      `UPDATE settings 
       SET last_active_at = NOW() 
       WHERE key = 'dashboard_presence'`
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating heartbeat:', err);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

// Presence endpoint - checks if dashboard is active
app.get('/api/presence', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT last_active_at 
       FROM settings 
       WHERE key = 'dashboard_presence'`
    );
    
    if (result.rows.length === 0) {
      return res.json({ online: false });
    }
    
    const lastActive = new Date(result.rows[0].last_active_at);
    const now = new Date();
    const diffMinutes = (now - lastActive) / 1000 / 60;
    
    // Online if active within last 2 minutes
    const online = diffMinutes < 2;
    
    res.json({ 
      online,
      lastActiveAt: lastActive.toISOString(),
      minutesAgo: Math.floor(diffMinutes)
    });
  } catch (err) {
    console.error('Error checking presence:', err);
    res.status(500).json({ error: 'Failed to check presence' });
  }
});

// Approve item
app.post('/api/approve', async (req, res) => {
  const { type, id } = req.body;
  
  try {
    console.log(`[Approve] Type: ${type}, ID: ${id}`);
    
    // First, mark as approved in database
    let updateQuery, selectQuery, sendResult;
    
    switch(type) {
      case 'reply':
        updateQuery = "UPDATE drafted_replies SET approved = true WHERE id = $1";
        selectQuery = `
          SELECT dr.*, c.participant_name, 'reply' as type 
          FROM drafted_replies dr
          LEFT JOIN conversations c ON dr.conversation_id = c.id
          WHERE dr.id = $1
        `;
        await pool.query(updateQuery, [id]);
        
        // Actually send the reply
        sendResult = await sendReplyById(id);
        break;
        
      case 'connection':
        updateQuery = "UPDATE connections SET approved = true WHERE id = $1";
        selectQuery = "SELECT *, 'connection' as type FROM connections WHERE id = $1";
        await pool.query(updateQuery, [id]);
        
        // Actually send the connection
        sendResult = await sendConnectionById(id);
        break;
        
      case 'job':
        updateQuery = 'UPDATE jobs SET approved = true WHERE id = $1';
        selectQuery = "SELECT *, 'job' as type FROM jobs WHERE id = $1";
        await pool.query(updateQuery, [id]);
        sendResult = { success: true, message: 'Job marked as approved' };
        break;
        
      case 'post':
        updateQuery = "UPDATE post_drafts SET approved = true WHERE id = $1";
        selectQuery = "SELECT *, 'post' as type FROM post_drafts WHERE id = $1";
        await pool.query(updateQuery, [id]);
        
        // Actually send the post
        sendResult = await sendPostById(id);
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }

    // Add to sent history
    const result = await pool.query(selectQuery, [id]);
    if (result.rows.length > 0) {
      sentHistory.unshift({
        ...result.rows[0],
        sent_at: new Date().toISOString()
      });
    }

    // Return the send result
    res.json({ 
      success: sendResult.success, 
      message: sendResult.message,
      error: sendResult.error 
    });
    
  } catch (err) {
    console.error('Error approving/sending item:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to approve and send',
      message: err.message 
    });
  }
});

// Dismiss item
app.post('/api/dismiss', async (req, res) => {
  const { type, id } = req.body;
  
  let query;
  
  switch(type) {
    case 'reply':
      query = "UPDATE drafted_replies SET dismissed = true WHERE id = $1";
      break;
    case 'connection':
      query = "UPDATE connections SET dismissed = true WHERE id = $1";
      break;
    case 'post':
      query = "UPDATE post_drafts SET dismissed = true WHERE id = $1";
      break;
    default:
      return res.status(400).json({ error: 'Invalid type' });
  }

  try {
    await pool.query(query, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error dismissing item:', err);
    res.status(500).json({ error: 'Failed to dismiss' });
  }
});

// Get sent history
app.get('/api/sent-history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM (
        SELECT 
          'message' as type,
          dr.id,
          c.participant_name,
          dr.draft_text,
          COALESCE(dr.sent_at, dr.created_at) as sent_at
        FROM drafted_replies dr
        JOIN conversations c ON dr.conversation_id = c.id
        WHERE dr.sent = TRUE
        
        UNION ALL
        
        SELECT 
          'connection' as type,
          id,
          name as participant_name,
          draft_note as draft_text,
          COALESCE(sent_at, created_at) as sent_at
        FROM connections
        WHERE sent = TRUE
        
        UNION ALL
        
        SELECT 
          'post' as type,
          id,
          topic as participant_name,
          draft_text,
          COALESCE(sent_at, created_at) as sent_at
        FROM post_drafts
        WHERE posted = TRUE
        
        UNION ALL
        
        SELECT 
          'job' as type,
          id,
          title as participant_name,
          company as draft_text,
          created_at as sent_at
        FROM jobs
        WHERE approved = TRUE
      ) AS combined_results
      ORDER BY sent_at DESC NULLS LAST
      LIMIT 100
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sent history:', error);
    res.status(500).json({ error: 'Failed to fetch sent history' });
  }
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  
  if (password === process.env.DASHBOARD_PASSWORD) {
    const token = jwt.sign({ user: 'dashboard' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token });
  }
  
  res.status(401).json({ success: false, message: 'Invalid password' });
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
  });
}

// GET settings - ADD AUTH MIDDLEWARE
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM target_settings LIMIT 1');
    
    if (result.rows.length === 0) {
      // Create default settings if none exist
      const insertResult = await pool.query(`
        INSERT INTO target_settings (target_connections_period, target_connections_count, target_posts_period, target_posts_count)
        VALUES ('weekly', 5, 'weekly', 2)
        RETURNING *
      `);
      return res.json(insertResult.rows[0]);
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching settings:', error);
    console.error('Full error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch settings', details: error.message });
  }
});

// POST settings (update) - ADD AUTH MIDDLEWARE AND BETTER ERROR HANDLING
app.post('/api/settings', authenticateToken, async (req, res) => {
  try {
    const {
      target_connections_period,
      target_connections_count,
      target_posts_period,
      target_posts_count
    } = req.body;

    console.log('Received settings update:', req.body);

    // Validate inputs
    if (!['daily', 'weekly'].includes(target_connections_period)) {
      return res.status(400).json({ error: 'Invalid connections period' });
    }
    if (!['daily', 'weekly'].includes(target_posts_period)) {
      return res.status(400).json({ error: 'Invalid posts period' });
    }
    if (target_connections_count < 0 || target_posts_count < 0) {
      return res.status(400).json({ error: 'Counts must be non-negative' });
    }

    // Check if settings row exists
    const existingSettings = await pool.query('SELECT id FROM target_settings LIMIT 1');
    
    let result;
    
    if (existingSettings.rows.length === 0) {
      // No settings exist, INSERT a new row
      console.log('No settings found, inserting new row...');
      result = await pool.query(`
        INSERT INTO target_settings (target_connections_period, target_connections_count, target_posts_period, target_posts_count)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [target_connections_period, target_connections_count, target_posts_period, target_posts_count]);
    } else {
      // Settings exist, UPDATE the existing row
      console.log('Updating existing settings...');
      result = await pool.query(`
        UPDATE target_settings 
        SET target_connections_period = $1,
            target_connections_count = $2,
            target_posts_period = $3,
            target_posts_count = $4,
            updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `, [target_connections_period, target_connections_count, target_posts_period, target_posts_count, existingSettings.rows[0].id]);
    }

    console.log('Settings saved successfully:', result.rows[0]);
    res.json({ success: true, settings: result.rows[0] });

  } catch (error) {
    console.error('❌ Error updating settings:', error);
    console.error('Full error details:', error.message, error.stack);
    res.status(500).json({ 
      error: 'Failed to update settings', 
      details: error.message 
    });
  }
});

// GET progress for targets - ADD AUTH MIDDLEWARE
app.get('/api/targets/progress', authenticateToken, async (req, res) => {
  try {
    const settings = await pool.query('SELECT * FROM target_settings LIMIT 1');
    
    if (settings.rows.length === 0) {
      return res.json({
        connections: { sent: 0, target: 0, period: 'weekly' },
        posts: { sent: 0, target: 0, period: 'weekly' }
      });
    }

    const config = settings.rows[0];
    
    // Calculate date ranges
    const now = new Date();
    
    // Connections period
    const connStartDate = getPeriodStartDate(now, config.target_connections_period);
    const connResult = await pool.query(
      `SELECT COUNT(*) as count FROM connections WHERE sent = TRUE AND sent_at >= $1 AND sent_at <= $2`,
      [connStartDate, now]
    );

    // Posts period
    const postsStartDate = getPeriodStartDate(now, config.target_posts_period);
    const postsResult = await pool.query(
      `SELECT COUNT(*) as count FROM post_drafts WHERE posted = TRUE AND sent_at >= $1 AND sent_at <= $2`,
      [postsStartDate, now]
    );

    res.json({
      connections: {
        sent: parseInt(connResult.rows[0].count),
        target: config.target_connections_count,
        period: config.target_connections_period
      },
      posts: {
        sent: parseInt(postsResult.rows[0].count),
        target: config.target_posts_count,
        period: config.target_posts_period
      }
    });

  } catch (error) {
    console.error('Error fetching progress:', error);
    console.error('Full error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch progress', details: error.message });
  }
});

// Helper function for date calculation
function getPeriodStartDate(now, period) {
  if (period === 'daily') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (period === 'weekly') {
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = start
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - diff);
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }
  return now;
}

// Mount status routes
app.use('/api/status', authenticateToken, statusRoutes);

// Refresh status tracking
let refreshStatus = {
  status: 'idle', // 'idle' | 'running' | 'completed' | 'failed'
  message: '',
  startedAt: null,
  completedAt: null
};

// POST /api/refresh - Trigger full scraping pipeline
app.post('/api/refresh', authenticateToken, async (req, res) => {
  if (refreshStatus.status === 'running') {
    return res.status(409).json({ 
      error: 'Refresh already in progress',
      status: refreshStatus.status 
    });
  }

  // Reset status
  refreshStatus = {
    status: 'running',
    message: 'Starting refresh...',
    startedAt: new Date(),
    completedAt: null
  };

  // Respond immediately
  res.json({ 
    success: true, 
    message: 'Refresh started',
    status: 'running'
  });

  // Run pipeline asynchronously
  (async () => {
    try {
      const { execSync } = require('child_process');
      
      // Get the project root directory (where package.json is)
      const projectRoot = path.join(__dirname, '..', '..');

      console.log('🔄 Starting refresh pipeline...');
      console.log('📁 Project root:', projectRoot);

      // Step 1: Read inbox messages
      refreshStatus.message = 'Reading inbox messages...';
      console.log('📥 Running 3-read-inbox.js...');
      execSync('node src/scrapers/3-read-inbox.js', { 
        cwd: projectRoot,
        stdio: 'inherit' 
      });

      // Step 2: Read full message threads
      refreshStatus.message = 'Reading message threads...';
      console.log('📨 Running 4-read-full-threads.js...');
      execSync('node src/scrapers/4-read-full-threads.js', { 
        cwd: projectRoot,
        stdio: 'inherit' 
      });

      // Step 3: Draft replies
      refreshStatus.message = 'Drafting replies...';
      console.log('✍️ Running 5-draft-replies.js...');
      execSync('node src/agents/5-draft-replies.js', { 
        cwd: projectRoot,
        stdio: 'inherit' 
      });

      // Step 4: Read suggested connections
      refreshStatus.message = 'Reading suggested connections...';
      console.log('👥 Running 8-read-suggested-connections.js...');
      execSync('node src/scrapers/8-read-suggested-connections.js', { 
        cwd: projectRoot,
        stdio: 'inherit' 
      });

      // Step 5: Draft connection notes
      refreshStatus.message = 'Drafting connection notes...';
      console.log('📝 Running 9-draft-connection-notes.js...');
      execSync('node src/agents/9-draft-connection-notes.js', { 
        cwd: projectRoot,
        stdio: 'inherit' 
      });

      refreshStatus = {
        status: 'completed',
        message: 'Refresh completed successfully',
        startedAt: refreshStatus.startedAt,
        completedAt: new Date()
      };

      console.log('✅ Refresh pipeline completed successfully');

    } catch (error) {
      console.error('❌ Refresh pipeline failed:', error);
      refreshStatus = {
        status: 'failed',
        message: error.message || 'Refresh failed',
        startedAt: refreshStatus.startedAt,
        completedAt: new Date()
      };
    }
  })();
});

// GET /api/refresh/status - Check refresh progress
app.get('/api/refresh/status', authenticateToken, (req, res) => {
  res.json(refreshStatus);
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});