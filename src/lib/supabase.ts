/**
 * Supabase 用戶端工廠。
 *
 * Supabase 為主要資料來源，建置期以環境變數嵌入網址與 anon key；
 * 未配置時整個應用直接走靜態 JSON 降級路徑（dataLoader）。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 建立 Supabase 用戶端。
 *
 * @returns 未配置 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY 時回傳 null，
 *          由呼叫端改用靜態 JSON 的降級路徑
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}
