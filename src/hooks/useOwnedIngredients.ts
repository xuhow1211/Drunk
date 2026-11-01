/**
 * 使用者「手邊已有材料」的共享狀態。
 *
 * 設計重點：
 *   1. 單一資料來源。比對模式的左欄（材料選擇器）與右欄（結果清單）
 *      都要讀寫同一份清單，因此狀態放在模組層級的外部存放區（store），
 *      再以 useSyncExternalStore 讓各元件訂閱，避免兩份狀態不同步。
 *   2. 持久化。勾選結果寫入 localStorage，重新整理後仍保留；
 *      讀取失敗或資料損毀時退回空集合，絕不讓整個頁面白畫面。
 *   3. 純函式操作。切換、加入、移除都以「產生新集合」的方式提交，
 *      不直接修改既有 Set，避免 React 判定狀態未變更而漏掉重繪。
 */
import { useSyncExternalStore } from 'react';

/** localStorage 的鍵名。改動此鍵會讓既有使用者的選取結果失效。 */
export const OWNED_INGREDIENTS_STORAGE_KEY = 'join-owned-ingredients';

/** 空集合的共用實例，避免每次都建立新的 Set 造成不必要的重繪。 */
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** 訂閱者集合（每個使用此 hook 的元件一個）。 */
const listeners = new Set<() => void>();

/** 目前的手邊材料清單（模組層級，全站共用一份）。 */
let currentOwned: ReadonlySet<string> = readStoredIds();

/**
 * 判斷目前環境是否可存取 localStorage。
 *
 * 伺服器預先算繪或隱私模式瀏覽器可能沒有 localStorage，
 * 此時一律退回記憶體內運作，不影響功能。
 */
function canUseStorage(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined' &&
    typeof window.localStorage.getItem === 'function'
  );
}

/**
 * 讀取並解析 localStorage 中的手邊材料清單。
 *
 * 任何格式錯誤（不是 JSON、不是陣列、陣列元素不是字串）都視為資料損毀，
 * 一律退回空集合，讓使用者從零開始勾選，而不是讓整頁載入失敗。
 */
function readStoredIds(): ReadonlySet<string> {
  if (!canUseStorage()) return EMPTY_SET;
  try {
    const raw = window.localStorage.getItem(OWNED_INGREDIENTS_STORAGE_KEY);
    if (!raw) return EMPTY_SET;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_SET;
    const ids = parsed.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );
    return ids.length > 0 ? new Set(ids) : EMPTY_SET;
  } catch {
    return EMPTY_SET;
  }
}

/**
 * 把手邊材料清單寫回 localStorage。
 *
 * 寫入失敗（例如儲存空間已滿或瀏覽器設定禁止）時靜默忽略：
 * 勾選功能仍可在本次瀏覽中使用，只是無法跨重新整理保留。
 */
function persistIds(ids: ReadonlySet<string>): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(
      OWNED_INGREDIENTS_STORAGE_KEY,
      JSON.stringify([...ids]),
    );
  } catch {
    // 忽略寫入失敗，不中斷使用者操作
  }
}

/** 提交新的清單，並通知所有訂閱者重繪。 */
function commit(next: ReadonlySet<string>): void {
  currentOwned = next;
  persistIds(next);
  for (const listener of listeners) listener();
}

/** 訂閱清單變更。 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 取得目前的清單快照。 */
function getSnapshot(): ReadonlySet<string> {
  return currentOwned;
}

/** 伺服器預先算繪時的快照（沒有 localStorage 一律視為空）。 */
function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY_SET;
}

/** 判斷某項材料是否已在手邊。 */
export function isOwned(id: string): boolean {
  return currentOwned.has(id);
}

/** 切換某項材料：有則移除，沒有則加入。 */
export function toggleOwned(id: string): void {
  const next = new Set(currentOwned);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  commit(next);
}

/**
 * 把多項材料加入手邊清單。
 *
 * 語意是「加入」而非「取代」：既有的勾選一律保留，重複的 id 自動去重。
 */
export function addManyOwned(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const next = new Set(currentOwned);
  for (const id of ids) {
    if (typeof id === 'string' && id.trim() !== '') next.add(id);
  }
  if (next.size === currentOwned.size) return;
  commit(next);
}

/** 從手邊清單移除多項材料（已不在清單內者略過）。 */
export function removeManyOwned(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const next = new Set(currentOwned);
  for (const id of ids) next.delete(id);
  if (next.size === currentOwned.size) return;
  commit(next);
}

/** 以指定的清單取代目前的手邊材料（隨機挑選等情境使用）。 */
export function replaceOwned(ids: readonly string[]): void {
  const next = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' && id.trim() !== '') next.add(id);
  }
  commit(next);
}

/** 清空手邊材料。 */
export function clearOwned(): void {
  if (currentOwned.size === 0) return;
  commit(EMPTY_SET);
}

/** useOwnedIngredients 的回傳內容。 */
export interface OwnedIngredientsState {
  /** 手邊已有的材料 id 集合（唯讀）。 */
  owned: ReadonlySet<string>;
  /** 手邊材料的種類數。 */
  count: number;
  /** 判斷某項材料是否已在手邊。 */
  isOwned: (id: string) => boolean;
  /** 切換某項材料。 */
  toggle: (id: string) => void;
  /** 加入多項材料（保留既有勾選、重複自動去重）。 */
  addMany: (ids: readonly string[]) => void;
  /** 移除多項材料。 */
  removeMany: (ids: readonly string[]) => void;
  /** 以指定的清單取代目前的手邊材料。 */
  replace: (ids: readonly string[]) => void;
  /** 清空手邊材料。 */
  clear: () => void;
}

/**
 * 取得使用者手邊材料的共享狀態。
 *
 * 所有呼叫此 hook 的元件都會看到同一份清單，
 * 因此材料選擇器與結果清單不會出現「兩套狀態不同步」的情況。
 */
export function useOwnedIngredients(): OwnedIngredientsState {
  const owned = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    owned,
    count: owned.size,
    isOwned,
    toggle: toggleOwned,
    addMany: addManyOwned,
    removeMany: removeManyOwned,
    replace: replaceOwned,
    clear: clearOwned,
  };
}
