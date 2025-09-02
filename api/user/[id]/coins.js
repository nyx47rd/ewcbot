import { db } from '../../../lib/db.js';

export default async function handler(req, res) {
  // Ensure this is a GET request
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
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

    const user = rows[0];
    res.status(200).json({ coins: user.coins });

  } catch (error) {
    console.error(`Error fetching coins for user ${id}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
