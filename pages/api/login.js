import { db } from '../../lib/db.js';
import 'dotenv/config';
import crypto from 'crypto';

export default async function handler(req, res) {
  // --- ROBUST ERROR HANDLING ---
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const queryString = req.url.split('?')[1];
    if (!queryString) {
      return res.status(400).json({ error: 'Bad Request: Query string is empty.' });
    }

    const pairs = queryString.split('&');
    const dataCheckArr = [];
    let receivedHash = '';

    for (const pair of pairs) {
      const eq_idx = pair.indexOf('=');
      if (eq_idx === -1) continue; // Skip if there is no '='
      const key = pair.substring(0, eq_idx);
      const value = pair.substring(eq_idx + 1);
      if (key === 'hash') {
        receivedHash = value;
      } else {
        dataCheckArr.push(pair);
      }
    }

    if (!receivedHash) {
      return res.status(400).json({ error: 'Bad Request: No hash provided in query.' });
    }

    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('FATAL: TELEGRAM_BOT_TOKEN is not set.');
      return res.status(500).json({ error: 'Internal Server Error: Bot token not configured.' });
    }

    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== receivedHash) {
      console.error(`HASH MISMATCH. Calculated: ${calculatedHash}, Received: ${receivedHash}`);
      return res.status(403).json({ error: 'Forbidden: Invalid hash.' });
    }

    const { id: telegram_id, username, photo_url, auth_date, first_name } = req.query;

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
    // This will catch any unexpected crash and log it, preventing a 502 error.
    console.error('CRITICAL ERROR in /api/login handler:', error);
    res.status(500).json({ error: 'Internal Server Error. Please check the logs.' });
  }
}
