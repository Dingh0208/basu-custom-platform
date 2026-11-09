/// <reference types="vite/client" />

interface Window {
  clientAtlas?: ClientAtlasBridge;
  clientHub?: ClientAtlasBridge;
}

interface ClientAtlasBridge {
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  checkForUpdates?: () => Promise<{ status: string }>;
  getUpdateState?: () => Promise<{ status: string; version?: string; percent?: number } | null>;
  downloadUpdate?: () => Promise<{ status: string }>;
  installUpdate?: () => Promise<boolean>;
  configureUpdates?: (settings: { enabled: boolean; intervalHours: number }) => Promise<boolean>;
  restartSidecar?: () => Promise<{ status: string; version?: string; apiRevision?: number }>;
  saveClarificationPdf?: (payload: import('../electron/clarification-document.mjs').ClarificationDocument) => Promise<{ canceled: boolean }>;
  showReminder?: (payload: { title: string; body: string; todoId: string }) => Promise<boolean>;
  onOpenReminder?: (callback: (todoId: string) => void) => () => void;
  onUpdateStatus?: (callback: (payload: { status: string; version?: string; percent?: number }) => void) => () => void;
  getWeChatComponent?: () => Promise<{ installed: boolean }>;
  downloadWeChatComponent?: () => Promise<{ installed: boolean; error?: string }>;
  onWeChatComponentProgress?: (callback: (percent: number) => void) => () => void;
}
