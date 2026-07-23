/**
 * Test script - confirms the database connection works before we wire
 * it into the actual scrapers.
 *
 * Run with: node src/db/test-connection.js
 */

const pool = require('./db');

async function main() {
  console.log('Testing database connection...');

  try {
    const result = await pool.query('SELECT NOW() AS current_time');
    console.log('✅ Connected successfully!');
    console.log('Database server time:', result.rows[0].current_time);

    // Check if our tables exist yet
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('conversations', 'messages', 'drafted_replies')
    `);

    const foundTables = tableCheck.rows.map((r) => r.table_name);
    console.log('\nTables found:', foundTables.length > 0 ? foundTables : 'none yet');

    if (foundTables.length < 3) {
      console.log('\n⚠️  Not all expected tables exist yet.');
      console.log('Run the schema.sql file in Supabase\'s SQL Editor first:');
      console.log('  1. Go to your Supabase project dashboard');
      console.log('  2. Click "SQL Editor" in the left sidebar');
      console.log('  3. Click "New query"');
      console.log('  4. Paste the contents of src/db/schema.sql');
      console.log('  5. Click "Run"');
    } else {
      console.log('\n✅ All expected tables exist. Database is ready to use.');
    }
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('\nDouble check your DATABASE_URL in .env is correct.');
  } finally {
    await pool.end();
  }
}

main();
