import { db } from '../../lib/db.js';
import 'dotenv/config';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // --- NEW HASH VALIDATION (RAW VALUES) ---
  // We use req.url to get the raw, encoded query string, as this might be
  // how Telegram's servers build the hash string.
  const queryString = req.url.split('?')[1];
  if (!queryString) {
    return res.status(400).json({ error: 'Bad Request: Query string is empty.' });
  }

  const params = new URLSearchParams(queryString);
  const receivedHash = params.get('hash');

  if (!receivedHash) {
    return res.status(400).json({ error: 'Bad Request: No hash provided in query.' });
  }

  const dataCheckArr = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') {
      dataCheckArr.push(`${key}=${value}`);
    }
  }

  // Sort the array of "key=value" strings alphabetically.
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
    console.error(`HASH MISMATCH (RAW). Calculated: ${calculatedHash}, Received: ${receivedHash}`);
    console.error(`Data-check-string used: \n${dataCheckString}`);
    return res.status(403).json({ error: 'Forbidden: Invalid hash (raw check failed).' });
  }
  // --- END OF HASH VALIDATION ---

  // If the hash is valid, we can now safely use the decoded values from req.query
  const { id: telegram_id, username, photo_url, auth_date, first_name } = req.query;

  try {
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
    console.error('Error during login database operation:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
