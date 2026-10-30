/// <reference types="vite/client" />

interface Window {
  clientHub?: {
    platform: string;
    versions: { electron: string; chrome: string; node: string };
  };
}
