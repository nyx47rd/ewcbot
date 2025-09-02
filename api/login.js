import crypto from 'crypto';
import { db } from '../lib/db.js';
import 'dotenv/config';

// This is a Vercel serverless function.
// It handles the callback from the Telegram Login Widget.
export default async function handler(req, res) {
  // Use req.query since Vercel parses query string parameters for GET requests
  const query = req.query;

  if (!query.hash) {
    return res.status(400).send('Bad Request: No hash provided.');
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN is not set.');
    return res.status(500).send('Internal Server Error: Bot token not configured.');
  }

  try {
    // 1. Validate the hash
    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const dataCheckString = Object.keys(query)
      .filter(key => key !== 'hash')
      .sort()
      .map(key => `${key}=${query[key]}`)
      .join('\n');

    const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (hmac !== query.hash) {
      return res.status(403).send('Forbidden: Invalid hash.');
    }

    // 2. Data is authentic, process user information
    const { id: telegram_id, username, photo_url, auth_date } = query;

    // Check if auth_date is recent (e.g., within 24 hours) to prevent replay attacks
    const twentyFourHoursInSeconds = 86400;
    if (Date.now() / 1000 - parseInt(auth_date, 10) > twentyFourHoursInSeconds) {
        return res.status(403).send('Forbidden: Authentication data is outdated.');
    }

    // 3. Save or update user in the database
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

    // 4. Redirect to frontend with encoded user data
    const userPayload = {
      id: user.id,
      telegram_id: user.telegram_id,
      username: user.username,
      photo_url: user.photo_url,
      coins: user.coins
    };

    const encodedUser = Buffer.from(JSON.stringify(userPayload)).toString('base64');
    const frontendUrl = process.env.FRONTEND_URL || 'https://ewc.on.websim.com/';

    // Perform the redirect
    res.writeHead(302, { Location: `${frontendUrl}?user=${encodedUser}` });
    res.end();

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).send('Internal Server Error');
  }
}
