import type { AppSettings, ChatRecord, CustomerProfile, CustomerProject, CustomerTimelineEntry, DashboardSummary, ImportRecord, LlmConfig, LlmModelsResult, ProjectListItem, RequirementItemRecord, TaskRecord, TranscriptRecord, WeChatJob, WeChatSession, WeChatStatus } from '../types';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8765';

export async function fetchTodos(customer = '') {
  return fetchJson<import('../types').TodoRecord[]>(`/api/todos?customer=${encodeURIComponent(customer)}`, undefined, 5000);
}

export async function saveTodo(data: Partial<import('../types').TodoRecord>, id?: string) {
  return fetchJson<import('../types').TodoRecord>(id ? `/api/todos/${encodeURIComponent(id)}` : '/api/todos', {
    method: id ? 'PATCH' : 'POST', body: JSON.stringify(data),
  }, 5000);
}

export async function fetchFollowup(customer: string) {
  return fetchJson<import('../types').FollowupData>(`/api/customers/${encodeURIComponent(customer)}/followup`, undefined, 5000);
}

export async function searchAll(query: string) {
  return fetchJson<import('../types').SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`, undefined, 5000);
}

export async function archiveImports(ids: string[], customer: string, project: string, owner: string) {
  return fetchJson<{ updated: string[] }>('/api/imports/archive', {
    method: 'POST', body: JSON.stringify({ ids, customer, project, owner }),
  }, 10000);
}

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

export type Health = { status: string; service: string; mode: string; version: string; apiRevision?: number };

export async function fetchPersonalProfile() {
  return fetchJson<import('../types').PersonalProfile>('/api/profile', undefined, 5000);
}

export async function savePersonalProfile(data: import('../types').PersonalProfile) {
  return fetchJson<import('../types').PersonalProfile>('/api/profile', { method: 'POST', body: JSON.stringify(data) }, 5000);
}

export async function salesLoadError() {
  const health = await getHealth();
  return health && (health.apiRevision ?? 0) < 3
    ? '本地服务版本较旧，请重启 ClientHub 后重试'
    : '跟进数据加载失败，请检查本地服务连接后重试';
}

export async function getHealth(): Promise<Health | null> {
  return fetchJson<Health>('/api/health', undefined, 1200);
}

export async function deleteImport(id: string): Promise<{ deleted: string; customer?: string } | null> {
  return fetchJson(`/api/imports/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchImports(): Promise<ImportRecord[] | null> {
  return fetchJson<ImportRecord[]>('/api/imports', undefined, 2200);
}

export async function fetchTasks(): Promise<TaskRecord[] | null> {
  return fetchJson<TaskRecord[]>('/api/tasks?limit=100', undefined, 5000);
}

export async function retryTask(id: string): Promise<TaskRecord | null> {
  return fetchJson<TaskRecord>(`/api/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' }, 10000);
}

export async function cancelTask(id: string): Promise<TaskRecord | null> {
  return fetchJson<TaskRecord>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }, 10000);
}

export async function downloadBackup(): Promise<Blob | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${API_BASE}/api/backup/export`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function restoreBackup(archiveBase64: string): Promise<{ status: string; createdAt?: string; secretsExcluded?: boolean } | null> {
  return fetchJson('/api/backup/restore', {
    method: 'POST',
    body: JSON.stringify({ archiveBase64 }),
  }, 120000);
}

export async function createImport(payload: {
  fileName: string;
  type: string;
  size: string;
  customer: string;
  project: string;
  kind?: string;
  audioBase64?: string;
  contentBase64?: string;
  mimeType?: string;
}): Promise<{ id: string; status: string; duplicate?: boolean } | null> {
  return fetchJson('/api/imports', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, 120000);
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

export async function regenerateTranscriptSummary(id: string) {
  return fetchJson<TranscriptRecord>(`/api/transcripts/${encodeURIComponent(id)}/regenerate-summary`, { method: 'POST', body: '{}' }, 610000);
}

export async function updateTranscriptSummary(id: string, summary: import('../types').SummaryData) {
  return fetchJson<TranscriptRecord>(`/api/transcripts/${encodeURIComponent(id)}/summary`, { method: 'PATCH', body: JSON.stringify({ summary }) }, 5000);
}

export async function updateTranscriptSegments(id: string, segments: import('../types').TranscriptSegment[]) {
  return fetchJson<TranscriptRecord>(`/api/transcripts/${encodeURIComponent(id)}/segments`, { method: 'PATCH', body: JSON.stringify({ segments }) }, 10000);
}

export async function fetchChat(id: string): Promise<ChatRecord | null> {
  return fetchJson<ChatRecord>(`/api/chats/${encodeURIComponent(id)}`, undefined, 2200);
}

export async function transcribeAttachment(sourceType: 'chat' | 'transcript', id: string, attachmentId: string) {
  return fetchJson<{ status: string }>(`/api/${sourceType === 'chat' ? 'chats' : 'transcripts'}/${encodeURIComponent(id)}/attachments/transcribe`, { method: 'POST', body: JSON.stringify({ attachmentId }) }, 5000);
}

export async function previewAttachment(storedName: string) {
  return fetchJson<{ text: string }>(`/api/files/${encodeURIComponent(storedName)}/preview`, undefined, 15000);
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
  }, 60000);
}

export async function pullLlmModels(data: Partial<LlmConfig> & { apiKey?: string }): Promise<LlmModelsResult | null> {
  return fetchJson<LlmModelsResult>('/api/settings/llm/models', {
    method: 'POST',
    body: JSON.stringify(data),
  }, 60000);
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

export async function deleteCustomer(name: string): Promise<{ deleted: string; records: number; projects: number } | null> {
  return fetchJson(`/api/customers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function fetchCustomerTimeline(customer: string): Promise<{ customer: string; records: CustomerTimelineEntry[] } | null> {
  return fetchJson(`/api/customers/${encodeURIComponent(customer)}/timeline`, undefined, 3000);
}

export async function fetchDashboard(): Promise<DashboardSummary | null> {
  return fetchJson<DashboardSummary>('/api/dashboard', undefined, 5000);
}

export async function fetchMetrics(days = 7) {
  return fetchJson<import('../types').ProductMetrics>(`/api/metrics?days=${days}`, undefined, 5000);
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
