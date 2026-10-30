import type { ChatRecord, CustomerTimelineEntry, ImportRecord, TranscriptRecord, WeChatJob, WeChatSession, WeChatStatus } from '../types';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8765';

async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs = 2000): Promise<T | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export type Health = { status: string; service: string; mode: string; version: string };

export async function getHealth(): Promise<Health | null> {
  return fetchJson<Health>('/api/health', undefined, 1200);
}

export async function fetchImports(): Promise<ImportRecord[] | null> {
  return fetchJson<ImportRecord[]>('/api/imports', undefined, 2200);
}

export async function createImport(payload: {
  fileName: string;
  type: string;
  size: string;
  customer: string;
  project: string;
  kind?: string;
  audioBase64?: string;
  mimeType?: string;
}): Promise<{ id: string; status: string; duplicate?: boolean } | null> {
  return fetchJson('/api/imports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function pasteImport(text: string): Promise<{ id: string; status: string } | null> {
  return fetchJson('/api/imports/paste', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function fetchTranscript(id: string): Promise<TranscriptRecord | null> {
  return fetchJson<TranscriptRecord>(`/api/transcripts/${encodeURIComponent(id)}`, undefined, 2200);
}

export async function fetchChat(id: string): Promise<ChatRecord | null> {
  return fetchJson<ChatRecord>(`/api/chats/${encodeURIComponent(id)}`, undefined, 2200);
}

export async function updateChatParticipants(id: string, participants: Array<{ name: string; role: 'me' | 'customer' }>): Promise<ChatRecord | null> {
  return fetchJson<ChatRecord>(`/api/chats/${encodeURIComponent(id)}/participants`, {
    method: 'PATCH',
    body: JSON.stringify({ participants }),
  });
}

export async function fetchCustomerTimeline(customer: string): Promise<{ customer: string; records: CustomerTimelineEntry[] } | null> {
  return fetchJson(`/api/customers/${encodeURIComponent(customer)}/timeline`, undefined, 3000);
}

export async function getWechatStatus(): Promise<WeChatStatus | null> {
  return fetchJson<WeChatStatus>('/api/wechat/status', undefined, 60000);
}

export async function getWechatSessions(account: string, limit = 400): Promise<{ sessions: WeChatSession[]; total?: number } | null> {
  return fetchJson(`/api/wechat/sessions?account=${encodeURIComponent(account)}&limit=${limit}`, undefined, 60000);
}

export async function previewWechatMessages(
  account: string,
  username: string,
  startDate = '',
  endDate = '',
  types: string[] = [],
): Promise<{ total: number; messages: Array<{ id: string; sender: string; sentAt: string; content: string }> } | null> {
  const params = new URLSearchParams({ account, username, startDate, endDate, types: types.join(',') });
  return fetchJson(`/api/wechat/messages?${params.toString()}`, undefined, 120000);
}

export async function importWechatChat(payload: {
  account: string;
  username: string;
  startDate?: string;
  endDate?: string;
  types?: string[];
  customer?: string;
  project?: string;
}): Promise<WeChatJob | null> {
  return fetchJson<WeChatJob>('/api/wechat/import', { method: 'POST', body: JSON.stringify(payload) }, 30000);
}

export async function getWechatImportStatus(): Promise<WeChatJob | null> {
  return fetchJson<WeChatJob>('/api/wechat/import/status', undefined, 5000);
}

export async function startWechatPrepare(): Promise<WeChatJob | null> {
  return fetchJson<WeChatJob>('/api/wechat/prepare', { method: 'POST', body: JSON.stringify({}) }, 30000);
}

export async function getWechatPrepareStatus(): Promise<WeChatJob | null> {
  return fetchJson<WeChatJob>('/api/wechat/prepare/status', undefined, 5000);
}

export async function createChatImport(text: string, meta?: { fileName?: string; customer?: string; project?: string }): Promise<{ id: string; status: string; chatId?: string; messageCount?: number } | null> {
  return fetchJson('/api/imports/chat', {
    method: 'POST',
    body: JSON.stringify({ text, ...meta }),
  });
}

export async function createChatScreenshot(
  imageBase64: string,
  mimeType: string,
  fileName: string,
  meta?: { customer?: string; project?: string },
): Promise<{ id: string; status: string; chatId?: string; messageCount?: number } | null> {
  return fetchJson(
    '/api/imports/chat-screenshot',
    { method: 'POST', body: JSON.stringify({ imageBase64, mimeType, fileName, ...meta }) },
    360000,
  );
}
