import crypto from 'crypto';
import { db } from '../../lib/db.js';
import 'dotenv/config';

// In Next.js, the handler function is the default export.
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
    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const dataCheckString = Object.keys(query)
      .filter(key => key !== 'hash')
      .sort()
      .map(key => `${key}=${query[key]}`)
      .join('\n');

    const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (hmac !== query.hash) {
      return res.status(403).json({ error: 'Forbidden: Invalid hash.' });
    }

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

    // In Next.js API routes, we use res.redirect()
    res.redirect(302, `${frontendUrl}?user=${encodedUser}`);

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
