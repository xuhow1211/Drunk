/**
 * Supabase 用戶端工廠的單元測試。
 *
 * 驗證環境變數的判定：兩者皆配置時建立用戶端，缺任一項（或為空字串）時
 * 回傳 null，由資料層改走靜態 JSON 降級路徑。createClient 以 mock 模擬
 * （node 測試環境沒有 WebSocket 等瀏覽器全域，無法建立真實用戶端）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from './supabase';

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

afterEach(() => {
  vi.unstubAllEnvs();
  createClientMock.mockReset();
});

describe('getSupabaseClient', () => {
  it('環境變數未配置時回傳 null，不建立用戶端', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    expect(getSupabaseClient()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('只配置網址缺金鑰時回傳 null', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    expect(getSupabaseClient()).toBeNull();
  });

  it('兩項都配置時以網址與金鑰建立用戶端', () => {
    createClientMock.mockReturnValue({ mocked: true });
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
    expect(getSupabaseClient()).toEqual({ mocked: true });
    expect(createClientMock).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key-for-test');
  });
});
