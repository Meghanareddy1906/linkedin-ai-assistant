const express = require('express');
const cors = require('cors');
const pool = require('../db/db');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// GET /api/pending - returns all pending items
app.get('/api/pending', async (req, res) => {
  try {
    const [replies, connections, jobs, posts] = await Promise.all([
      // Drafted replies
      pool.query(
        `SELECT dr.id, dr.draft_text, dr.created_at, c.participant_name
         FROM drafted_replies dr
         JOIN conversations c ON c.id = dr.conversation_id
         WHERE dr.approved = FALSE AND dr.dismissed = FALSE
         ORDER BY dr.created_at DESC`
      ),
      // Connection requests
      pool.query(
        `SELECT id, name, headline, profile_url, draft_note, drafted_at
         FROM connections
         WHERE approved = FALSE AND dismissed = FALSE
         ORDER BY drafted_at DESC`
      ),
      // Job matches
      pool.query(
        `SELECT id, title, company, job_url, match_score, created_at
         FROM jobs
         WHERE match_score >= 70 AND approved = FALSE
         ORDER BY match_score DESC`
      ),
      // Post drafts
      pool.query(
        `SELECT id, topic, draft_text, created_at
         FROM post_drafts
         WHERE approved = FALSE AND dismissed = FALSE
         ORDER BY created_at DESC`
      ),
    ]);

    res.json({
      replies: replies.rows,
      connections: connections.rows,
      jobs: jobs.rows,
      posts: posts.rows,
    });
  } catch (err) {
    console.error('Error fetching pending items:', err);
    res.status(500).json({ error: 'Failed to fetch pending items' });
  }
});

// POST /api/approve - approves an item
app.post('/api/approve', async (req, res) => {
  const { type, id } = req.body;

  if (!type || !id) {
    return res.status(400).json({ error: 'Missing type or id' });
  }

  try {
    let query;
    switch (type) {
      case 'reply':
        query = 'UPDATE drafted_replies SET approved = TRUE WHERE id = $1';
        break;
      case 'connection':
        query = 'UPDATE connections SET approved = TRUE, send_note = TRUE WHERE id = $1';
        break;
      case 'job':
        query = 'UPDATE jobs SET approved = TRUE WHERE id = $1';
        break;
      case 'post':
        query = 'UPDATE post_drafts SET approved = TRUE WHERE id = $1';
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }

    const result = await pool.query(query, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ success: true, message: `${type} approved` });
  } catch (err) {
    console.error('Error approving item:', err);
    res.status(500).json({ error: 'Failed to approve item' });
  }
});

// POST /api/dismiss - dismisses an item
app.post('/api/dismiss', async (req, res) => {
  const { type, id } = req.body;

  if (!type || !id) {
    return res.status(400).json({ error: 'Missing type or id' });
  }

  try {
    let query;
    switch (type) {
      case 'reply':
        query = 'UPDATE drafted_replies SET dismissed = TRUE WHERE id = $1';
        break;
      case 'connection':
        query = 'UPDATE connections SET dismissed = TRUE WHERE id = $1';
        break;
      case 'post':
        query = 'UPDATE post_drafts SET dismissed = TRUE WHERE id = $1';
        break;
      case 'job':
        return res.status(400).json({ error: 'Jobs cannot be dismissed' });
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }

    const result = await pool.query(query, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ success: true, message: `${type} dismissed` });
  } catch (err) {
    console.error('Error dismissing item:', err);
    res.status(500).json({ error: 'Failed to dismiss item' });
  }
});

// GET /api/sent-history - returns sent items
app.get('/api/sent-history', async (req, res) => {
  try {
    const [replies, connections, posts] = await Promise.all([
      pool.query(
        `SELECT dr.id, dr.draft_text, dr.sent_at, c.participant_name, 'reply' as type
         FROM drafted_replies dr
         JOIN conversations c ON c.id = dr.conversation_id
         WHERE dr.sent = TRUE AND dr.sent_at IS NOT NULL
         ORDER BY dr.sent_at DESC
         LIMIT 50`
      ),
      pool.query(
        `SELECT id, name, draft_note, sent_at, 'connection' as type
         FROM connections
         WHERE sent = TRUE AND sent_at IS NOT NULL
         ORDER BY sent_at DESC
         LIMIT 50`
      ),
      pool.query(
        `SELECT id, topic, draft_text, sent_at, 'post' as type
         FROM post_drafts
         WHERE sent = TRUE AND sent_at IS NOT NULL
         ORDER BY sent_at DESC
         LIMIT 50`
      ),
    ]);

    // Combine and sort by sent_at
    const allItems = [
      ...replies.rows,
      ...connections.rows,
      ...posts.rows,
    ].sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at)).slice(0, 50);

    res.json(allItems);
  } catch (err) {
    console.error('Error fetching sent history:', err);
    res.status(500).json({ error: 'Failed to fetch sent history' });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});