/**
 * Database connection helper.
 *
 * Reads DATABASE_URL from .env and exposes a connection pool other
 * scripts can use to query Postgres (hosted on Supabase).
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'No DATABASE_URL found in .env. Add your Supabase connection string first.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
});

module.exports = pool;
