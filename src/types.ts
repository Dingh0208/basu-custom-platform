export type View = 'home' | 'import' | 'inbox' | 'transcript' | 'customers' | 'chat' | 'settings' | 'projects' | 'todos';

export interface PersonalProfile {
  name: string;
  role: string;
  company: string;
  phone: string;
  email: string;
}

export type ImportStatus = 'processing' | 'done' | 'inbox' | 'failed' | 'cancelled';

export interface ImportRecord {
  id: string;
  fileName: string;
  type: string;
  size: string;
  customer: string;
  project: string;
  status: ImportStatus;
  progress: number;
  importedAt: string;
  transcriptId?: string;
  owner?: string;
}

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string;

export interface TaskRecord {
  id: string;
  kind: string;
  importId?: string | null;
  entityId?: string | null;
  status: TaskStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  error: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  speaker: 'customer' | 'me' | 'unknown';
  text: string;
}

export interface RequirementItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  source: string;
}

export interface CitationItem {
  id: string;
  label: string;
  time: number;
  quote: string;
}

export interface SummaryData {
  oneLine: string;
  needs: string;
  budget: string;
  timeline: string;
  decisionMakers: string;
  objections: string;
  nextActions: string;
  paymentMethod: string;
  confidence: number;
  evidenceCount: number;
  evidence?: Record<string, string>;
}

export type SummaryFieldKey = Exclude<keyof SummaryData, 'confidence' | 'evidenceCount' | 'evidence'>;

export interface CorrectionRecord {
  field: string;
  before: string;
  after: string;
  createdAt: string;
}

export interface TranscriptRecord {
  id: string;
  title: string;
  fileName: string;
  fileSize: string;
  duration: number;
  importedAt: string;
  customer: string;
  company: string;
  project: string;
  source: string;
  segments: TranscriptSegment[];
  summary: SummaryData;
  attachments?: ChatAttachment[];
  corrections?: CorrectionRecord[];
  requirements?: RequirementItem[];
  citations?: CitationItem[];
}

export interface ChatParticipant {
  name: string;
  role: 'customer' | 'me';
}

export interface ChatMessage {
  id: string;
  sender: string;
  sentAt: string;
  content: string;
}

export interface ChatAnalysis {
  confidence?: number;
  evidenceCount?: number;
  summary: string;
  topic: string;
  project?: string;
  participants: Array<{ name: string; role: string; evidence?: string }>;
  keyQa: Array<{ question: string; answer: string; time?: string; evidence?: string }>;
  requirements: Array<{ title: string; description?: string; status?: string; priority?: string; evidence?: string; evidenceVerified?: boolean }>;
  commitments: Array<{ content: string; owner?: string; due?: string; evidence?: string }>;
  nextActions: Array<{ action: string; owner?: string; due?: string; evidence?: string }>;
  risks?: Array<{ content: string; evidence?: string }>;
  tags: string[];
}

export interface ChatAttachment {
  id: string;
  kind: 'image' | 'voice' | 'file' | 'video' | 'link' | string;
  name: string;
  storedName?: string | null;
  label?: string;
  messageId?: string | null;
  externalUrl?: string | null;
  renderType?: string;
  transcript?: string;
  transcriptStatus?: 'processing' | 'done' | 'failed' | string;
  transcriptError?: string;
}

export interface ChatRecord {
  id: string;
  title: string;
  fileName: string;
  customer: string;
  project: string;
  importedAt: string;
  participants: ChatParticipant[];
  messages: ChatMessage[];
  analysis: ChatAnalysis;
  corrections?: CorrectionRecord[];
  attachments?: ChatAttachment[];
  status: string;
  messageCount: number;
  startedAt?: string;
  endedAt?: string;
}

export interface ProjectRecordLink {
  id: string;
  fileName: string;
  type: string;
  kind: 'audio' | 'chat' | 'file';
  importedAt: string;
  status: string;
  transcriptId?: string | null;
}

export interface CustomerProject {
  id: string;
  customer: string;
  name: string;
  stage: string;
  budget: string;
  targetLaunchDate: string;
  owner: string;
  description: string;
  lastAt: string;
  counts: { calls: number; chats: number; files: number };
  records: ProjectRecordLink[];
  requirementCount?: number;
  updatedAt?: string;
}

export interface RequirementItemRecord {
  id: string;
  customer: string;
  project: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | string;
  status: '待确认' | '已确认' | '已报价' | '已实现' | string;
  sourceType: 'audio' | 'chat' | 'email' | 'manual' | string;
  sourceId: string;
  sourceTime: string;
  sourceQuote: string;
  createdAt: string;
  updatedAt: string;
  owner: string;
  dueDate: string;
}

