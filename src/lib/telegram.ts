// Booking alerts via a Telegram bot. Set TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (your chat).
import cfg from './config';

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

export interface TelegramChat {
  id: number;
  name: string;
}

interface TelegramReply<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

// The token is part of the URL, so errors below never include the URL itself
async function call<T>(method: string, body?: unknown): Promise<TelegramReply<T>> {
  const res = await fetch(`${cfg.telegramApiUrl}/bot${cfg.telegramBotToken}/${method}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as TelegramReply<T>;
  if (!res.ok || !data.ok) return { ok: false, description: data.description || `HTTP ${res.status}` };
  return data;
}

export function telegramReady(): boolean {
  return !!(cfg.telegramBotToken && cfg.telegramChatId);
}

export async function sendTelegram(text: string): Promise<TelegramResult> {
  if (!cfg.telegramBotToken) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' };
  if (!cfg.telegramChatId) return { ok: false, error: 'TELEGRAM_CHAT_ID is not set' };
  try {
    const r = await call('sendMessage', { chat_id: cfg.telegramChatId, text, disable_web_page_preview: true });
    return r.ok ? { ok: true } : { ok: false, error: r.description };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Who has messaged the bot recently: used once during setup to find your chat ID
export async function recentChats(): Promise<{ chats: TelegramChat[]; error?: string }> {
  if (!cfg.telegramBotToken) return { chats: [], error: 'TELEGRAM_BOT_TOKEN is not set' };
  type Update = { message?: { chat: { id: number; first_name?: string; last_name?: string; title?: string; username?: string } } };
  try {
    const r = await call<Update[]>('getUpdates');
    if (!r.ok) return { chats: [], error: r.description };
    const seen = new Map<number, TelegramChat>();
    for (const u of r.result ?? []) {
      const c = u.message?.chat;
      if (!c) continue;
      const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || 'unknown';
      seen.set(c.id, { id: c.id, name });
    }
    return { chats: [...seen.values()] };
  } catch (e) {
    return { chats: [], error: e instanceof Error ? e.message : String(e) };
  }
}
