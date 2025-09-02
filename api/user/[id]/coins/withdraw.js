import { db } from '../../../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { id } = req.query;
  // Vercel automatically parses JSON bodies for POST requests
  const { amount } = req.body;

  if (!id || isNaN(parseInt(id, 10))) {
    return res.status(400).json({ error: 'A valid user ID must be provided.' });
  }

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'A valid, positive withdrawal amount must be provided in the request body.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the row for update to prevent race conditions
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

    // In a real app, you would also record this withdrawal in a separate transactions table.

    await client.query('COMMIT');

    res.status(200).json({ success: true, message: 'Withdrawal successful.', newBalance: newCoins });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error during withdrawal for user ${id}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    // Make sure to release the client back to the pool
    client.release();
  }
}
