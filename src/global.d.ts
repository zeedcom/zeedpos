export {};

declare global {
  interface Window {
    updater?: {
      onAvailable: (cb: (version: string) => void) => () => void;
      onProgress: (cb: (percent: number) => void) => () => void;
      onDownloaded: (cb: (version: string) => void) => () => void;
      onError: (cb: (message: string) => void) => () => void;
      install: () => Promise<void>;
      check: () => Promise<void>;
    };
  }
}