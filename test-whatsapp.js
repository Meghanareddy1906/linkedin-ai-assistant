require('dotenv').config();
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

client.messages.create({
  from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
  to: `whatsapp:${process.env.TWILIO_WHATSAPP_TO}`,
  body: '✅ Test notification from LinkedIn Assistant!'
})
.then(msg => console.log('✓ Message sent:', msg.sid))
.catch(err => console.error('❌ Error:', err.message));