import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;

// We are not setting webhook or polling here.
// Webhook will be set manually via the /api/set-webhook endpoint.
// Polling is not used for Vercel production.
import { db } from '../lib/db.js';

const bot = new TelegramBot(token);
const openRouterKey = process.env.OPENROUTER_KEY;

// In-memory store for quiz answers. Key: message_id, Value: correct_answer_index
// Note: In a stateless serverless environment, this is only suitable for short-lived quizzes.
// A more robust solution might use a database or a cache like Redis.
const quizAnswers = new Map();

// --- Helper Functions ---

async function callOpenRouter(prompt, isJson = false) {
  if (!openRouterKey) {
    console.error("FATAL: OPENROUTER_KEY is not set.");
    return null;
  }
  const body = {
    model: "openai/gpt-3.5-turbo",
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

async function awardCoins(telegram_id, amount, chatId) {
    try {
        const { rows } = await db.query(
            'UPDATE users SET coins = coins + $1 WHERE telegram_id = $2 RETURNING coins',
            [amount, telegram_id]
        );
        if (rows.length === 0) {
            bot.sendMessage(chatId, "You need to /login first to earn coins!");
            return null;
        }
        return rows[0]?.coins;
    } catch (error) {
        console.error(`Failed to award ${amount} coins to ${telegram_id}:`, error);
        bot.sendMessage(chatId, "An error occurred while updating your coin balance.");
        return null;
    }
}

// --- Bot Command Handlers ---

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `Welcome back, ${msg.from.first_name}!\n\nHere's what you can do:\n` +
    `/daily - Claim your daily bonus coins.\n` +
    `/chance - Try your luck to win some coins (3 times a day).\n` +
    `/quiz - Test your knowledge and earn coins.\n\n` +
    `Simply chat with me to get AI-powered responses and earn coins for every message!`
  );
});

bot.onText(/\/daily/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const { rows } = await db.query('SELECT last_daily_claim FROM users WHERE telegram_id = $1', [telegramId]);
        if (rows.length === 0) {
            return bot.sendMessage(chatId, "Please log in via the website first to use the bot features!");
        }
        const user = rows[0];

        const now = new Date();
        const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim) : null;

        if (lastClaim && (now.getTime() - lastClaim.getTime()) < 24 * 60 * 60 * 1000) {
            const timeLeftMs = (lastClaim.getTime() + 24 * 60 * 60 * 1000) - now.getTime();
            const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
            return bot.sendMessage(chatId, `You have already claimed your daily bonus. Please try again in ${hours}h ${minutes}m.`);
        }

        const newBalance = await awardCoins(telegramId, 20, chatId);
        if (newBalance !== null) {
            await db.query('UPDATE users SET last_daily_claim = NOW() WHERE telegram_id = $1', [telegramId]);
            bot.sendMessage(chatId, `🎉 You received 20 coins! Your new balance is ${newBalance}.`);
        }
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
        if (rows.length === 0) {
            return bot.sendMessage(chatId, "Please log in via the website first to use the bot features!");
        }
        let user = rows[0];

        const now = new Date();
        const lastChance = user.last_chance_date ? new Date(user.last_chance_date) : null;

        if (!lastChance || lastChance.toDateString() !== now.toDateString()) {
            await db.query('UPDATE users SET chance_today = 0, last_chance_date = $1 WHERE telegram_id = $2', [now, telegramId]);
            user.chance_today = 0;
        }

        if (user.chance_today >= 3) {
            return bot.sendMessage(chatId, "You've used all your chances for today. Come back tomorrow!");
        }

        const winnings = Math.floor(Math.random() * 20) + 1;
        const newBalance = await awardCoins(telegramId, winnings, chatId);
        if (newBalance !== null) {
            await db.query('UPDATE users SET chance_today = chance_today + 1, last_chance_date = NOW() WHERE telegram_id = $1', [telegramId]);
            bot.sendMessage(chatId, `✨ You won ${winnings} coins! Your new balance is ${newBalance}. You have ${2 - user.chance_today} chances left today.`);
        }
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
        setTimeout(() => quizAnswers.delete(sentMessage.message_id), 5 * 60 * 1000); // 5 min timeout
    } catch (error) {
        console.error("Error parsing quiz response:", error, "Response was:", response);
        bot.sendMessage(chatId, "Sorry, I received a malformed quiz question from the AI. Please try again.");
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    const telegramId = callbackQuery.from.id;

    if (data.startsWith('quiz_')) {
        bot.answerCallbackQuery(callbackQuery.id); // Acknowledge the press
        const selectedAnswerIndex = parseInt(data.split('_')[1], 10);
        const correctAnswerIndex = quizAnswers.get(msg.message_id);

        if (correctAnswerIndex === undefined) {
            return bot.editMessageText("This quiz has expired or was already answered.", {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: null
            });
        }

        quizAnswers.delete(msg.message_id);

        if (selectedAnswerIndex === correctAnswerIndex) {
            const newBalance = await awardCoins(telegramId, 15, chatId);
            if (newBalance !== null) {
                bot.editMessageText(`✅ Correct! You earned 15 coins. Your new balance is ${newBalance}.`, {
                    chat_id: chatId, message_id: msg.message_id, reply_markup: null
                });
            }
        } else {
            bot.editMessageText(`❌ Wrong answer! You earned 0 coins.`, {
                chat_id: chatId, message_id: msg.message_id, reply_markup: null
            });
        }
    }
});

bot.on('message', async (msg) => {
    // Ignore commands, which are handled by onText listeners
    if (msg.text && msg.text.startsWith('/')) {
        return;
    }

    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const userText = msg.text;

    // 1. Get AI response
    const aiResponse = await callOpenRouter(`User asked: "${userText}"`);
    if (aiResponse) {
        bot.sendMessage(chatId, aiResponse);
        // 2. Award coins
        await awardCoins(telegramId, 10, chatId);
    } else {
        bot.sendMessage(chatId, "Sorry, I couldn't process your message right now.");
    }
});


/**
 * This is the main webhook handler for Vercel.
 * It receives updates from Telegram and passes them to the bot instance for processing.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    // The 'node-telegram-bot-api' library will parse the update
    // and emit the appropriate events, which we will listen for.
    bot.processUpdate(req.body);
  } catch (error) {
    console.error('Error processing Telegram update:', error);
  }

  // Telegram requires an immediate 200 OK response to know we've received the update.
  // The bot logic will continue to process in the background.
  res.status(200).send('OK');
}
