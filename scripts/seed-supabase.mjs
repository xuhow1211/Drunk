#!/usr/bin/env node
/**
 * 將 src/data/*.json 的靜態資料遷移（冪等灌入）到 Supabase。
 *
 * 用法：
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ACCESS_TOKEN=<sbp_token> \
 *   node scripts/seed-supabase.mjs
 *
 * 規則：
 *   - 依賴順序：ingredients → substitutions → recipes → recipe_ingredients
 *   - 全部使用 upsert，重複執行不會出錯、內容維持一致
 *   - token 只透過環境變數注入，不寫進任何檔案
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPhotoMap } from './photo-map.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const OUT_DIR = path.join(ROOT_DIR, 'src', 'data');

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const PROJECT_REF = SUPABASE_URL?.replace(/^https:\/\//, '').split('.')[0];
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const API_BASE = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

if (!PROJECT_REF || !TOKEN) {
  console.error('錯誤：請設定 SUPABASE_URL 與 SUPABASE_ACCESS_TOKEN 環境變數。');
  process.exit(1);
}

/** SQL 字串字面值跳脫（單引號加倍）。 */
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;

const qText = (v, fallback = 'null') =>
  v === null || v === undefined ? fallback : q(v);

const qTextArr = (v, fallback = "'{}'") =>
  Array.isArray(v) && v.length > 0
    ? `ARRAY[${v.map((x) => q(x)).join(',')}]::text[]`
    : fallback;

const qNum = (v) => (v === null || v === undefined || v === '' ? 'null' : Number(v));

async function runQuery(statements, label) {
  const sql = statements.join('\n');
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[失敗] ${label}（HTTP ${res.status}）：${body.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`[完成] ${label}`);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const ingredients = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, 'ingredients.json'), 'utf8'),
  );
  const cocktails = JSON.parse(
    fs.readFileSync(path.join(OUT_DIR, 'cocktails.json'), 'utf8'),
  );

  // ---- 1. 食材 ----
  const ingredientRows = cocktails.ingredients?.length
    ? cocktails.ingredients
    : ingredients.ingredients;
  for (const [i, part] of chunk(
    ingredientRows.map(
      (x) => `insert into ingredients (id, zh, en, category, common, aliases)
values (${q(x.id)}, ${q(x.zh)}, ${qText(x.en, `''`)}, ${q(x.category)}, ${Boolean(x.common)}, ${qTextArr(x.aliases)})
on conflict (id) do update set
  zh = excluded.zh, en = excluded.en, category = excluded.category,
  common = excluded.common, aliases = excluded.aliases;`,
    ),
    100,
  ).entries()) {
    await runQuery(part, `ingredients 批次 ${i + 1}`);
  }

  // ---- 2. 替代規則（from → to[]，展開成每列一個替代對） ----
  const subRows = [];
  for (const s of ingredients.substitutions) {
    const toQualities = Array.isArray(s.toQualities) ? s.toQualities : [];
    for (const to of s.to) {
      const quality = toQualities.find((t) => t.id === to)?.quality ?? s.quality;
      subRows.push({ from_id: s.from, to_id: to, quality, note: s.note });
    }
  }
  for (const [i, part] of chunk(
    subRows.map(
      (x) => `insert into substitutions (from_id, to_id, quality, note)
values (${q(x.from_id)}, ${q(x.to_id)}, ${q(x.quality)}, ${qText(x.note)})
on conflict (from_id, to_id) do update set quality = excluded.quality, note = excluded.note;`,
    ),
    100,
  ).entries()) {
    await runQuery(part, `substitutions 批次 ${i + 1}`);
  }

  // ---- 3. 配方主檔 ----
  for (const [i, part] of chunk(
    cocktails.recipes.map(
      (r) => `insert into recipes (id, name_en, name_zh, aliases, collections, category, glass, ice, difficulty, abv, time, popularity, steps, garnish_ids, flavor, occasion, tags, source_url, source_site)
values (
  ${q(r.id)}, ${q(r.nameEn)}, ${q(r.nameZh)}, ${qTextArr(r.aliases)}, ${qTextArr(r.collections)},
  ${q(r.category)}, ${q(r.glass)}, ${q(r.ice)}, ${q(r.difficulty)}, ${qText(r.abv)}, ${qText(r.time)},
  ${qNum(r.popularity ?? 1)}, ${qTextArr(r.steps)}, ${qTextArr(r.garnishIds)}, ${qTextArr(r.flavor)},
  ${qTextArr(r.occasion)}, ${qTextArr(r.tags)}, ${qText(r.sourceUrl)}, ${qText(r.sourceSite)}
)
on conflict (id) do update set
  name_en = excluded.name_en, name_zh = excluded.name_zh, aliases = excluded.aliases,
  collections = excluded.collections, category = excluded.category, glass = excluded.glass,
  ice = excluded.ice, difficulty = excluded.difficulty, abv = excluded.abv, time = excluded.time,
  popularity = excluded.popularity, steps = excluded.steps, garnish_ids = excluded.garnish_ids,
  flavor = excluded.flavor, occasion = excluded.occasion, tags = excluded.tags,
  source_url = excluded.source_url, source_site = excluded.source_site, updated_at = now();`,
    ),
    50,
  ).entries()) {
    await runQuery(part, `recipes 批次 ${i + 1}`);
  }

  // ---- 4. 配方材料（每杯先刪後插，確保用量異動完整同步） ----
  for (const [i, part] of chunk(
    cocktails.recipes.flatMap((r) => [
      `delete from recipe_ingredients where recipe_id = ${q(r.id)};`,
      ...r.ingredients.map(
        (ing, idx) => `insert into recipe_ingredients (recipe_id, ingredient_id, amount, unit, optional, position)
values (${q(r.id)}, ${q(ing.id)}, ${qNum(ing.amount ?? null)}, ${qText(ing.unit)}, ${Boolean(ing.optional)}, ${idx});`,
      ),
    ]),
    80,
  ).entries()) {
    await runQuery(part, `recipe_ingredients 批次 ${i + 1}`);
  }

  await seedPhotoUrls(cocktails.recipes);

  console.log('遷移完成。');
}

