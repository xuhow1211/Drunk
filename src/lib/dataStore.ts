/**
 * 配方與食材資料的共用資料層。
 *
 * 應用啟動時由 main.tsx 呼叫 startDataLoad() 觸發一次載入；
 * 資料就緒後把食材對照表注入 ingredients 模組的同步索引，
 * 並通知訂閱者（useCocktails）重新渲染。載入流程整個應用只跑一次。
 */
import { loadStaticData } from './dataLoader';
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
 * 啟動資料載入（整個應用只應呼叫一次；重複呼叫以第一次為準）。
 *
 * 載入成功時：注入食材對照表索引，並把資料集放入狀態；
 * 載入失敗時：保留空資料與錯誤訊息，由介面顯示明確的錯誤畫面。
 */
export function startDataLoad(): void {
  if (started) return;
  started = true;
  setDataState({ ...state, loading: true });

  loadStaticData()
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
