import { db } from '../../lib/db.js';
import 'dotenv/config';
import SHA256 from 'crypto-js/sha256.js';
import HmacSHA256 from 'crypto-js/hmac-sha256.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const query = req.query;

  if (!query.hash) {
    return res.status(400).json({ error: 'Bad Request: No hash provided.' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('FATAL: TELEGRAM_BOT_TOKEN is not set.');
    return res.status(500).json({ error: 'Internal Server Error: Bot token not configured.' });
  }

  try {
    // --- HASH VALIDATION WITH crypto-js ---
    const secretKey = SHA256(botToken);

    const dataCheckString = Object.keys(query)
      .filter(key => key !== 'hash')
      .sort()
      .map(key => `${key}=${query[key]}`)
      .join('\n');

    const hmac = HmacSHA256(dataCheckString, secretKey);
    const calculatedHash = hmac.toString(); // Defaults to hex

    if (calculatedHash !== query.hash) {
      console.error(`HASH MISMATCH with crypto-js. Calculated: ${calculatedHash}, Received: ${query.hash}`);
      return res.status(403).json({ error: 'Forbidden: Invalid hash (crypto-js).' });
    }
    // --- END OF HASH VALIDATION ---

    const { id: telegram_id, username, photo_url, auth_date, first_name } = query;

    const userQuery = `
      INSERT INTO users (telegram_id, username, photo_url, auth_date)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (telegram_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        photo_url = EXCLUDED.photo_url,
        auth_date = EXCLUDED.auth_date,
        updated_at = NOW()
      RETURNING id, telegram_id, username, photo_url, coins;
    `;
    const { rows } = await db.query(userQuery, [telegram_id, username, photo_url, auth_date]);
    const user = rows[0];

    const userPayload = {
      id: user.id,
      telegram_id: user.telegram_id,
      username: user.username,
      first_name: first_name,
      photo_url: user.photo_url,
      coins: user.coins
    };

    const encodedUser = Buffer.from(JSON.stringify(userPayload)).toString('base64');
    const frontendUrl = process.env.FRONTEND_URL;

    if (!frontendUrl) {
      console.error('FATAL: FRONTEND_URL is not set.');
      return res.status(500).json({ error: 'Internal Server Error: Frontend URL not configured.' });
    }

    res.redirect(302, `${frontendUrl}?user=${encodedUser}`);

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
