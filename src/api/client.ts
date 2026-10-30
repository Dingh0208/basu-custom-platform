import type { AppSettings, ChatRecord, CustomerProfile, CustomerProject, CustomerTimelineEntry, DashboardSummary, ImportRecord, LlmConfig, LlmModelsResult, ProjectListItem, RequirementItemRecord, TranscriptRecord, WeChatJob, WeChatSession, WeChatStatus } from '../types';

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

export async function deleteImport(id: string): Promise<{ deleted: string; customer?: string } | null> {
  return fetchJson(`/api/imports/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

export async function pasteImport(text: string, meta?: { project?: string; customer?: string }): Promise<{ id: string; status: string } | null> {
  return fetchJson('/api/imports/paste', {
    method: 'POST',
    body: JSON.stringify({ text, project: meta?.project, customer: meta?.customer }),
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

export async function reanalyzeChat(id: string): Promise<{ status: string; chatId: string } | null> {
  return fetchJson(`/api/chats/${encodeURIComponent(id)}/reanalyze`, { method: 'POST', body: '{}' });
}

export async function fetchLlmConfig(): Promise<LlmConfig | null> {
  return fetchJson<LlmConfig>('/api/settings/llm', undefined, 5000);
}

export async function saveLlmConfig(data: Partial<LlmConfig> & { apiKey?: string }): Promise<LlmConfig | null> {
  return fetchJson<LlmConfig>('/api/settings/llm', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function testLlmConfig(data: Partial<LlmConfig> & { apiKey?: string }): Promise<LlmModelsResult | null> {
  return fetchJson<LlmModelsResult>('/api/settings/llm/test', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function pullLlmModels(data: Partial<LlmConfig> & { apiKey?: string }): Promise<LlmModelsResult | null> {
  return fetchJson<LlmModelsResult>('/api/settings/llm/models', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCustomers(): Promise<CustomerProfile[] | null> {
  return fetchJson<CustomerProfile[]>('/api/customers', undefined, 5000);
}

export async function updateCustomer(name: string, data: Partial<CustomerProfile> & { tags?: string[] }): Promise<CustomerProfile | null> {
  return fetchJson<CustomerProfile>(`/api/customers/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function createCustomer(data: Partial<CustomerProfile> & { name: string }): Promise<CustomerProfile | null> {
  return fetchJson<CustomerProfile>('/api/customers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function mergeCustomers(source: string, target: string): Promise<CustomerProfile | null> {
  return fetchJson<CustomerProfile>('/api/customers/merge', {
    method: 'POST',
    body: JSON.stringify({ source, target }),
  });
}

export async function deleteCustomer(name: string): Promise<{ deleted: string; records: number } | null> {
  return fetchJson(`/api/customers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function fetchCustomerTimeline(customer: string): Promise<{ customer: string; records: CustomerTimelineEntry[] } | null> {
  return fetchJson(`/api/customers/${encodeURIComponent(customer)}/timeline`, undefined, 3000);
}

export async function fetchDashboard(): Promise<DashboardSummary | null> {
  return fetchJson<DashboardSummary>('/api/dashboard', undefined, 5000);
}

export async function fetchProjects(): Promise<ProjectListItem[] | null> {
  return fetchJson<ProjectListItem[]>('/api/projects', undefined, 5000);
}

export async function fetchAppSettings(): Promise<AppSettings | null> {
  return fetchJson<AppSettings>('/api/settings/app', undefined, 5000);
}

export async function saveAppSettings(data: Partial<AppSettings>): Promise<AppSettings | null> {
  return fetchJson<AppSettings>('/api/settings/app', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCustomerProjects(customer: string): Promise<CustomerProject[] | null> {
  return fetchJson<CustomerProject[]>(`/api/customers/${encodeURIComponent(customer)}/projects`, undefined, 3000);
}

export async function createCustomerProject(customer: string, data: Partial<CustomerProject>): Promise<CustomerProject | null> {
  return fetchJson<CustomerProject>(`/api/customers/${encodeURIComponent(customer)}/projects`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCustomerProject(projectId: string, data: Partial<CustomerProject>): Promise<CustomerProject | null> {
  return fetchJson<CustomerProject>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCustomerProject(projectId: string): Promise<{ deleted: string } | null> {
  return fetchJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export async function fetchCustomerRequirements(customer: string, project = ''): Promise<RequirementItemRecord[] | null> {
  const query = project ? `?project=${encodeURIComponent(project)}` : '';
  return fetchJson<RequirementItemRecord[]>(`/api/customers/${encodeURIComponent(customer)}/requirements${query}`, undefined, 4000);
}

export async function createCustomerRequirement(customer: string, data: Partial<RequirementItemRecord>): Promise<RequirementItemRecord | null> {
  return fetchJson<RequirementItemRecord>(`/api/customers/${encodeURIComponent(customer)}/requirements`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCustomerRequirement(requirementId: string, data: Partial<RequirementItemRecord>): Promise<RequirementItemRecord | null> {
  return fetchJson<RequirementItemRecord>(`/api/requirements/${encodeURIComponent(requirementId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCustomerRequirement(requirementId: string): Promise<{ deleted: string } | null> {
  return fetchJson(`/api/requirements/${encodeURIComponent(requirementId)}`, { method: 'DELETE' });
}

export async function mergeCustomerRequirements(targetId: string, sourceIds: string[]): Promise<RequirementItemRecord | null> {
  return fetchJson<RequirementItemRecord>('/api/requirements/merge', {
    method: 'POST',
    body: JSON.stringify({ targetId, sourceIds }),
  });
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
