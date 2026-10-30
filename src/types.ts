export type View = 'import' | 'transcript' | 'customers' | 'chat';

export type ImportStatus = 'processing' | 'done' | 'inbox' | 'failed';

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
  summary: string;
  topic: string;
  project?: string;
  participants: Array<{ name: string; role: string; evidence?: string }>;
  keyQa: Array<{ question: string; answer: string; time?: string; evidence?: string }>;
  requirements: Array<{ title: string; description?: string; status?: string; priority?: string; evidence?: string }>;
  commitments: Array<{ content: string; owner?: string; due?: string; evidence?: string }>;
  nextActions: Array<{ action: string; owner?: string; due?: string; evidence?: string }>;
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
  updatedAt?: string;
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
