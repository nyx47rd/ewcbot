import { db } from '../../../../lib/db.js';

const setCorsHeaders = (res) => {
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    res.setHeader('Access-Control-Allow-Origin', frontendUrl);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
};

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'OPTIONS']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { id } = req.query;

  if (!id || isNaN(parseInt(id, 10))) {
    return res.status(400).json({ error: 'A valid user ID must be provided.' });
  }

  try {
    const { rows } = await db.query('SELECT coins FROM users WHERE id = $1', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.status(200).json({ coins: rows[0].coins });

  } catch (error) {
    console.error(`Error fetching coins for user ${id}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
