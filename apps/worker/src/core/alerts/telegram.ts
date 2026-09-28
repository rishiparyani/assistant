// Alerts to the owner's phone through their own Telegram bot (decision 2026-09-28).
// The bot token is a secret (TELEGRAM_BOT_TOKEN); the chat is found from the first
// message the owner sends the bot and kept in app_settings. Never logs the token.
import { getSetting, setSetting } from "../settings.ts";

type TelegramEnv = { DB: D1Database; TELEGRAM_BOT_TOKEN?: string };

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

/** The owner's chat with the bot: saved, or found from the bot's recent messages. */
export async function telegramChat(env: TelegramEnv): Promise<string | null> {
  const saved = await getSetting(env.DB, "telegram_chat_id");
  if (saved || !env.TELEGRAM_BOT_TOKEN) return saved;
  try {
    const res = await fetch(api(env.TELEGRAM_BOT_TOKEN, "getUpdates"));
    if (!res.ok) return null;
    const body = (await res.json()) as {
      result?: { message?: { chat?: { id: number; type: string } } }[];
    };
    const chat = body.result?.map((u) => u.message?.chat).find((c) => c?.type === "private");
    if (!chat) return null;
    await setSetting(env.DB, "telegram_chat_id", String(chat.id));
    return String(chat.id);
  } catch {
    return null;
  }
}

/** Sends a message; returns whether it went. */
export async function sendTelegram(env: TelegramEnv, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const chat = await telegramChat(env);
  if (!chat) return false;
  try {
    const res = await fetch(api(env.TELEGRAM_BOT_TOKEN, "sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.warn(`alerts: Telegram answered ${res.status}`);
    return res.ok;
  } catch (err) {
    console.warn("alerts: couldn't reach Telegram", err);
    return false;
  }
}
