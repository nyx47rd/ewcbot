import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import { db } from '../../lib/db.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const groqApiKey = process.env.GROQ_API_KEY;
const frontendUrl = process.env.FRONTEND_URL;

const bot = new TelegramBot(token);

// --- Helper Functions ---

async function callAIWithMemory(userId, prompt) {
  if (!groqApiKey) {
    console.error("FATAL: GROQ_API_KEY is not set.");
    return null;
  }
  const historyQuery = `
    SELECT role, content FROM message_history
    WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10;
  `;
  const { rows: historyRows } = await db.query(historyQuery, [userId]);
  const conversationHistory = historyRows.reverse();
  const messages = conversationHistory.map(row => ({ role: row.role, content: row.content }));
  messages.push({ role: "user", content: prompt });

  const body = { model: "openai/gpt-oss-20b", messages: messages };

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqApiKey}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Groq API error: ${response.status} ${errorBody}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling Groq API:", error);
    return null;
  }
}

// --- Logic Handlers ---

async function handleStart(msg) {
  const { id: telegramId, first_name } = msg.from;
  const chatId = msg.chat.id;

  const { rows } = await db.query('SELECT coins FROM users WHERE telegram_id = $1', [telegramId]);
  const coins = rows.length > 0 ? rows[0].coins : 0;

  const welcomeMessage = `Welcome, ${first_name}!\n\n` +
    `You currently have: **${coins} coins**.\n\n` +
    `**Commands:**\n` +
    `/daily - Claim your daily bonus.\n` +
    `/chance - Try your luck (3 times a day).\n` +
    `/sync - Refresh your balance in the web app.\n\n` +
    `**Withdrawals:**\n` +
    `To withdraw your coins, you must use the web application.\n\n` +
    `Simply chat with me to get AI responses and earn more coins!`;

  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
}

async function handleDaily(msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  const { rows } = await db.query('SELECT id, coins, last_daily_claim FROM users WHERE telegram_id = $1', [telegramId]);
  if (rows.length === 0) return bot.sendMessage(chatId, "Please log in via the web app first to use commands.");

  const user = rows[0];
  const now = new Date();
  const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim) : null;

  if (lastClaim && (now.getTime() - lastClaim.getTime()) < 24 * 60 * 60 * 1000) {
    const timeLeftMs = (lastClaim.getTime() + 24 * 60 * 60 * 1000) - now.getTime();
    const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
    return bot.sendMessage(chatId, `You have already claimed your daily bonus. Please try again in ${hours}h ${minutes}m.`);
  }

  const newBalance = user.coins + 20;
  await db.query('UPDATE users SET coins = $1, last_daily_claim = NOW() WHERE id = $2', [newBalance, user.id]);
  await bot.sendMessage(chatId, `🎉 You received 20 coins! Your new balance is ${newBalance}.`);
}

async function handleChance(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const { rows } = await db.query('SELECT id, coins, chance_today, last_chance_date FROM users WHERE telegram_id = $1', [telegramId]);
    if (rows.length === 0) return bot.sendMessage(chatId, "Please log in via the web app first.");

    let user = rows[0];
    const now = new Date();
    const lastChance = user.last_chance_date ? new Date(user.last_chance_date) : null;

    if (!lastChance || lastChance.toDateString() !== now.toDateString()) {
        user.chance_today = 0;
        await db.query('UPDATE users SET chance_today = 0, last_chance_date = $1 WHERE id = $2', [now, user.id]);
    }

    if (user.chance_today >= 3) return bot.sendMessage(chatId, "You've used all your chances for today. Come back tomorrow!");

    const winnings = Math.floor(Math.random() * 20) + 1;
    const newBalance = user.coins + winnings;
    await db.query('UPDATE users SET coins = $1, chance_today = chance_today + 1, last_chance_date = NOW() WHERE id = $2', [newBalance, user.id]);
    await bot.sendMessage(chatId, `✨ You won ${winnings} coins! Your new balance is ${newBalance}. You have ${2 - user.chance_today} chances left today.`);
}

async function handleSync(msg) {
    const chatId = msg.chat.id;
    const { id: telegramId, first_name, username } = msg.from;

    if (!frontendUrl) {
        console.error("FATAL: FRONTEND_URL is not set for /sync command.");
        return bot.sendMessage(chatId, "Error: The web app URL is not configured.");
    }

    const { rows } = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    if (rows.length === 0) return bot.sendMessage(chatId, "I don't have any data to sync. Please log in via the web app first.");

    const user = rows[0];
    const userPayload = {
      id: user.id,
      telegram_id: user.telegram_id,
      username: user.username,
      first_name: user.first_name,
      photo_url: user.photo_url,
      coins: user.coins
    };
    const encodedUser = Buffer.from(JSON.stringify(userPayload)).toString('base64');
    const syncUrl = `${frontendUrl}?user=${encodedUser}`;

    await bot.sendMessage(chatId, "Click the button below to refresh your coin balance in the web app.", {
        reply_markup: {
            inline_keyboard: [[{ text: "Refresh Balance", url: syncUrl }]]
        }
    });
}

async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const { rows: userRows } = await db.query('SELECT id, coins FROM users WHERE telegram_id = $1', [telegramId]);
    if (userRows.length === 0) {
        const aiResponse = await callAIWithMemory(null, msg.text);
        if (aiResponse) await bot.sendMessage(chatId, aiResponse);
        return bot.sendMessage(chatId, "(You'll start earning coins and I'll remember our chat once you log in!)");
    }
    const user = userRows[0];
    const userId = user.id;

    const aiResponse = await callAIWithMemory(userId, msg.text);

    if (aiResponse) {
        await bot.sendMessage(chatId, aiResponse);

        const historySaveQuery = `INSERT INTO message_history (user_id, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3);`;
        await db.query(historySaveQuery, [userId, msg.text, aiResponse]);

        const newBalance = user.coins + 10;
        await db.query('UPDATE users SET coins = $1 WHERE id = $2', [newBalance, userId]);
    } else {
        await bot.sendMessage(chatId, "Sorry, the AI is not available at the moment.");
    }
}

// --- Main Serverless Handler ---

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const update = req.body;
    const message = update.message;
    if (message) {
      const messageTimestamp = message.date;
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (currentTimestamp - messageTimestamp > 300) {
        return res.status(200).send('OK');
      }
    }

    if (update.message?.text) {
      const text = update.message.text;
      if (text.startsWith('/start')) await handleStart(update.message);
      else if (text.startsWith('/daily')) await handleDaily(update.message);
      else if (text.startsWith('/chance')) await handleChance(update.message);
      else if (text.startsWith('/sync')) await handleSync(update.message);
      else await handleTextMessage(update.message);
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error in main handler:", error);
    return res.status(200).send('OK');
  }
}