/**
 * 補灌示意照片欄位（photo_url）。
 *
 * 僅在有 photo-map 時執行：data/photo-map.json 由 scripts/fetch-iba-photos.mjs
 * 產出（尚未抓圖前不存在），此階段為每筆照片下 UPDATE 冪等語句，
 * 重複執行結果相同；photo-map 中的非法網址已在建置端過濾，此處只採用配方上
 * 實際套到的網址（與建置產物一致）。
 *
 * @param {object[]} recipes 建置產物的配方清單
 */
async function seedPhotoUrls(recipes) {
  const photoMap = readPhotoMap(path.join(ROOT_DIR, 'data', 'photo-map.json'));
  if (!photoMap) {
    console.log('未提供 photo-map，略過 photo_url 補灌。');
    return;
  }
  const photoUrls = photoMap.photos ?? {};
  const photoUrlOf = (recipeId) => {
    const url = photoUrls[recipeId]?.url;
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  };
  const seedRows = recipes
    .map((r) => ({ id: r.id, url: photoUrlOf(r.id) }))
    .filter((r) => r.url !== null)
    .map((r) => `update recipes set photo_url = ${q(r.url)} where id = ${q(r.id)};`);
  if (seedRows.length === 0) {
    console.log('photo-map 沒有可套用的照片，略過 photo_url 補灌。');
    return;
  }
  for (const [i, part] of chunk(seedRows, 100).entries()) {
    await runQuery(part, `photo_url 批次 ${i + 1}`);
  }
  console.log(`[完成] photo_url 補灌（${seedRows.length} 杯）`);
}

main();
