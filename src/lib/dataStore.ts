/**
 * 配方與食材資料的共用資料層。
 *
 * 應用啟動時由 main.tsx 呼叫 startDataLoad() 觸發一次載入；
 * 資料來源順序：已配置 Supabase 環境變數時以 Supabase 為主，
 * Supabase 失敗（網路、HTTP 錯誤等）則退回靜態 JSON，兩者皆失敗才報錯。
 * 資料就緒後把食材對照表注入 ingredients 模組的同步索引，
 * 並通知訂閱者（useCocktails）重新渲染。載入流程整個應用只跑一次。
 * Supabase 相關程式（supabase-js）以動態匯入載入，未配置環境變數時
 * 不會進入主 bundle，靜態模式的主 bundle 保持精簡。
 */
import { loadStaticData, type LoadedData } from './dataLoader';
import { setIngredientCatalog } from './ingredients';
import type { CocktailDataset, IngredientCatalog } from './types';

/** 資料載入的狀態快照。 */
export interface DataStoreState {
  /** 配方資料集；尚未就緒時為 null。 */
  dataset: CocktailDataset | null;
  /** 食材對照表；尚未就緒時為 null。 */
  catalog: IngredientCatalog | null;
  /** 是否載入中。 */
  loading: boolean;
  /** 載入失敗的原因；成功前為 null。 */
  error: Error | null;
}

/** 全部訂閱者的通知回呼。 */
const listeners = new Set<() => void>();

let state: DataStoreState = { dataset: null, catalog: null, loading: false, error: null };

/** 目前是否已啟動過載入（避免重複載入）。 */
let started = false;

/** 讀取目前的資料狀態快照（供 useSyncExternalStore 使用）。 */
export function getDataState(): DataStoreState {
  return state;
}

/**
 * 訂閱資料狀態變化。
 *
 * @param listener 狀態變化時的通知回呼
 * @returns 取消訂閱的函式
 */
export function subscribeDataState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 更新狀態快照並通知所有訂閱者。 */
function setDataState(next: DataStoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * 判斷是否已配置 Supabase 環境變數。
 *
 * 與 supabase.ts 檢查同一組環境變數；放在本模組是為了在動態匯入
 * supabase-js 相關程式「之前」先做守門，未配置時完全載不到該 chunk。
 */
function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

/**
 * 取得應用的資料來源。
 *
 * Supabase 可用時優先採用；supabase-js 以動態匯入載入（獨立 chunk，
 * 不佔主 bundle 大小）；Supabase 讀取過程失敗一律退回靜態 JSON
 * （降級路徑是真實路徑，不是邊角案例），兩者皆失敗才把例外往外拋。
 */
async function loadAppData(): Promise<LoadedData> {
  if (isSupabaseConfigured()) {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (client) {
      const { loadSupabaseData } = await import('./supabaseData');
      return loadSupabaseData(client).catch(() => loadStaticData());
    }
  }
  return loadStaticData();
}

/**
 * 啟動資料載入（整個應用只應呼叫一次；重複呼叫以第一次為準）。
 *
 * 載入成功時：注入食材對照表索引，並把資料集放入狀態；
 * 載入失敗時：保留空資料與錯誤訊息，由介面顯示明確的錯誤畫面。
 */
export function startDataLoad(): void {
  if (started) return;
  started = true;
  setDataState({ ...state, loading: true });

  loadAppData()
    .then((loaded) => {
      setIngredientCatalog(loaded.catalog);
      setDataState({
        dataset: loaded.dataset,
        catalog: loaded.catalog,
        loading: false,
        error: null,
      });
    })
    .catch((cause: unknown) => {
      const error =
        cause instanceof Error ? cause : new Error('資料載入失敗，請稍後再試。');
      setDataState({ ...state, loading: false, error });
    });
}
