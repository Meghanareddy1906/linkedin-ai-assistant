const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

/**
 * GET /api/status/linkedin
 * Check LinkedIn authentication status
 */
router.get('/linkedin', (req, res) => {
  try {
    const authFilePath = path.join(process.cwd(), 'data', 'auth.json');
    
    // Check if file exists
    if (!fs.existsSync(authFilePath)) {
      return res.json({
        connected: false,
        status: 'not_connected',
        message: 'No authentication file found. Please run the login script.',
        lastLogin: null
      });
    }

    // Get file modification time
    const stats = fs.statSync(authFilePath);
    const lastModified = new Date(stats.mtime);
    const now = new Date();
    const daysSinceModified = Math.floor((now - lastModified) / (1000 * 60 * 60 * 24));

    // Check if within 7 days
    if (daysSinceModified <= 7) {
      return res.json({
        connected: true,
        status: 'connected',
        message: 'Connected',
        lastLogin: lastModified.toISOString(),
        daysAgo: daysSinceModified
      });
    } else {
      return res.json({
        connected: false,
        status: 'expired',
        message: 'Session may be expired - please re-run the login script',
        lastLogin: lastModified.toISOString(),
        daysAgo: daysSinceModified
      });
    }

  } catch (error) {
    console.error('Error checking LinkedIn status:', error);
    res.status(500).json({
      connected: false,
      status: 'error',
      message: 'Error checking authentication status',
      error: error.message
    });
  }
});

/**
 * GET /api/status/whatsapp
 * Check WhatsApp/Twilio configuration status
 */
router.get('/whatsapp', (req, res) => {
  try {
    const requiredVars = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM,
      TWILIO_WHATSAPP_TO: process.env.TWILIO_WHATSAPP_TO
    };

    const missingVars = [];
    const setVars = [];

    for (const [key, value] of Object.entries(requiredVars)) {
      if (!value || value.trim() === '') {
        missingVars.push(key);
      } else {
        setVars.push(key);
      }
    }

    if (missingVars.length === 0) {
      return res.json({
        connected: true,
        status: 'connected',
        message: 'Connected',
        configuredVars: setVars
      });
    } else {
      return res.json({
        connected: false,
        status: 'not_configured',
        message: `Not configured. Missing: ${missingVars.join(', ')}`,
        missingVars,
        configuredVars: setVars
      });
    }

  } catch (error) {
    console.error('Error checking WhatsApp status:', error);
    res.status(500).json({
      connected: false,
      status: 'error',
      message: 'Error checking WhatsApp configuration',
      error: error.message
    });
  }
});

module.exports = router;