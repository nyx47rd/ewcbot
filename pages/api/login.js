// --- TEMPORARY DEBUGGING CODE ---
// This file is temporarily modified to log the entire hash generation process.
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  console.log("--- LOGIN ATTEMPT RECEIVED ---");

  const query = req.query;

  if (!query.hash) {
    console.log("DEBUG: Request is missing 'hash' parameter.");
    return res.status(400).json({ error: 'Bad Request: No hash provided.' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("FATAL DEBUG: TELEGRAM_BOT_TOKEN is not set in environment variables.");
    return res.status(500).json({ error: 'Internal Server Error: Bot token not configured.' });
  }

  // Log the received token (safely)
  console.log(`DEBUG: Bot token loaded. Starts with: "${botToken.substring(0, 8)}...", ends with: "...${botToken.substring(botToken.length - 4)}"`);

  // 1. Log the data-check-string
  const dataCheckString = Object.keys(query)
    .filter(key => key !== 'hash')
    .sort()
    .map(key => `${key}=${query[key]}`)
    .join('\n');
  console.log("DEBUG: Generated data-check-string:\n---\n" + dataCheckString + "\n---");

  // 2. Log the secret key
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  console.log(`DEBUG: Generated Secret Key (SHA256 of token): ${secretKey.toString('hex')}`);

  // 3. Log the final calculated HMAC hash
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  console.log(`DEBUG: Calculated HMAC hash: ${hmac}`);

  // 4. Log the hash received from Telegram
  console.log(`DEBUG: Hash received from Telegram: ${query.hash}`);

  // 5. Compare and log the result
  if (hmac !== query.hash) {
    console.error("DEBUG: HASH MISMATCH! The calculated hash does not match the one from Telegram.");
    return res.status(403).json({ error: 'Forbidden: Invalid hash. Please check Vercel logs for debugging details.' });
  }

  console.log("DEBUG: Hash validation successful! The token is correct.");
  // If validation passes, we just send a success message for this test.
  // The original logic is commented out below.
  return res.status(200).json({ success: true, message: "Hash validation passed. This is a temporary debug endpoint." });

  /* --- ORIGINAL CODE ---
  // ... (The original database and redirect logic would go here)
  */
}
