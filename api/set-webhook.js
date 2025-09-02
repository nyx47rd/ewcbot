import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

/**
 * This endpoint is for manually setting the Telegram webhook.
 * Call this once from your browser after deploying to Vercel.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const vercelUrl = process.env.VERCEL_URL;

  if (!token || !vercelUrl) {
    const errorMessage = 'TELEGRAM_BOT_TOKEN and VERCEL_URL environment variables must be set.';
    console.error(errorMessage);
    return res.status(500).json({ success: false, error: errorMessage });
  }

  // The full URL for our bot's webhook
  const webhookUrl = `https://${vercelUrl}/api/bot`;

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
