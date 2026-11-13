/**
 * Supabase 用戶端工廠。
 *
 * Supabase 為主要資料來源，建置期以環境變數嵌入網址與 anon key；
 * 未配置時整個應用直接走靜態 JSON 降級路徑（dataLoader）。
 *
 * 用戶端為模組級單例：dataStore、authStore、pantrySync 共用同一實例，
 * 避免各自持有一份會話並同時 auto-refresh 造成 token 輪替競爭。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** 已建立的用戶端快取；null 代表尚未建立。 */
let cachedClient: SupabaseClient | null = null;

/**
 * 取得 Supabase 用戶端（單例；重複呼叫回傳同一實例）。
 *
 * @returns 未配置 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY 時回傳 null，
 *          由呼叫端改用靜態 JSON 的降級路徑
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  cachedClient = createClient(url, anonKey);
  return cachedClient;
}
