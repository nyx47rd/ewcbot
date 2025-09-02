// api/bot.js (Geçici Test Kodu)
import 'dotenv/config';

export default async function handler(req, res) {
  console.log("--- TEST HANDLER INITIATED ---");
  console.log("Received Request Body:", JSON.stringify(req.body, null, 2));

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (req.body && req.body.message) {
    const chatId = req.body.message.chat.id;
    const text = "Test message from Vercel function. The connection is working!";
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      console.log(`Sending test message to chat ID: ${chatId}`);
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text }),
      });
      console.log("Test message sent successfully.");
    } catch (e) {
      console.error("Failed to send test message:", e);
    }
  }

  res.status(200).send('OK');
}
