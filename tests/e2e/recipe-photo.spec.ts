/**
 * 詳情抽屜示意照片的情境測試。
 *
 * 涵蓋：有實照的配方（尼格羅尼）顯示照片與來源字、
 * 無實照配方顯示通用杯型插畫、圖片載入失敗時退回插畫，
 * 以及（可執行時）Supabase 模式的 photo_url 對應。
 *
 * 圖片一律以 route 攔截滿足，不送真實網路請求；
 * Storage 網址不寫死，從畫面元素取得後比對攔截紀錄。
 */
import { expect, test, type Page, type Route } from '@playwright/test';

/** 1x1 透明 PNG 的 base64（攔截圖片請求時回應用的最小合法圖檔）。 */
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Storage 公開物件的請求路徑特徵（不寫死雲端主機與專案網址）。 */
const STORAGE_URL_PATTERN = '**/storage/v1/object/public/**';
/** Supabase REST 查詢特徵：中斷以強制應用走靜態 JSON 降級路徑。 */
const SUPABASE_REST_PATTERN = '**/rest/v1/**';

/** 攔截所有 Storage 圖片請求並記下被攔到的網址；status 200 回 1x1 PNG，其餘回非圖檔內容。 */
async function mockStoragePhotos(page: Page, captured: string[], status = 200): Promise<void> {
  await page.route(STORAGE_URL_PATTERN, async (route: Route) => {
    captured.push(route.request().url());
    await route.fulfill({
      status,
      contentType: status === 200 ? 'image/png' : 'text/plain',
      // 200 回應內容必須是二進位圖檔本身（不是 data URI 字串），瀏覽器才解得出 img；
      // 非 200 時 body 不可是合法圖檔：Chrome 的 img 載入只要 body 能解碼，
      // 即使 HTTP 狀態是 404 也視為載入成功（onerror 不觸發），因此一律回純文字。
      body: status === 200 ? Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64') : 'Not Found',
    });
  });
}

/**
 * 強制應用走靜態 JSON 降級路徑。
 *
 * 以 HTTP 500 回應 Supabase REST 查詢：postgrest 收到失敗回應後立即結束該次查詢，
 * dataStore 改讀 /data 下的靜態 JSON（與正式降級路徑完全一致）。
 * 刻意不用 route.abort()：supabase-js 對「請求被中斷」會進入內部重試，
 * 資料載入會懸掛在「載入中」而不降級，屬模擬方式的問題，不是應用的問題。
 */
async function forceStaticData(page: Page): Promise<void> {
  await page.route(SUPABASE_REST_PATTERN, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"mock":true}' }),
  );
}

/**
 * 依表名回應 Supabase REST 查詢（僅 recipes 提供帶 photo_url 的資料）。
 *
 * supabase-js 以 range 分頁抓滿整表，回傳列數小於單頁上限即停止，
 * 因此固定回傳小批列即可；其餘表回空陣列。
 */
