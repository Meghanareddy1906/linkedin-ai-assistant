/**
 * Send WhatsApp Digest
 * 
 * Sends a daily digest of pending items via WhatsApp using Twilio
 * Only sends if dashboard is NOT actively in use
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // e.g., 'whatsapp:+14155238886'
const TWILIO_WHATSAPP_TO = process.env.TWILIO_WHATSAPP_TO;     // e.g., 'whatsapp:+919876543210'

// Check if dashboard is actively in use
async function checkDashboardPresence() {
  try {
    const response = await fetch('http://localhost:3001/api/presence');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error checking presence:', error);
    // If we can't check presence, assume offline and send digest
    return { online: false };
  }
}

async function getDigestData() {
  try {
    // Get pending messages - join with conversations to get participant name
    const repliesResult = await pool.query(
      `SELECT dr.id, dr.conversation_id, dr.draft_text, 
              c.participant_name
       FROM drafted_replies dr
       LEFT JOIN conversations c ON dr.conversation_id = c.id
       WHERE dr.approved = false 
       ORDER BY dr.created_at DESC`
    );
    
    // Get pending connections with names
    const connectionsResult = await pool.query(
      `SELECT id, name, headline 
       FROM connections 
       WHERE approved = false 
       ORDER BY created_at DESC`
    );
    
    // Get job matches with title and company
    const jobsResult = await pool.query(
      `SELECT id, title, company, match_score 
       FROM jobs 
       WHERE match_score >= 70 AND approved = false 
       ORDER BY match_score DESC, created_at DESC`
    );
    
    // Get pending posts with topics
    const postsResult = await pool.query(
      `SELECT id, topic, draft_text 
       FROM post_drafts 
       WHERE approved = false 
       ORDER BY created_at DESC`
    );

    return {
      pendingMessages: repliesResult.rows,
      pendingConnections: connectionsResult.rows,
      jobMatches: jobsResult.rows,
      pendingPosts: postsResult.rows
    };
  } catch (error) {
    console.error('Error fetching digest data:', error);
    return null;
  }
}

function buildDigestMessage(data) {
  const { pendingMessages, pendingConnections, jobMatches, pendingPosts } = data;
  
  const totalCount = pendingMessages.length + pendingConnections.length + 
                     jobMatches.length + pendingPosts.length;
  
  if (totalCount === 0) {
    return null; // No pending items
  }

  const MAX_LENGTH = 1500;
  let message = '📊 *LinkedIn Assistant Daily Digest*\n\n';
  message += `You have ${totalCount} pending item(s):\n\n`;
  
  // Track current message length
  let currentLength = message.length;
  const FOOTER_LENGTH = 150; // Reserve space for footer
  
  // Helper to add section with items
  function addSection(header, items, formatter) {
    if (items.length === 0) return '';
    
    let section = `${header}\n`;
    let itemsAdded = 0;
    
    for (let i = 0; i < items.length; i++) {
      const itemLine = formatter(items[i], i + 1);
      
      // Check if adding this item would exceed limit
      if (currentLength + section.length + itemLine.length + FOOTER_LENGTH > MAX_LENGTH) {
        const remaining = items.length - itemsAdded;
        if (remaining > 0) {
          section += `   ... +${remaining} more\n`;
        }
        break;
      }
      
      section += itemLine;
      itemsAdded++;
    }
    
    currentLength += section.length + 1; // +1 for newline
    return section + '\n';
  }
  
  // Add pending messages (limit to 10 items)
  message += addSection(
    '💬 *Pending Messages:*',
    pendingMessages.slice(0, 10),
    (item, num) => `   ${num}. ${item.participant_name || 'Unknown'}\n`
  );
  
  // Add pending connections (limit to 10 items)
  message += addSection(
    '🤝 *Pending Connections:*',
    pendingConnections.slice(0, 10),
    (item, num) => {
      const headline = item.headline ? ` - ${item.headline.substring(0, 35)}...` : '';
      return `   ${num}. ${item.name || 'Unknown'}${headline}\n`;
    }
  );
  
  // Add job matches (limit to 8 items)
  message += addSection(
    '💼 *Job Matches:*',
    jobMatches.slice(0, 8),
    (item, num) => `   ${num}. ${item.title || 'Unknown'} at ${item.company || 'Unknown'} (${item.match_score}%)\n`
  );
  
  // Add pending posts (limit to 8 items)
  message += addSection(
    '📝 *Pending Posts:*',
    pendingPosts.slice(0, 8),
    (item, num) => {
      const topic = item.topic || '(based on profile)';
      const preview = item.draft_text ? ` - ${item.draft_text.substring(0, 25)}...` : '';
      return `   ${num}. ${topic}${preview}\n`;
    }
  );
  
  // Add footer with instructions
  const footer = `💡 Reply 'approve <name>' or 'skip <name>' to act on any item, or 'regenerate <name>' for a new draft - no need to open the dashboard.`;
  message += footer;
  
  // Final safety check
  if (message.length > MAX_LENGTH) {
    console.warn(`Warning: Message length ${message.length} exceeds ${MAX_LENGTH}, truncating...`);
    message = message.substring(0, MAX_LENGTH - 3) + '...';
  }
  
  console.log(`\nMessage length: ${message.length}/${MAX_LENGTH} characters`);
  
  return message;
}

async function sendViaTwilio(message) {
  const twilio = require('twilio');
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  try {
    const result = await client.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: TWILIO_WHATSAPP_TO,
      body: message
    });

    console.log(`✓ Message sent successfully! SID: ${result.sid}`);
    return true;
  } catch (error) {
    console.error('Error sending via Twilio:', error);
    return false;
  }
}

async function sendDigest() {
  try {
    // Step 1: Check if dashboard is active
    console.log('Checking dashboard presence...');
    const presence = await checkDashboardPresence();
    
    if (presence.online) {
      console.log('✓ Dashboard is active, skipping WhatsApp digest');
      console.log(`  Last active: ${presence.minutesAgo} minutes ago`);
      await pool.end();
      process.exit(0);
    }
    
    console.log('✓ Dashboard is inactive, proceeding with digest');
    console.log(`  Last active: ${presence.minutesAgo} minutes ago`);

    // Step 2: Get digest data
    console.log('\nFetching digest data...');
    const digestData = await getDigestData();
    
    if (!digestData) {
      console.error('Failed to fetch digest data');
      await pool.end();
      process.exit(1);
    }

    // Step 3: Build message
    const message = buildDigestMessage(digestData);
    
    if (!message) {
      console.log('✓ No pending items, skipping digest');
      await pool.end();
      process.exit(0);
    }

    console.log('\nDigest message:');
    console.log(message);

    // Step 4: Check Twilio credentials
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !TWILIO_WHATSAPP_TO) {
      console.log('\n⚠️  Twilio credentials not fully configured in .env');
      console.log('Required variables:');
      console.log('  - TWILIO_ACCOUNT_SID');
      console.log('  - TWILIO_AUTH_TOKEN');
      console.log('  - TWILIO_WHATSAPP_FROM');
      console.log('  - TWILIO_WHATSAPP_TO');
      console.log('\nDigest prepared but not sent.');
      await pool.end();
      process.exit(0);
    }

    // Step 5: Send via Twilio
    console.log('\nSending via Twilio...');
    const sent = await sendViaTwilio(message);
    
    await pool.end();
    
    if (sent) {
      console.log('\n✓ Digest sent successfully!');
      process.exit(0);
    } else {
      console.log('\n✗ Failed to send digest');
      process.exit(1);
    }

  } catch (error) {
    console.error('Error in sendDigest:', error);
    await pool.end();
    process.exit(1);
  }
}

// Run the digest
sendDigest();