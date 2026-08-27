require('dotenv').config();
const pool = require('../db/db');
const { sendConnectionById } = require('./send-actions');
const { spawn } = require('child_process');
const twilio = require('twilio');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send WhatsApp notification
 */
async function sendWhatsAppNotification(message) {
  try {
    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to: `whatsapp:${process.env.TWILIO_WHATSAPP_TO}`,
      body: message
    });
    console.log('✓ WhatsApp notification sent');
  } catch (error) {
    console.error('Failed to send WhatsApp notification:', error.message);
  }
}

/**
 * Get date range for current period
 */
function getPeriodDateRange(period) {
  const now = new Date();
  let startDate;

  if (period === 'daily') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (period === 'weekly') {
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = start of week
    startDate = new Date(now);
    startDate.setDate(now.getDate() - diff);
    startDate.setHours(0, 0, 0, 0);
  } else {
    throw new Error(`Unknown period: ${period}`);
  }

  return { startDate, endDate: now };
}

/**
 * Run scraper to get more connection candidates
 */
async function runConnectionScraper() {
  return new Promise((resolve, reject) => {
    console.log('\n📥 Running connection scraper to get more candidates...');
    
    const scraper = spawn('node', ['src/scrapers/08-read-suggested-connections.js'], {
      cwd: process.cwd()
    });

    scraper.stdout.on('data', (data) => {
      console.log(`   ${data.toString().trim()}`);
    });

    scraper.stderr.on('data', (data) => {
      console.error(`   Error: ${data.toString().trim()}`);
    });

    scraper.on('close', (code) => {
      if (code === 0) {
        console.log('✓ Scraper completed\n');
        resolve();
      } else {
        reject(new Error(`Scraper exited with code ${code}`));
      }
    });
  });
}

/**
 * Main function: Fulfill connection target automatically
 */