export interface TodoRecord {
  id: string;
  customer: string;
  project: string;
  requirementId: string;
  title: string;
  owner: string;
  dueDate: string;
  status: 'todo' | 'doing' | 'done' | 'cancelled';
  sourceType: string;
  sourceId: string;
  sourceQuote: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface FollowupData {
  todos: TodoRecord[];
  suggestions: Array<Partial<TodoRecord> & { title: string; dueText: string }>;
  risks: Array<{ text: string; sourceId: string; sourceType: string; project: string }>;
  overdue: number;
  dueToday: number;
  lastContactAt: string;
  daysSinceContact: number | null;
}

export interface SearchResult {
  kind: 'customer' | 'project' | 'requirement' | 'chat' | 'transcript';
  id: string;
  title: string;
  customer: string;
  project: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  counts: Record<SearchResult['kind'], number>;
}

export interface ProjectListItem extends CustomerProject {
  customerCompany: string;
  recordCount: number;
}

export interface DashboardRequirement {
  id: string;
  customer: string;
  project: string;
  title: string;
  priority: string;
  status: string;
  sourceType: string;
  updatedAt: string;
}

export interface DashboardSummary {
  stats: { imports: number; customers: number; projects: number; requirements: number; inbox: number; processing: number };
  recentImports: ImportRecord[];
  recentRequirements: DashboardRequirement[];
  stageCounts: Array<{ stage: string; count: number }>;
  metrics: ProductMetrics;
}

export interface ProductMetric {
  value: number | null;
  numerator: number;
  denominator: number;
  unit: 'ratio' | 'seconds' | 'minutes' | 'count' | string;
  available: boolean;
  note: string;
}

export interface ProductMetrics {
  windowDays: number;
  windowStart: string;
  generatedAt: string;
  importsSuccessRate: ProductMetric;
  parseCompletionRate: ProductMetric;
  parseP95Seconds: ProductMetric;
  customerMatchAccuracy: ProductMetric;
  requirementEffectiveness: ProductMetric;
  nextActionLatencyMinutes: ProductMetric;
  weeklyActiveCustomers: ProductMetric;
  weeklyActiveProjects: ProductMetric;
}

export interface AppSettings {
  defaultProject: string;
  defaultOwner: string;
  autoMatch: boolean;
  autoProcess: boolean;
  autoUpdate: boolean;
  updateIntervalHours: number;
}

export interface BackupSummary {
  name: string;
  size: number;
  createdAt: string;
}

export interface Diagnostics {
  status: string;
  service: string;
  host: string;
  port: number;
  version: string;
  apiRevision: number;
  mode: string;
  dataDir: string;
  databaseSize: number;
  backups: number;
  apiKeyStorage: string;
  ffmpeg: { available: boolean; path: string };
  wechatEngine: { available: boolean; path: string };
}

export interface LlmConfig {
  baseUrl: string;
  asrModel: string;
  summaryModel: string;
  visionModel: string;
  apiKeyMasked?: string;
  hasKey?: boolean;
}

export interface LlmModelsResult {
  status: 'ok' | 'error';
  count?: number;
  models?: string[];
  error?: string;
}

export interface CustomerProfile {
  name: string;
  company: string;
  position: string;
  phone: string;
  wechat: string;
  email: string;
  tags: string[];
  sourceChannel: string;
  owner: string;
  notes: string;
  recordCount: number;
  lastAt: string;
  project: string;
}

export interface WeChatAccountInfo {
  account: string;
  name?: string;
  selfDisplayName?: string;
}

export interface WeChatJob {
  jobId?: string;
  status: 'idle' | 'running' | 'done' | 'failed' | string;
  phase?: string;
  progress: number;
  message: string;
  error?: string;
  current?: number;
  total?: number;
  currentFile?: string;
  account?: string;
  chatId?: string;
  importId?: string;
  sessionName?: string;
  messageCount?: number;
}

export interface WeChatStatus {
  available: boolean;
  port?: number;
  error?: string;
  accounts: string[];
  defaultAccount?: string | null;
  accountInfos: WeChatAccountInfo[];
  prepared?: boolean;
  prepareJob?: WeChatJob;
}

export interface WeChatSession {
  id: string;
  username: string;
  name: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
}

export interface CustomerTimelineEntry {
  id: string;
  fileName: string;
  type: string;
  project: string;
  importedAt: string;
  status: string;
  transcriptId?: string | null;
  kind: 'audio' | 'chat' | 'file';
  title: string;
  summary: string;
  messageCount: number;
  duration: number;
  attachments?: ChatAttachment[];
}
