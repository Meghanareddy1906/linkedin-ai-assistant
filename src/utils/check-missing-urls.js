require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkMissingUrls() {
  try {
    const result = await pool.query(`
      SELECT id, name, profile_url, created_at
      FROM connections 
      WHERE profile_url IS NULL OR profile_url = ''
      ORDER BY created_at DESC
    `);

    console.log(`\nFound ${result.rows.length} connections without profile URLs:\n`);
    
    result.rows.forEach(conn => {
      console.log(`  ID: ${conn.id} | Name: ${conn.name} | Created: ${new Date(conn.created_at).toLocaleDateString()}`);
    });

    if (result.rows.length > 0) {
      console.log(`\nOptions:`);
      console.log(`1. Delete these ${result.rows.length} connections (can't be auto-sent anyway)`);
      console.log(`2. Keep them and connect manually via LinkedIn search`);
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
}

checkMissingUrls();