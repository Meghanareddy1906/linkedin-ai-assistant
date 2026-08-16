require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const { sendReplyById, sendConnectionById, sendPostById } = require('../executor/send-actions');

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
  const { topic } = req.body;

  try {
    console.log(`Generating post${topic ? ` about: ${topic}` : ' from profile'}`);

    // Read profile data for context
    let profileContext = '';
    if (fs.existsSync('data/profile-data.json')) {
      const profile = JSON.parse(fs.readFileSync('data/profile-data.json', 'utf-8'));
      const currentRole = profile.experience?.[0]
        ? `${profile.experience[0].title} at ${profile.experience[0].companyAndType}`
        : null;

      profileContext = [
        profile.headline ? `Headline: ${profile.headline}` : null,
        currentRole ? `Current role: ${currentRole}` : null,
        profile.about ? `About: ${profile.about.substring(0, 200)}...` : null,
      ]
        .filter(Boolean)
        .join('\n');
    }

    // Generate post content
    let prompt;
    if (topic) {
      prompt = `You are a LinkedIn content creator${profileContext ? ` writing for this person:\n${profileContext}\n\n` : '.'}

Create a professional LinkedIn post about: ${topic}

The post should:
- Be engaging and valuable to your network
- Use line breaks for readability
- Be 150-300 words
- Include a clear takeaway or call to action
- Sound authentic and conversational
- Match the person's professional voice

IMPORTANT: Never use placeholder text in brackets. Write a complete post ready to publish.

Just provide the post text, no quotes or hashtags unless truly relevant.`;
    } else {
      prompt = `You are a LinkedIn content creator${profileContext ? ` writing for this person:\n${profileContext}\n\n` : '.'}

Based on their profile, create an engaging LinkedIn post that shares professional insights, career reflections, or industry observations.

The post should:
- Be relevant to their experience and industry
- Use line breaks for readability
- Be 150-300 words
- Include a clear takeaway or call to action
- Sound authentic and conversational

IMPORTANT: Never use placeholder text in brackets. Write a complete post ready to publish.

Just provide the post text, no quotes or hashtags unless truly relevant.`;
    }

    const draftText = await callGemini(prompt);

    // Save to database with approved = FALSE
    const result = await pool.query(
      'INSERT INTO post_drafts (topic, draft_text, created_at, approved, posted, dismissed) VALUES ($1, $2, NOW(), FALSE, FALSE, FALSE) RETURNING *',
      [topic || 'Profile-based post', draftText]
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
app.get('/api/sent-history', (req, res) => {
  res.json(sentHistory);
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});