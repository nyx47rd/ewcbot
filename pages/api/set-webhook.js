import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // It's safer to not expose VERCEL_URL publicly.
  // The admin should know the URL. We construct it here.
  const host = req.headers.host;
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const vercelUrl = `${protocol}://${host}`;

  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    const errorMessage = 'TELEGRAM_BOT_TOKEN environment variable must be set.';
    console.error(errorMessage);
    return res.status(500).json({ success: false, error: errorMessage });
  }

  const webhookUrl = `${vercelUrl}/api/bot`;
  const bot = new TelegramBot(token);

  try {
    await bot.setWebHook(webhookUrl);
    console.log(`Webhook set to: ${webhookUrl}`);
    res.status(200).json({
      success: true,
      message: `Webhook successfully set to ${webhookUrl}`,
    });
  } catch (error) {
    console.error('Error setting webhook:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to set webhook.',
      details: error.message,
    });
  }
}
