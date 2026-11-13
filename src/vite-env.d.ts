/// <reference types="vite/client" />

/** 應用會讀取的 Vite 環境變數。 */
interface ImportMetaEnv {
  /** Supabase 專案網址；未配置時走靜態 JSON 降級。 */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon key（公開金鑰，屬正常做法）。 */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
