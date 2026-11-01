/// <reference types="vite/client" />

interface Window {
  clientHub?: {
    platform: string;
    versions: { electron: string; chrome: string; node: string };
    showReminder: (payload: { title: string; body: string; todoId: string }) => Promise<boolean>;
    onOpenReminder: (callback: (todoId: string) => void) => () => void;
  };
}
