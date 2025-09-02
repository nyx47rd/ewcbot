// --- TEMPORARY DEBUGGING CODE ---
// This file is temporarily modified to help debug the "Invalid hash" issue.
// It returns the data-check-string instead of performing a login.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const query = req.query;

  if (!query.hash) {
    return res.status(400).json({ error: 'Bad Request: No hash provided.' });
  }

  // Construct the data-check-string exactly as the real code would.
  const dataCheckString = Object.keys(query)
    .filter(key => key !== 'hash')
    .sort()
    .map(key => `${key}=${query[key]}`)
    .join('\n');

  // Instead of validating, we return the string for external validation.
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(200).send(
    "--- DEBUGGING OUTPUT ---\n\n" +
    "This is the 'data-check-string' my code generated from your login data.\n" +
    "Please use an online tool to verify this string against your bot token.\n\n" +
    "DATA-CHECK-STRING:\n" +
    "--------------------------------\n" +
    dataCheckString +
    "\n--------------------------------"
  );
}
