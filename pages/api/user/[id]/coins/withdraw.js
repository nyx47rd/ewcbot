import { db } from '../../../../../lib/db.js';

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

  // Handle preflight OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST', 'OPTIONS']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const { id } = req.query;
    const { amount } = req.body;

    if (!id || isNaN(parseInt(id, 10))) {
      return res.status(400).json({ error: 'A valid user ID must be provided.' });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'A valid, positive withdrawal amount must be provided.' });
    }

    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');
      const { rows: userRows } = await client.query('SELECT coins FROM users WHERE id = $1 FOR UPDATE', [id]);

      if (userRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found.' });
      }

      const currentCoins = userRows[0].coins;

      if (currentCoins < amount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient funds.', currentCoins });
      }

      const newCoins = currentCoins - amount;
      await client.query('UPDATE users SET coins = $1 WHERE id = $2', [newCoins, id]);

      await client.query('COMMIT');
      res.status(200).json({ success: true, message: 'Withdrawal successful.', newBalance: newCoins });

    } catch (txError) {
      await client.query('ROLLBACK');
      console.error(`Withdrawal Transaction Error for user ${id}:`, txError);
      res.status(500).json({ error: 'Internal Server Error during transaction.' });
    } finally {
      client.release();
    }
  } catch (handlerError) {
    console.error(`CRITICAL ERROR in /withdraw handler for user ${req.query.id}:`, handlerError);
    res.status(500).json({ error: 'Internal Server Error. Please check the logs.' });
  }
}
