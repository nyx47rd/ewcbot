import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import { db } from '../lib/db.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const vercelUrl = process.env.VERCEL_URL;
const openRouterKey = process.env.OPENROUTER_KEY;

let bot;

if (process.env.NODE_ENV === 'production') {
  bot = new TelegramBot(token);
  bot.setWebHook(`https://${vercelUrl}/api/bot`);
} else {
  bot = new TelegramBot(token, { polling: true });
}

console.log(`Bot server started in ${process.env.NODE_ENV || 'development'} mode...`);

// In-memory store for quiz answers. Key: message_id, Value: correct_answer_index
const quizAnswers = new Map();

// --- Helper Functions ---

async function callOpenRouter(prompt, isJson = false) {
  const body = {
    model: "openai/gpt-3.5-turbo", // Using a standard model
    messages: [{ role: "user", content: prompt }],
  };
  if (isJson) {
      body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${errorBody}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling OpenRouter:", error);
    return null;
  }
}

async function awardCoins(telegram_id, amount) {
    try {
        const { rows } = await db.query(
            'UPDATE users SET coins = coins + $1 WHERE telegram_id = $2 RETURNING coins',
            [amount, telegram_id]
        );
        return rows[0]?.coins;
    } catch (error) {
        console.error(`Failed to award ${amount} coins to ${telegram_id}:`, error);
        return null;
    }
}

// --- Bot Command Handlers ---

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `Welcome to the Coin Bot, ${msg.from.first_name}!\n\nHere's what you can do:\n` +
    `/daily - Claim your daily bonus coins.\n` +
    `/chance - Try your luck to win some coins (3 times a day).\n` +
    `/quiz - Test your knowledge and earn coins.\n` +
    `Just chat with me (I'm powered by AI!) and earn coins for every message!`
  );
});

bot.onText(/\/daily/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const { rows } = await db.query('SELECT last_daily_claim FROM users WHERE telegram_id = $1', [telegramId]);
        const user = rows[0];

        if (!user) {
            return bot.sendMessage(chatId, "I don't seem to know you. Please /start the bot or log in first.");
        }

        const now = new Date();
        const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim) : null;

        if (lastClaim && (now.getTime() - lastClaim.getTime()) < 24 * 60 * 60 * 1000) {
            const timeLeft = new Date(lastClaim.getTime() + 24 * 60 * 60 * 1000 - now.getTime());
            return bot.sendMessage(chatId, `You have already claimed your daily bonus. Please try again in ${timeLeft.getUTCHours()}h ${timeLeft.getUTCMinutes()}m.`);
        }

        const newBalance = await awardCoins(telegramId, 20);
        await db.query('UPDATE users SET last_daily_claim = NOW() WHERE telegram_id = $1', [telegramId]);

        bot.sendMessage(chatId, `🎉 You received 20 coins! Your new balance is ${newBalance}.`);

    } catch (error) {
        console.error("Error in /daily command:", error);
        bot.sendMessage(chatId, "Sorry, something went wrong while claiming your daily bonus.");
    }
});

bot.onText(/\/chance/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const { rows } = await db.query('SELECT chance_today, last_chance_date FROM users WHERE telegram_id = $1', [telegramId]);
        let user = rows[0];

        if (!user) {
            return bot.sendMessage(chatId, "I don't seem to know you. Please /start the bot or log in first.");
        }

        const now = new Date();
        const lastChance = user.last_chance_date ? new Date(user.last_chance_date) : null;

        // Reset chance counter if it's a new day
        if (!lastChance || lastChance.toDateString() !== now.toDateString()) {
            await db.query('UPDATE users SET chance_today = 0, last_chance_date = $1 WHERE telegram_id = $2', [now, telegramId]);
            user.chance_today = 0;
        }

        if (user.chance_today >= 3) {
            return bot.sendMessage(chatId, "You've used all your chances for today. Come back tomorrow!");
        }

        const winnings = Math.floor(Math.random() * 20) + 1;
        const newBalance = await awardCoins(telegramId, winnings);
        await db.query('UPDATE users SET chance_today = chance_today + 1, last_chance_date = NOW() WHERE telegram_id = $1', [telegramId]);

        bot.sendMessage(chatId, `✨ You won ${winnings} coins! Your new balance is ${newBalance}. You have ${2 - user.chance_today} chances left today.`);

    } catch (error) {
        console.error("Error in /chance command:", error);
        bot.sendMessage(chatId, "Sorry, something went wrong with the chance game.");
    }
});

bot.onText(/\/quiz/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Generating a quiz question for you...");

    const prompt = `Kullanıcıya 1 adet kısa bilgi sorusu üret. JSON formatında dön: { "question": "...", "options": ["A","B","C","D"], "answer": "A" }`;
    const response = await callOpenRouter(prompt, true);

    if (!response) {
        return bot.sendMessage(chatId, "Sorry, I couldn't create a quiz question right now. Please try again later.");
    }

    try {
        const quiz = JSON.parse(response);
        const correctAnswerIndex = quiz.options.findIndex(opt => opt.startsWith(quiz.answer));

        if (correctAnswerIndex === -1) throw new Error("AI returned invalid answer letter.");

        const sentMessage = await bot.sendMessage(chatId, `❓ **${quiz.question}**`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    quiz.options.map((option, index) => ({
                        text: option,
                        callback_data: `quiz_${index}`
                    }))
                ]
            }
        });

        quizAnswers.set(sentMessage.message_id, correctAnswerIndex);
        // Clean up the answer from memory after a while to prevent memory leaks
        setTimeout(() => quizAnswers.delete(sentMessage.message_id), 5 * 60 * 1000); // 5 minutes

    } catch (error) {
        console.error("Error parsing quiz response:", error, "Response was:", response);
        bot.sendMessage(chatId, "Sorry, I received a malformed quiz question from the AI. Please try again.");
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;

    if (data.startsWith('quiz_')) {
        const selectedAnswerIndex = parseInt(data.split('_')[1], 10);
        const correctAnswerIndex = quizAnswers.get(msg.message_id);

        if (correctAnswerIndex === undefined) {
            return bot.editMessageText("This quiz has expired or was already answered.", {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                reply_markup: null
            });
        }

        quizAnswers.delete(msg.message_id); // Answered, so remove it

        if (selectedAnswerIndex === correctAnswerIndex) {
            const newBalance = await awardCoins(callbackQuery.from.id, 15);
            bot.editMessageText(`✅ Correct! You earned 15 coins. Your new balance is ${newBalance}.`, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                reply_markup: null
            });
        } else {
            bot.editMessageText(`❌ Wrong answer! You earned 0 coins.`, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                reply_markup: null
            });
        }
        bot.answerCallbackQuery(callbackQuery.id);
    }
});

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) {
        return; // It's a command, handled by other listeners
    }

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const userText = msg.text;

    // 1. Get AI response
    const aiResponse = await callOpenRouter(`User asked: "${userText}"`);
    if (aiResponse) {
        bot.sendMessage(chatId, aiResponse);
        // 2. Award coins
        await awardCoins(telegramId, 10);
    } else {
        bot.sendMessage(chatId, "Sorry, I couldn't process your message right now.");
    }
});

// --- Vercel Serverless Function ---

// This is the webhook handler for Vercel.
export default async function handler(req, res) {
  try {
    // We pass the update to the bot instance to handle it.
    // The bot will emit the appropriate events ('message', 'callback_query', etc.)
    bot.processUpdate(req.body);
  } catch (error) {
    console.error('Error processing update:', error);
  }
  // We must send a 200 OK response to Telegram immediately
  res.status(200).send('OK');
}