async function fulfillSupabaseRest(
  route: Route,
  recipes: Record<string, unknown>[],
): Promise<void> {
  const table = new URL(route.request().url()).pathname.split('/').pop() ?? '';
  const body = table === 'recipes' ? recipes : [];
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * Supabase 模式下 recipes 表的最小列（含 photo_url）。
 *
 * 僅需抽屜與對應邏輯用到的欄位；材料嵌入沿用嵌入清單形狀。
 */
const SUPABASE_RECIPE_ROWS: Record<string, unknown>[] = [
  {
    id: 'negroni',
    name_en: 'Negroni',
    name_zh: '尼格羅尼',
    aliases: [],
    collections: ['classic', 'popular'],
    collection: 'classic',
    category: 'aperitivo',
    glass: 'rocks',
    ice: 'stir',
    difficulty: 1,
    abv: '',
    time: '',
    popularity: 3,
    steps: ['攪拌後濾入古典杯'],
    garnish_ids: [],
    flavor: [],
    occasion: [],
    tags: [],
    source_url: 'https://www.iba-world.com/iba-cocktail/negroni/',
    source_site: 'IBA World',
    photo_url: 'https://lqxpimdzkomeiimglugu.supabase.co/storage/v1/object/public/recipe-photos/negroni.webp',
    recipe_ingredients: [
      { ingredient_id: 'gin', amount: 30, unit: 'ml', optional: false, position: 1 },
    ],
  },
];

/** 配方詳情抽屜。 */
function drawer(page: Page) {
  return page.getByRole('dialog');
}

/** 打開抽屜並確認已出現（深層連結模式，避免逐張點卡的不穩定）。 */
async function openRecipe(page: Page, recipeId: string) {
  await page.goto(`/recipe/${recipeId}`);
  await expect(drawer(page)).toBeVisible();
}

test.describe('詳情抽屜示意照片', () => {
  test('有實照的配方顯示照片與「照片：IBA World」來源字', async ({ page }) => {
    // 強制走靜態 JSON 降級（測試環境無 supabase env 時本就是此路徑），
    // 讓 negroni 的 photoUrl 一定來自建置 JSON 的 photo-map 對應。
    await forceStaticData(page);
    const intercepted: string[] = [];
    await mockStoragePhotos(page, intercepted);
    // 先掛上請求等待，再開頁：確保 img 的請求（lazy）已實際發出並被攔截滿足
    const photoRequest = page.waitForRequest(STORAGE_URL_PATTERN);

    await openRecipe(page, 'negroni');
    await photoRequest;

    const photo = drawer(page).getByRole('img', { name: '尼格羅尼 示意照片' });
    await expect(photo).toBeVisible();
    // 網址不寫死雲端網址：從畫面元素取得，確認這個 src 真的以 Storage 請求發出（已被攔截滿足）
    const src = await photo.getAttribute('src');
    expect(src).toContain('/storage/v1/object/public/');
    expect(intercepted).toContain(src);
    await expect(drawer(page).getByText('照片：IBA World')).toBeVisible();
    // 材料表仍在圖片區之後，抽屜捲動內容完整
    await expect(drawer(page).getByRole('heading', { name: '材料' })).toBeVisible();
  });

  test('無實照配方顯示通用杯型插畫，不附來源字', async ({ page }) => {
    // 無實照的插畫是打包資產（非 Storage 請求），理論上不應出現 Storage 請求
    const intercepted: string[] = [];
    await mockStoragePhotos(page, intercepted);
    await forceStaticData(page);

    await openRecipe(page, 'sea-breeze-kaoliang');

    const illustration = drawer(page).getByRole('img', { name: '吹吹海風 示意插畫' });
    await expect(illustration).toBeVisible();
    await expect(drawer(page).getByText('照片：IBA World')).toHaveCount(0);
    expect(intercepted).toEqual([]);
  });

  test('照片載入失敗（404）時退回杯型插畫', async ({ page }) => {
    const intercepted: string[] = [];
    await mockStoragePhotos(page, intercepted, 404);
    await forceStaticData(page);
    const photoRequest = page.waitForRequest(STORAGE_URL_PATTERN);

    // 尼格羅尼有 photoUrl 但 Storage 回 404：onerror 後顯示插畫與無來源字
    await openRecipe(page, 'negroni');
    await photoRequest;

    const illustration = drawer(page).getByRole('img', { name: '尼格羅尼 示意插畫' });
    await expect(illustration).toBeVisible();
    await expect(drawer(page).getByText('照片：IBA World')).toHaveCount(0);
    expect(intercepted.length).toBeGreaterThan(0);
  });

  test('Supabase 模式：photo_url 有值時抽屜顯示照片', async ({ page }) => {
    // 攔截 REST 查詢回假資料（帶 photo_url）；無 Supabase 建置環境時
    // 應用本就走靜態降級，斷言與靜態模式一致（見 scripts 註解與報告）。
    await page.route(SUPABASE_REST_PATTERN, (route) => fulfillSupabaseRest(route, SUPABASE_RECIPE_ROWS));
    const intercepted: string[] = [];
    await mockStoragePhotos(page, intercepted);
    const photoRequest = page.waitForRequest(STORAGE_URL_PATTERN);

    await openRecipe(page, 'negroni');
    await photoRequest;

    const photo = drawer(page).getByRole('img', { name: '尼格羅尼 示意照片' });
    await expect(photo).toBeVisible();
    const src = await photo.getAttribute('src');
    expect(src).toContain('/storage/v1/object/public/');
    expect(intercepted).toContain(src);
    await expect(drawer(page).getByText('照片：IBA World')).toBeVisible();
  });
});
