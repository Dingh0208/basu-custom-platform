import type { AppSettings, BackupSummary, ChatRecord, ClarificationRecord, CustomerProfile, CustomerProject, CustomerTimelineEntry, DashboardSummary, Diagnostics, ImportRecord, LlmConfig, LlmModelsResult, MailConfig, MailConnectionTest, MailMessage, ProjectListItem, RequirementItemRecord, TaskRecord, TranscriptRecord, WeChatJob, WeChatSession, WeChatStatus } from '../types';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8765';

export function fetchNotifications() {
  return fetchJson<{ unreadCount: number; items: import('../types').WorkspaceNotification[] }>('/api/notifications', undefined, 5000);
}

export function markNotifications(action: 'read' | 'delivered', ids: string[], all = false) {
  return fetchJson<{ status: string }>('/api/notifications', { method: 'POST', body: JSON.stringify({ action, ids, all }) }, 5000);
}

export async function fetchTodos(customer = '') {
  return fetchJson<import('../types').TodoRecord[]>(`/api/todos?customer=${encodeURIComponent(customer)}`, undefined, 5000);
}

export async function fetchClarifications(filters: { customer?: string; project?: string; status?: string; includeArchived?: boolean } = {}) {
  const query = new URLSearchParams();
  if (filters.customer) query.set('customer', filters.customer);
  if (filters.project) query.set('project', filters.project);
  if (filters.status) query.set('status', filters.status);
  if (filters.includeArchived) query.set('includeArchived', 'true');
  const suffix = query.toString();
  return fetchJson<ClarificationRecord[]>(`/api/clarifications${suffix ? `?${suffix}` : ''}`, undefined, 5000);
}

export async function fetchClarification(id: string) {
  return fetchJson<ClarificationRecord>(`/api/clarifications/${encodeURIComponent(id)}`, undefined, 5000);
}

export async function fetchClarificationMetrics() {
  return fetchJson<import('../types').ClarificationMetrics>('/api/clarifications/metrics', undefined, 5000);
}

export async function recordClarificationCopies(recordId: string, questionIds: string[]) {
  return fetchJson<{ copied: number }>(`/api/clarifications/${encodeURIComponent(recordId)}/copy`, {
    method: 'POST',
    body: JSON.stringify({ questionIds }),
  }, 5000);
}

export async function createClarification(data: {
  name?: string;
  selectedScope?: Record<string, unknown> | unknown[];
  modelSnapshot?: Record<string, unknown> | unknown[];
  language?: string;
  sources?: Array<Record<string, unknown>>;
}) {
  return fetchJson<ClarificationRecord>('/api/clarifications', { method: 'POST', body: JSON.stringify(data) }, 5000);
}

export async function replaceClarificationSources(id: string, sources: Array<Record<string, unknown>>) {
  return fetchJson<ClarificationRecord>(`/api/clarifications/${encodeURIComponent(id)}/sources`, {
    method: 'POST',
    body: JSON.stringify({ sources }),
  }, 5000);
}

export async function startClarificationAnalysis(id: string, incremental = false) {
  return fetchJson<{ status: string; recordId: string; taskId?: string; message?: string }>(`/api/clarifications/${encodeURIComponent(id)}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ incremental }),
  }, 10000);
}

export async function appendClarificationSources(id: string, sources: Array<Record<string, unknown>>) {
  return fetchJson<ClarificationRecord>(`/api/clarifications/${encodeURIComponent(id)}/sources/append`, {
    method: 'POST',
    body: JSON.stringify({ sources }),
  }, 5000);
}

export async function updateClarificationQuestion(id: string, data: Partial<Pick<import('../types').ClarificationQuestion, 'customerId' | 'projectId' | 'category' | 'priority' | 'text' | 'rationale' | 'status'>>) {
  return fetchJson<import('../types').ClarificationQuestion>(`/api/clarification-questions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, 5000);
}

export async function createClarificationQuestion(recordId: string, data: Partial<Pick<import('../types').ClarificationQuestion, 'customerId' | 'projectId' | 'category' | 'priority' | 'text' | 'rationale'>>) {
  return fetchJson<import('../types').ClarificationQuestion>(`/api/clarifications/${encodeURIComponent(recordId)}/questions`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 5000);
}

export async function recordClarificationAnswer(questionId: string, answerText: string, status: 'asked' | 'answered' = 'answered') {
  return fetchJson<import('../types').ClarificationQuestion>(`/api/clarification-questions/${encodeURIComponent(questionId)}/answers`, {
    method: 'POST',
    body: JSON.stringify({ answerText, status }),
  }, 5000);
}

