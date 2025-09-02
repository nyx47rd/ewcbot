import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import { db } from '../../lib/db.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const groqApiKey = process.env.GROQ_API_KEY;

// We instantiate the bot here, but we will not use its event listeners for the webhook.
// We only use its API methods (e.g., bot.sendMessage).
const bot = new TelegramBot(token);

// A Map to store answers for active quizzes.
const quizAnswers = new Map();

// --- Helper Functions ---

async function callAI(prompt, isJson = false) {
  if (!groqApiKey) {
    console.error("FATAL: GROQ_API_KEY is not set.");
    return null;
  }
  const body = {
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: prompt }],
  };
  if (isJson) {
    body.response_format = { type: "json_object" };
  }

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

// --- Logic Handlers for Each Command/Action ---

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
    `/quiz - Test your knowledge for coins.\n\n` +
    `**Withdrawals:**\n` +
    `To withdraw your coins, you must use the frontend application.\n\n` +
    `Simply chat with me to get AI responses and earn more coins!`;

  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
}

async function handleDaily(msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  const { rows } = await db.query('SELECT coins, last_daily_claim FROM users WHERE telegram_id = $1', [telegramId]);
  if (rows.length === 0) return bot.sendMessage(chatId, "Please log in via the website first to use commands.");

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
  await db.query('UPDATE users SET coins = $1, last_daily_claim = NOW() WHERE telegram_id = $2', [newBalance, telegramId]);
  await bot.sendMessage(chatId, `🎉 You received 20 coins! Your new balance is ${newBalance}.`);
}

async function handleChance(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const { rows } = await db.query('SELECT coins, chance_today, last_chance_date FROM users WHERE telegram_id = $1', [telegramId]);
    if (rows.length === 0) return bot.sendMessage(chatId, "Please log in via the website first.");

    let user = rows[0];
    const now = new Date();
    const lastChance = user.last_chance_date ? new Date(user.last_chance_date) : null;

    if (!lastChance || lastChance.toDateString() !== now.toDateString()) {
        user.chance_today = 0;
        await db.query('UPDATE users SET chance_today = 0, last_chance_date = $1 WHERE telegram_id = $2', [now, telegramId]);
    }

    if (user.chance_today >= 3) return bot.sendMessage(chatId, "You've used all your chances for today. Come back tomorrow!");

    const winnings = Math.floor(Math.random() * 20) + 1;
    const newBalance = user.coins + winnings;
    await db.query('UPDATE users SET coins = $1, chance_today = chance_today + 1, last_chance_date = NOW() WHERE telegram_id = $2', [newBalance, telegramId]);
    await bot.sendMessage(chatId, `✨ You won ${winnings} coins! Your new balance is ${newBalance}. You have ${2 - user.chance_today} chances left today.`);
}

async function handleQuiz(msg) {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, "Generating a quiz question for you...");

    const prompt = `Generate a short trivia question in English. Return ONLY a valid JSON object in the following format: { "question": "...", "options": ["A", "B", "C", "D"], "answer": "A" }`;
    const response = await callAI(prompt, true);

    if (!response) return bot.sendMessage(chatId, "Sorry, I couldn't create a quiz right now.");

    try {
        const quiz = JSON.parse(response);
        const correctAnswerIndex = quiz.options.findIndex(opt => opt.startsWith(quiz.answer));
        if (correctAnswerIndex === -1) throw new Error("AI returned invalid answer letter.");

        const sentMessage = await bot.sendMessage(chatId, `❓ **${quiz.question}**`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [quiz.options.map((option, index) => ({ text: option, callback_data: `quiz_${index}` }))]
            }
        });
        quizAnswers.set(sentMessage.message_id, correctAnswerIndex);
        setTimeout(() => quizAnswers.delete(sentMessage.message_id), 5 * 60 * 1000); // 5 min timeout
    } catch (error) {
        console.error("Error parsing quiz response:", error);
        await bot.sendMessage(chatId, "Sorry, I received a malformed quiz question. Please try again.");
    }
}

async function handleCallbackQuery(callbackQuery) {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const { id: telegramId } = callbackQuery.from;

    if (data.startsWith('quiz_')) {
        await bot.answerCallbackQuery(callbackQuery.id);
        const selectedAnswerIndex = parseInt(data.split('_')[1], 10);
        const correctAnswerIndex = quizAnswers.get(msg.message_id);

        if (correctAnswerIndex === undefined) {
            return bot.editMessageText("This quiz has expired or was already answered.", { chat_id: msg.chat.id, message_id: msg.message_id });
        }
        quizAnswers.delete(msg.message_id);

        if (selectedAnswerIndex === correctAnswerIndex) {
            const { rows } = await db.query('SELECT id, coins FROM users WHERE telegram_id = $1', [telegramId]);
            if (rows.length === 0) {
                return bot.editMessageText(`✅ Correct! To save your score and earn coins, please log in via the website first.`, { chat_id: msg.chat.id, message_id: msg.message_id });
            }
            const user = rows[0];
            const newBalance = user.coins + 15;
            await db.query('UPDATE users SET coins = $1 WHERE id = $2', [newBalance, user.id]);
            await bot.editMessageText(`✅ Correct! You earned 15 coins. Your new balance is ${newBalance}.`, { chat_id: msg.chat.id, message_id: msg.message_id });
        } else {
            await bot.editMessageText(`❌ Wrong answer! You earned 0 coins.`, { chat_id: msg.chat.id, message_id: msg.message_id });
        }
    }
}

async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const aiResponse = await callAI(`User asked: "${msg.text}"`);
    if (aiResponse) {
        await bot.sendMessage(chatId, aiResponse);
        const { rows } = await db.query('UPDATE users SET coins = coins + 10 WHERE telegram_id = $1 RETURNING coins', [telegramId]);
        if (rows.length === 0) {
            await bot.sendMessage(chatId, "(You'll start earning coins for chatting once you log in!)");
        }
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
    const message = update.message || update.callback_query?.message;
    if (message) {
      const messageTimestamp = message.date;
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (currentTimestamp - messageTimestamp > 300) { // 5 minutes
        console.log("Ignoring stale update.");
        return res.status(200).send('OK');
      }
    }

    // Route the update to the correct handler
    if (update.message?.text) {
      const text = update.message.text;
      if (text.startsWith('/start')) await handleStart(update.message);
      else if (text.startsWith('/daily')) await handleDaily(update.message);
      else if (text.startsWith('/chance')) await handleChance(update.message);
      else if (text.startsWith('/quiz')) await handleQuiz(update.message);
      else await handleTextMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error in main handler:", error);
    // We still send a 200 OK to Telegram to prevent it from resending the update.
    return res.status(200).send('OK');
  }
}
