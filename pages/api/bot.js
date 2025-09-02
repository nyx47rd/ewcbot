import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN;

// It's crucial to instantiate the bot outside of the handler to avoid
// creating a new instance on every request.
import { db } from '../../lib/db.js';

const bot = new TelegramBot(token);
const openRouterKey = process.env.OPENROUTER_KEY;

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

// This check ensures we only attach listeners once, which is important in a serverless environment
// where the module might be cached between invocations.
if (!bot.hasListeners) {
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(
        chatId,
        `Welcome to the Next.js Bot, ${msg.from.first_name}!\n\n/daily, /chance, /quiz`
      );
    });

    bot.onText(/\/daily/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        try {
            const { rows } = await db.query('SELECT last_daily_claim FROM users WHERE telegram_id = $1', [telegramId]);
            if (rows.length === 0) return bot.sendMessage(chatId, "Please log in first.");
            const user = rows[0];
            const now = new Date();
            const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim) : null;
            if (lastClaim && (now.getTime() - lastClaim.getTime()) < 24 * 60 * 60 * 1000) {
                const timeLeftMs = (lastClaim.getTime() + 24 * 60 * 60 * 1000) - now.getTime();
                const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
                return bot.sendMessage(chatId, `Already claimed. Try again in ${hours}h ${minutes}m.`);
            }
            const newBalance = await awardCoins(telegramId, 20, chatId);
            if (newBalance !== null) {
                await db.query('UPDATE users SET last_daily_claim = NOW() WHERE telegram_id = $1', [telegramId]);
                bot.sendMessage(chatId, `🎉 +20 coins! New balance: ${newBalance}.`);
            }
        } catch (error) {
            console.error("Error in /daily:", error);
            bot.sendMessage(chatId, "Error claiming daily bonus.");
        }
    });

    bot.onText(/\/chance/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        try {
            const { rows } = await db.query('SELECT chance_today, last_chance_date FROM users WHERE telegram_id = $1', [telegramId]);
            if (rows.length === 0) return bot.sendMessage(chatId, "Please log in first.");
            let user = rows[0];
            const now = new Date();
            const lastChance = user.last_chance_date ? new Date(user.last_chance_date) : null;
            if (!lastChance || lastChance.toDateString() !== now.toDateString()) {
                await db.query('UPDATE users SET chance_today = 0, last_chance_date = $1 WHERE telegram_id = $2', [now, telegramId]);
                user.chance_today = 0;
            }
            if (user.chance_today >= 3) return bot.sendMessage(chatId, "No chances left today.");
            const winnings = Math.floor(Math.random() * 20) + 1;
            const newBalance = await awardCoins(telegramId, winnings, chatId);
            if (newBalance !== null) {
                await db.query('UPDATE users SET chance_today = chance_today + 1, last_chance_date = NOW() WHERE telegram_id = $1', [telegramId]);
                bot.sendMessage(chatId, `✨ +${winnings} coins! New balance: ${newBalance}. You have ${2 - user.chance_today} chances left.`);
            }
        } catch (error) {
            console.error("Error in /chance:", error);
            bot.sendMessage(chatId, "Error with the chance game.");
        }
    });

    bot.onText(/\/quiz/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, "Generating a quiz...");
        const prompt = `Kullanıcıya 1 adet kısa bilgi sorusu üret. JSON formatında dön: { "question": "...", "options": ["A","B","C","D"], "answer": "A" }`;
        const response = await callOpenRouter(prompt, true);
        if (!response) return bot.sendMessage(chatId, "Could not create a quiz.");
        try {
            const quiz = JSON.parse(response);
            const correctAnswerIndex = quiz.options.findIndex(opt => opt.startsWith(quiz.answer));
            if (correctAnswerIndex === -1) throw new Error("Invalid answer in quiz response.");
            const sentMessage = await bot.sendMessage(chatId, `❓ **${quiz.question}**`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [quiz.options.map((option, index) => ({ text: option, callback_data: `quiz_${index}` }))]
                }
            });
            quizAnswers.set(sentMessage.message_id, correctAnswerIndex);
            setTimeout(() => quizAnswers.delete(sentMessage.message_id), 300000); // 5 min
        } catch (error) {
            console.error("Error parsing quiz:", error);
            bot.sendMessage(chatId, "Failed to create quiz from AI response.");
        }
    });

    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;
        const telegramId = callbackQuery.from.id;
        if (data.startsWith('quiz_')) {
            bot.answerCallbackQuery(callbackQuery.id);
            const selectedAnswerIndex = parseInt(data.split('_')[1], 10);
            const correctAnswerIndex = quizAnswers.get(msg.message_id);
            if (correctAnswerIndex === undefined) {
                return bot.editMessageText("Quiz expired or already answered.", { chat_id: chatId, message_id: msg.message_id, reply_markup: null });
            }
            quizAnswers.delete(msg.message_id);
            if (selectedAnswerIndex === correctAnswerIndex) {
                const newBalance = await awardCoins(telegramId, 15, chatId);
                if (newBalance !== null) {
                    bot.editMessageText(`✅ Correct! +15 coins. New balance: ${newBalance}.`, { chat_id: chatId, message_id: msg.message_id, reply_markup: null });
                }
            } else {
                bot.editMessageText(`❌ Wrong answer!`, { chat_id: chatId, message_id: msg.message_id, reply_markup: null });
            }
        }
    });

    bot.on('message', async (msg) => {
        if (msg.text && msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const userText = msg.text;
        const aiResponse = await callOpenRouter(`User asked: "${userText}"`);
        if (aiResponse) {
            bot.sendMessage(chatId, aiResponse);
            await awardCoins(telegramId, 10, chatId);
        } else {
            bot.sendMessage(chatId, "AI is not available right now.");
        }
    });
    bot.hasListeners = true;
}


export default async function handler(req, res) {
  // We need to ensure that this is a POST request from Telegram.
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // --- FIX: Stale Message Check ---
  // Ignore messages that are older than a few minutes (e.g., 5 minutes)
  // to prevent processing a backlog of stale updates after a downtime.
  const update = req.body;
  const message = update.message || update.callback_query?.message;

  if (message) {
    const messageTimestamp = message.date; // Unix timestamp in seconds
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const fiveMinutes = 5 * 60;

    if (currentTimestamp - messageTimestamp > fiveMinutes) {
      console.log(`Ignoring stale update (timestamp: ${messageTimestamp}).`);
      // Important: Still send a 200 OK to Telegram to clear the old update from the queue.
      return res.status(200).send('OK');
    }
  }
  // --- END OF FIX ---

  try {
    // Pass the request body to the bot instance for processing.
    bot.processUpdate(req.body);
  } catch (error) {
    console.error('Error processing Telegram update in Next.js handler:', error);
  }

  // Send a 200 OK response immediately to Telegram.
  res.status(200).send('OK');
}
