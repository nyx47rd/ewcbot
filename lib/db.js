import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export const db = {
  query: (text, params) => pool.query(text, params),
  pool: pool,
};

// Optional: A function to check the connection
export async function connectDb() {
  let client;
  try {
    client = await pool.connect();
    console.log('PostgreSQL connected successfully.');
  } catch (err) {
    console.error('Unable to connect to PostgreSQL:', err);
  } finally {
    if (client) {
      client.release();
    }
  }
}
