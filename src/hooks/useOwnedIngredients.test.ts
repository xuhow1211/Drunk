/**
 * 手邊材料共享狀態的單元測試。
 *
 * 這份狀態是「材料選擇器」與「結果清單」共同依賴的單一資料來源，
 * 一旦兩邊不同步，使用者勾了材料卻看不到結果變化。
 * 本檔直接測試模組層級的 store 函式（不需渲染 React），
 * 驗證去重、保留既有勾選、localStorage 讀寫與資料損毀時的容錯。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 模擬的 localStorage。 */
class FakeStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

type StoreModule = typeof import('./useOwnedIngredients');

let storage: FakeStorage;

/**
 * 以指定的 localStorage 內容重新載入模組。
 *
 * 模組層級的 currentOwned 是在 import 時就讀取 localStorage 的，
 * 因此每次改變儲存內容後都必須重新 import 才能反映最新狀態。
 */
async function loadStore(storedValue?: string): Promise<StoreModule> {
  vi.resetModules();
  storage = new FakeStorage();
  if (storedValue !== undefined) {
    storage.setItem('join-owned-ingredients', storedValue);
  }
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: storage,
  };
  return import('./useOwnedIngredients');
}

/** 讀出目前儲存的原始字串。 */
function storedRaw(): string | null {
  return storage.getItem('join-owned-ingredients');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('切換手邊材料', () => {
  it('切換會加入或移除材料，並寫入 localStorage', async () => {
    const store = await loadStore();

    store.toggleOwned('gin');
    expect(store.isOwned('gin')).toBe(true);
    expect(store.isOwned('campari')).toBe(false);
    expect(storedRaw()).toBe('["gin"]');

    store.toggleOwned('gin');
    expect(store.isOwned('gin')).toBe(false);
    expect(storedRaw()).toBe('[]');
  });
});

describe('一次加入多項材料', () => {
  it('加入時保留既有的勾選，而不是取代', async () => {
    const store = await loadStore('["gin"]');

    store.addManyOwned(['campari', 'vermouth-red']);

    expect(store.isOwned('gin')).toBe(true);
    expect(store.isOwned('campari')).toBe(true);
    expect(store.isOwned('vermouth-red')).toBe(true);
  });

  it('重複的 id 自動去重', async () => {
    const store = await loadStore();

    store.addManyOwned(['gin', 'gin', 'gin']);

    expect(store.isOwned('gin')).toBe(true);
    expect(JSON.parse(storedRaw() ?? '[]')).toEqual(['gin']);
  });

  it('空字串與空白 id 會被忽略', async () => {
    const store = await loadStore();

    store.addManyOwned(['', '   ', 'gin']);

    expect(store.isOwned('')).toBe(false);
    expect(store.isOwned('gin')).toBe(true);
  });

  it('空陣列不會寫入 localStorage', async () => {
    const store = await loadStore();

    store.addManyOwned([]);

    expect(storedRaw()).toBeNull();
  });

  it('加入的內容全部已在清單內時不重複寫入', async () => {
    const store = await loadStore('["gin"]');

    store.addManyOwned(['gin']);

    expect(storedRaw()).toBe('["gin"]');
  });
});

describe('移除與取代', () => {
  it('removeMany 只移除指定的材料', async () => {
    const store = await loadStore('["gin","campari"]');

    store.removeManyOwned(['gin']);

    expect(store.isOwned('gin')).toBe(false);
    expect(store.isOwned('campari')).toBe(true);
  });

  it('replace 會以指定清單取代既有勾選', async () => {
    const store = await loadStore('["gin","campari"]');

    store.replaceOwned(['lime-juice']);

    expect(store.isOwned('gin')).toBe(false);
    expect(store.isOwned('campari')).toBe(false);
    expect(store.isOwned('lime-juice')).toBe(true);
  });

  it('clear 會清空整份清單', async () => {
    const store = await loadStore('["gin","campari"]');

    store.clearOwned();

    expect(store.isOwned('gin')).toBe(false);
    expect(storedRaw()).toBe('[]');
  });
});

describe('localStorage 讀寫的容錯', () => {
  it('儲存的內容不是合法 JSON 時退回空集合，不會讓頁面壞掉', async () => {
    const store = await loadStore('{not valid json');

    expect(store.isOwned('gin')).toBe(false);
  });

  it('儲存的內容不是陣列時退回空集合', async () => {
    const store = await loadStore('{"gin":true}');

    expect(store.isOwned('gin')).toBe(false);
  });

  it('陣列內的非字串元素被略過，字串元素照常保留', async () => {
    const store = await loadStore('["gin", 42, null, "campari"]');

    expect(store.isOwned('gin')).toBe(true);
    expect(store.isOwned('campari')).toBe(true);
  });

  it('儲存內容為空字串時退回空集合', async () => {
    const store = await loadStore('');

    expect(store.isOwned('gin')).toBe(false);
  });

  it('寫入失敗時仍可在本次瀏覽中使用（不會丟失勾選）', async () => {
    vi.resetModules();
    const failingStorage = new FakeStorage();
    failingStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: failingStorage,
    };
    const store = await import('./useOwnedIngredients');

    expect(() => store.toggleOwned('gin')).not.toThrow();
    expect(store.isOwned('gin')).toBe(true);
  });

  it('沒有 localStorage 的環境（伺服器預先算繪）仍可運作', async () => {
    vi.resetModules();
    delete (globalThis as unknown as { window?: unknown }).window;
    const store = await import('./useOwnedIngredients');

    store.toggleOwned('gin');
    expect(store.isOwned('gin')).toBe(true);
  });
});

describe('重新載入後仍保留勾選', () => {
  it('寫入的內容在重新載入模組後可以讀回', async () => {
    const store = await loadStore();
    store.addManyOwned(['gin', 'campari']);

    const reloaded = await loadStore(storedRaw() ?? '[]');

    expect(reloaded.isOwned('gin')).toBe(true);
    expect(reloaded.isOwned('campari')).toBe(true);
  });
});