export async function generateClarificationFollowup(questionId: string) {
  return fetchJson<{ record: ClarificationRecord; added: number }>(`/api/clarification-questions/${encodeURIComponent(questionId)}/follow-up`, {
    method: 'POST',
    body: '{}',
  }, 10000);
}

export async function previewClarificationAction(questionId: string, data: Record<string, unknown>) {
  return fetchJson<{ action: string; target: Record<string, string>; changes: Record<string, string>; answerId: string }>(`/api/clarification-questions/${encodeURIComponent(questionId)}/action-preview`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 5000);
}

export async function confirmClarificationAction(questionId: string, data: Record<string, unknown>) {
  return fetchJson<{ action: string; result: Record<string, unknown>; question: import('../types').ClarificationQuestion }>(`/api/clarification-questions/${encodeURIComponent(questionId)}/action-confirm`, {
    method: 'POST',
    body: JSON.stringify(data),
  }, 10000);
}

export async function updateClarification(id: string, data: Partial<Pick<ClarificationRecord, 'name' | 'status' | 'language' | 'selectedScope' | 'modelSnapshot' | 'totalBatches' | 'completedBatches' | 'errorMessage'>>) {
  return fetchJson<ClarificationRecord>(`/api/clarifications/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }, 5000);
}

export async function deleteClarification(id: string) {
  return fetchJson<{ deleted: string }>(`/api/clarifications/${encodeURIComponent(id)}`, { method: 'DELETE' }, 5000);
}

export async function duplicateClarification(id: string) {
  return fetchJson<ClarificationRecord>(`/api/clarifications/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    body: '{}',
  }, 5000);
}

export async function downloadClarificationWord(id: string, filters: { customer?: string; project?: string; priorities?: string[] } = {}) {
  const query = new URLSearchParams({ format: 'docx' });
  if (filters.customer) query.set('customer', filters.customer);
  if (filters.project) query.set('project', filters.project);
  if (filters.priorities) query.set('priorities', filters.priorities.join(','));
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${API_BASE}/api/clarifications/${encodeURIComponent(id)}/export?${query.toString()}`, { signal: controller.signal });
    if (!response.ok) return null;
    return response.blob();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
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

export async function archiveImports(ids: string[], customer: string, project = '', owner = '') {
  return fetchJson<{ updated: string[] }>('/api/imports/archive', {
    method: 'POST', body: JSON.stringify({ ids, customer, project, owner }),
  }, 10000);
}

export class ChatCapacityError extends Error {}

async function fetchJson<T>(path: string, init?: RequestInit, timeoutMs = 2000): Promise<T | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      if (res.status === 413) {
        const error = await res.json();
        if (error.error === 'chat_capacity_exceeded') throw new ChatCapacityError(error.message);
      }
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof ChatCapacityError) throw error;
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
    ? '本地服务版本较旧，请重启 ClientAtlas 后重试'
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

export async function fetchTask(id: string): Promise<TaskRecord | null> {
  return fetchJson<TaskRecord>(`/api/tasks/${encodeURIComponent(id)}`, undefined, 5000);
}

export async function retryTask(id: string): Promise<TaskRecord | null> {
  return fetchJson<TaskRecord>(`/api/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' }, 10000);
}

export async function cancelTask(id: string): Promise<TaskRecord | null> {
  return fetchJson<TaskRecord>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }, 10000);
}

