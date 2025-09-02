import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// It's good practice to handle the case where the connection string is not provided.
if (!process.env.POSTGRES_URL) {
  throw new Error('FATAL: POSTGRES_URL environment variable is not set.');
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    // Vercel Postgres requires SSL but does not require you to provide a cert.
    rejectUnauthorized: false
  }
});

export const db = {
  query: (text, params) => pool.query(text, params),
  pool: pool,
};
