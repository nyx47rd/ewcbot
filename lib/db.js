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

export async function connectDb() {
  try {
    const client = await pool.connect();
    console.log('PostgreSQL connected');
    client.release();
  } catch (err) {
    console.error('Unable to connect to PostgreSQL:', err);
  }
}