async function fulfillConnectionTarget() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   AUTO CONNECTION TARGET FULFILLMENT (WITH WHATSAPP)       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // 1. Get target settings
    console.log('[1] Reading target settings...');
    const settingsResult = await pool.query(
      'SELECT target_connections_period, target_connections_count FROM target_settings LIMIT 1'
    );

    if (settingsResult.rows.length === 0) {
      console.log('❌ No settings found. Please configure targets in the target_settings table.');
      return;
    }

    const { target_connections_period, target_connections_count } = settingsResult.rows[0];
    
    if (!target_connections_count || target_connections_count === 0) {
      console.log('⚠️  Connection target is 0 or not set. Nothing to do.');
      return;
    }

    console.log(`    Target: ${target_connections_count} connections per ${target_connections_period}`);

    // 2. Count connections already sent in this period
    console.log('\n[2] Checking progress for current period...');
    const { startDate, endDate } = getPeriodDateRange(target_connections_period);
    
    console.log(`    Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`);
    
    const sentCountResult = await pool.query(
      `SELECT COUNT(*) as sent_count 
       FROM connections 
       WHERE sent = TRUE 
       AND sent_at >= $1 
       AND sent_at <= $2`,
      [startDate, endDate]
    );

    const sentCount = parseInt(sentCountResult.rows[0].sent_count);
    const remainingGap = target_connections_count - sentCount;

    console.log(`    Already sent: ${sentCount}/${target_connections_count}`);
    console.log(`    Remaining: ${remainingGap}`);

    if (remainingGap <= 0) {
      console.log('\n✓ Target already fulfilled for this period!');
      await sendWhatsAppNotification(
        `✓ Daily target already fulfilled!\n\n` +
        `${sentCount}/${target_connections_count} connections sent today.`
      );
      return;
    }

    // 3. Check available candidates
    console.log('\n[3] Checking available candidates...');
    let availableResult = await pool.query(
      `SELECT COUNT(*) as available_count 
       FROM connections 
       WHERE sent = FALSE AND dismissed = FALSE`
    );

    let availableCount = parseInt(availableResult.rows[0].available_count);
    console.log(`    Available: ${availableCount} candidates`);

    // If not enough candidates, run scraper
    if (availableCount < remainingGap) {
      console.log(`    ⚠️  Need ${remainingGap - availableCount} more candidates`);
      
      await sendWhatsAppNotification(
        `⚠️ Not enough connection candidates!\n\n` +
        `Need: ${remainingGap}\nAvailable: ${availableCount}\n\nRunning scraper...`
      );
      
      try {
        await runConnectionScraper();
        
        // Re-check available count
        availableResult = await pool.query(
          `SELECT COUNT(*) as available_count 
           FROM connections 
           WHERE sent = FALSE AND dismissed = FALSE`
        );
        availableCount = parseInt(availableResult.rows[0].available_count);
        console.log(`    Available after scraping: ${availableCount} candidates`);
      } catch (error) {
        console.error('    ❌ Scraper failed:', error.message);
        console.log('    Continuing with available candidates...');
      }
    }

    // 4. Select candidates (oldest first)
    const limit = Math.min(remainingGap, availableCount);
    
    if (limit === 0) {
      console.log('\n❌ No candidates available to send. Exiting.');
      await sendWhatsAppNotification(
        `❌ Cannot fulfill target!\n\nNo connection candidates available.`
      );
      return;
    }

    console.log(`\n[4] Selecting ${limit} candidates (oldest first)...`);
    
    const candidatesResult = await pool.query(
      `SELECT id, name, profile_url 
       FROM connections 
       WHERE sent = FALSE AND dismissed = FALSE
       ORDER BY created_at ASC 
       LIMIT $1`,
      [limit]
    );

    const candidates = candidatesResult.rows;
    console.log(`    ✓ Selected ${candidates.length} candidates\n`);

    // Send start notification
    await sendWhatsAppNotification(
      `🚀 Starting auto-connection campaign!\n\n` +
      `Sending ${candidates.length} connection requests...`
    );

    // 5. Send connection requests (NO NOTES - using existing behavior)
    console.log('[5] Sending connection requests (no notes)...\n');
    console.log('═'.repeat(60));
    
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const progress = `[${i + 1}/${candidates.length}]`;
      
      console.log(`\n${progress} 👤 ${candidate.name}`);
      console.log(`    🔗 ${candidate.profile_url}`);

      try {
        // Call existing sendConnectionById - it already sends without note
        const result = await sendConnectionById(candidate.id);

        if (result.success) {
          successCount++;
          console.log(`    ✅ SUCCESS: ${result.message}`);

          // Send WhatsApp notification for each success
          const newTotal = sentCount + successCount;
          await sendWhatsAppNotification(
            `✓ Connection sent to ${candidate.name}\n\n` +
            `Progress: ${newTotal}/${target_connections_count} (${target_connections_period})`
          );
        } else {
          failCount++;
          console.log(`    ❌ FAILED: ${result.message}`);
        }

      } catch (error) {
        failCount++;
        console.error(`    ❌ ERROR: ${error.message}`);
      }

      // Delay between sends (3-5 seconds)
      if (i < candidates.length - 1) {
        const delay = 3000 + Math.random() * 2000;
        console.log(`    ⏳ Waiting ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
      }
    }

    // 6. Summary
    console.log('\n═'.repeat(60));
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                         SUMMARY                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n  ✅ Successfully sent: ${successCount}`);
    console.log(`  ❌ Failed: ${failCount}`);
    console.log(`  📊 Total this ${target_connections_period}: ${sentCount + successCount}/${target_connections_count}`);

    if (sentCount + successCount >= target_connections_count) {
      console.log(`\n  🎯 TARGET FULFILLED!`);
      await sendWhatsAppNotification(
        `🎯 Target fulfilled!\n\n` +
        `✅ Sent: ${successCount}\n❌ Failed: ${failCount}\n\n` +
        `Total: ${sentCount + successCount}/${target_connections_count} this ${target_connections_period}.`
      );
    } else {
      const remaining = target_connections_count - (sentCount + successCount);
      console.log(`\n  ⚠️  Still need ${remaining} more to reach target.`);
      await sendWhatsAppNotification(
        `⚠️ Partial completion\n\n` +
        `✅ Sent: ${successCount}\n❌ Failed: ${failCount}\n\n` +
        `Still need ${remaining} more to reach ${target_connections_count}.`
      );
    }

    console.log('\n');

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
    await sendWhatsAppNotification(
      `❌ Auto-connection script failed!\n\n${error.message}`
    );
  } finally {
    await pool.end();
  }
}

// Run the script
if (require.main === module) {
  fulfillConnectionTarget().catch(console.error);
}

module.exports = { fulfillConnectionTarget };