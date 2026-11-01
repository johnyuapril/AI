import { registerPlugin } from '@capacitor/core';

export interface AppUpdaterPlugin {
  info(): Promise<{ versionName: string; versionCode: number }>;
  install(o: { url: string }): Promise<void>;
  openUrl(o: { url: string }): Promise<void>;
  shareFile(o: { uri: string; mime: string; title?: string }): Promise<void>;
  openSide(o: { pkg?: string; url: string }): Promise<void>;
}
export const AppNative = registerPlugin<AppUpdaterPlugin>('AppUpdater');
