export interface CheckResult {
  ok: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface DesktopConfig {
  proqPath: string;
  port: number;
  devMode: boolean;
  setupComplete: boolean;
  claudeBinPath: string;
  lastUpdated: string;
  windowBounds: { x: number; y: number; width: number; height: number } | null;
}

export interface UpdateCheckResult {
  available: boolean;
  commits: string[];
  error?: string;
}

export interface ProqDesktopAPI {
  checkNode: () => Promise<CheckResult>;
  checkTmux: () => Promise<CheckResult>;
  installTmux: () => Promise<CheckResult>;
  checkClaude: () => Promise<CheckResult>;
  checkXcode: () => Promise<CheckResult>;
  cloneRepo: (targetDir: string) => Promise<{ ok: boolean; error?: string }>;
  validateInstall: (dirPath: string) => Promise<boolean>;
  npmInstall: () => Promise<{ ok: boolean; error?: string }>;
  buildProq: () => Promise<{ ok: boolean; error?: string }>;
  persistClaude: (claudePath: string) => Promise<void>;

  getConfig: () => Promise<DesktopConfig>;
  setConfig: (partial: Partial<DesktopConfig>) => Promise<DesktopConfig>;
  selectDirectory: () => Promise<string | null>;

  startServer: () => Promise<{ ok: boolean; error?: string }>;
  onServerReady: (cb: () => void) => () => void;
  onServerLog: (cb: (e: any, line: string) => void) => () => void;
  onServerError: (cb: (e: any, error: string) => void) => () => void;

  onSetupLog: (cb: (e: any, line: string) => void) => () => void;

  checkUpdates: () => Promise<UpdateCheckResult>;
  applyUpdate: () => Promise<{ ok: boolean; error?: string }>;

  getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    proqDesktop: ProqDesktopAPI;
  }
}