export async function deleteTaskRecord(id: string): Promise<{ deleted: string } | null> {
  return fetchJson<{ deleted: string }>(`/api/tasks/${encodeURIComponent(id)}/record`, { method: 'DELETE' }, 10000);
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
  customer?: string;
  manualCustomer?: string;
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
  return fetchJson<ChatRecord>(`/api/chats/${encodeURIComponent(id)}`, undefined, 10000);
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

export async function clearLlmApiKey(): Promise<LlmConfig | null> {
  return fetchJson<LlmConfig>('/api/settings/llm', {
    method: 'POST',
    body: JSON.stringify({ clearApiKey: true }),
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

export async function fetchArchivedProjects(): Promise<ProjectListItem[] | null> {
  const health = await getHealth();
  if ((health?.apiRevision ?? 0) < 6) return null;
  return fetchJson('/api/projects?archived=true', undefined, 5000);
}

export async function restoreProject(projectId: string): Promise<{ restored?: string; error?: string } | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/restore`, {
      method: 'POST', signal: controller.signal,
    });
    return await response.json() as { restored?: string; error?: string };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
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

export async function fetchMailConfig(): Promise<MailConfig | null> {
  return fetchJson<MailConfig>('/api/mail/config', undefined, 5000);
}

export async function saveMailConfig(data: { email: string; password?: string }): Promise<MailConfig | null> {
  return fetchJson<MailConfig>('/api/mail/config', { method: 'POST', body: JSON.stringify(data) }, 5000);
}

export async function testMailConnection(): Promise<MailConnectionTest | null> {
  return fetchJson<MailConnectionTest>('/api/mail/test', { method: 'POST', body: '{}' }, 25000);
}

export async function fetchMailMessages(query = '', offset = 0): Promise<{ messages: MailMessage[]; total: number; limit: number; offset: number } | null> {
  return fetchJson(`/api/mail/messages?${new URLSearchParams({ query, offset: String(offset), limit: '50' })}`, undefined, 5000);
}

export async function discoverMailMessages(): Promise<{ status: string; taskId?: string } | null> {
  return fetchJson('/api/mail/discover', { method: 'POST', body: '{}' }, 5000);
}

export async function importMailMessages(email: string, uidValidity: string, messages: Array<{ uid: number }>): Promise<{ status: string; taskId?: string } | null> {
  return fetchJson('/api/mail/import', { method: 'POST', body: JSON.stringify({ email, uidValidity, messages }) }, 5000);
}

export async function saveAppSettings(data: Partial<AppSettings>): Promise<AppSettings | null> {
  return fetchJson<AppSettings>('/api/settings/app', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchBackups(): Promise<BackupSummary[] | null> {
  return fetchJson<BackupSummary[]>('/api/backups', undefined, 5000);
}

export async function fetchDiagnostics(): Promise<Diagnostics | null> {
  return fetchJson<Diagnostics>('/api/diagnostics', undefined, 3000);
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
  return fetchJson<WeChatStatus>('/api/wechat/status', undefined, 120000);
}

export type WechatEngineStartResult = {
  status: 'ok' | 'failed';
  available?: boolean;
  started?: boolean;
  port?: number;
  error?: string;
  repairSteps?: string[];
  logPath?: string;
  tempDir?: string;
  retryAfterSeconds?: number;
};

export async function startWechatEngine(): Promise<WechatEngineStartResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${API_BASE}/api/wechat/start`, {
      method: 'POST',
      signal: controller.signal,
    });
    const result = await response.json() as Partial<WechatEngineStartResult>;
    if (result.status === 'ok' || result.status === 'failed') return result as WechatEngineStartResult;
    return {
      status: 'failed',
      error: response.status === 404
        ? '当前 Sidecar 版本不支持手动启动微信引擎，请先重启或更新本地服务。'
        : result.error || '本地服务返回了无法识别的启动结果。',
      repairSteps: ['在“本地服务与诊断”中重启本地服务。', '确认 Sidecar API 已更新后，再启动微信引擎。'],
    };
  } catch {
    return {
      status: 'failed',
      error: 'Sidecar 未能完成启动请求，请先重启本地服务后重试。',
      repairSteps: ['重启 Sidecar 后重新检测。', '若问题持续，请查看本地服务日志并重新安装 ClientAtlas。'],
    };
  } finally {
    window.clearTimeout(timer);
  }
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
): Promise<{ total: number | null; limit?: number; overLimit?: boolean; message?: string; messages: Array<{ id: string; sender: string; sentAt: string; content: string }> } | null> {
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

export async function createChatImport(text: string, meta?: { fileName?: string; customer?: string; manualCustomer?: string; project?: string }): Promise<{ id: string; status: string; chatId?: string; messageCount?: number } | null> {
  return fetchJson('/api/imports/chat', {
    method: 'POST',
    body: JSON.stringify({ text, ...meta }),
  }, 10000);
}

export async function createChatScreenshot(
  imageBase64: string,
  mimeType: string,
  fileName: string,
  meta?: { customer?: string; manualCustomer?: string; project?: string },
): Promise<{ id: string; status: string; chatId?: string; messageCount?: number } | null> {
  return fetchJson(
    '/api/imports/chat-screenshot',
    { method: 'POST', body: JSON.stringify({ imageBase64, mimeType, fileName, ...meta }) },
    360000,
  );
}

export function importFileUrl(id: string): string {
  return `${API_BASE}/api/imports/${encodeURIComponent(id)}/file`;
}
