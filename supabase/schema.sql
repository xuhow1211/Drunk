-- join 這麼喝：Supabase 資料庫 schema
-- 依「分析報告-雲端部署與資料庫整合規劃」第四節建立。
-- 幂等：可重複執行（使用 if not exists 與 on conflict do nothing）。

-- 食材（沿用建置腳本對照表的 id）
create table if not exists ingredients (
  id         text primary key,              -- 'gin'
  zh         text not null,
  en         text not null default '',
  category   text not null,                 -- base-spirit / liqueur / mixer ...
  common     boolean not null default false,
  aliases    text[] not null default '{}'
);

-- 替代規則（缺料比對的依據）
create table if not exists substitutions (
  id            bigint generated always as identity primary key,
  from_id       text not null references ingredients(id) on delete cascade,
  to_id         text not null references ingredients(id) on delete cascade,
  quality       text not null check (quality in ('same','close','cross')),
  note          text,
  unique (from_id, to_id)
);

-- 配方主檔
create table if not exists recipes (
  id           text primary key,            -- 'negroni'
  name_en      text not null,
  name_zh      text not null,
  aliases      text[] not null default '{}',
  collections  text[] not null default '{}',  -- ['classic','popular']
  category     text not null,
  glass        text not null,
  ice          text not null,
  difficulty   int  not null check (difficulty between 1 and 3),
  abv          text,
  time         text,
  popularity   int  not null default 1,
  steps        text[] not null default '{}',
  garnish_ids  text[] not null default '{}',
  flavor       text[] not null default '{}',
  occasion     text[] not null default '{}',
  tags         text[] not null default '{}',
  source_url   text,
  source_site  text,
  photo_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 示意照片（IBA World 實照的公開網址，尚未抓取的杯為 null）。
-- 幂等：create table 內的欄位對新資料庫生效；此語句讓既有資料庫補上同一欄位，
-- 重複執行無副作用，可整份重跑。
alter table recipes add column if not exists photo_url text;

-- 配方材料（含用量與選用旗標）
create table if not exists recipe_ingredients (
  id            bigint generated always as identity primary key,
  recipe_id     text not null references recipes(id) on delete cascade,
  ingredient_id text not null references ingredients(id) on delete cascade,
  amount        numeric,
  unit          text,
  optional      boolean not null default false,
  position      int not null default 0,
  unique (recipe_id, ingredient_id)
);

-- 使用者檔案（延伸 auth.users）
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'user' check (role in ('user','admin')),
  created_at   timestamptz not null default now()
);

-- 使用者手邊材料（跨裝置同步）
create table if not exists user_pantry (
  user_id       uuid not null references auth.users(id) on delete cascade,
  ingredient_id text not null references ingredients(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, ingredient_id)
);

-- 收藏
create table if not exists favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  text not null references recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

-- 索引（查詢路徑：配方列表、比對引擎、收藏與手邊材料）
create index if not exists recipe_ingredients_recipe_idx on recipe_ingredients (recipe_id, position);
create index if not exists recipe_ingredients_ingredient_idx on recipe_ingredients (ingredient_id);
create index if not exists substitutions_from_idx on substitutions (from_id);
create index if not exists substitutions_to_idx on substitutions (to_id);
create index if not exists user_pantry_ingredient_idx on user_pantry (ingredient_id);
create index if not exists favorites_recipe_idx on favorites (recipe_id);
create index if not exists recipes_collections_idx on recipes using gin (collections);
create index if not exists recipes_tags_idx on recipes using gin (tags);

-- updated_at 自動更新
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists recipes_touch_updated_at on recipes;
create trigger recipes_touch_updated_at before update on recipes
  for each row execute function touch_updated_at();

-- 新註冊使用者自動建立 profiles
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- 保護 role 欄位：帶 JWT 的連線（瀏覽器、anon key）不得修改 role；
-- 直接以 SQL 編輯器指定管理員（無 JWT）不受此限。
create or replace function guard_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('request.jwt.claims', true) is not null
     and new.role is distinct from old.role then
    raise exception 'role 不可由使用者自行修改';
  end if;
  return new;
end $$;

drop trigger if exists profile_guard_role on profiles;
create trigger profile_guard_role before update on profiles
  for each row execute function guard_profile_role();

-- 管理員判斷（RLS 政策共用；security definer 避免遞迴檢查 profiles RLS）
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ============ RLS ============
alter table ingredients        enable row level security;
alter table substitutions      enable row level security;
alter table recipes            enable row level security;
alter table recipe_ingredients enable row level security;
alter table profiles           enable row level security;
alter table user_pantry        enable row level security;
alter table favorites          enable row level security;

-- 讀取：任何人（含未登入訪客）
drop policy if exists "任何人可讀食材" on ingredients;
create policy "任何人可讀食材" on ingredients
  for select to anon, authenticated using (true);
drop policy if exists "任何人可讀替代規則" on substitutions;
create policy "任何人可讀替代規則" on substitutions
  for select to anon, authenticated using (true);
drop policy if exists "任何人可讀配方" on recipes;
create policy "任何人可讀配方" on recipes
  for select to anon, authenticated using (true);
drop policy if exists "任何人可讀配方材料" on recipe_ingredients;
create policy "任何人可讀配方材料" on recipe_ingredients
  for select to anon, authenticated using (true);

-- 寫入：僅管理員
drop policy if exists "管理員可寫食材" on ingredients;
create policy "管理員可寫食材" on ingredients
  for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "管理員可寫替代規則" on substitutions;
create policy "管理員可寫替代規則" on substitutions
  for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "管理員可寫配方" on recipes;
create policy "管理員可寫配方" on recipes
  for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "管理員可寫配方材料" on recipe_ingredients;
create policy "管理員可寫配方材料" on recipe_ingredients
  for all to authenticated using (is_admin()) with check (is_admin());

-- profiles：僅本人可讀可改（role 由觸發器保護）
drop policy if exists "本人可讀自己的檔案" on profiles;
create policy "本人可讀自己的檔案" on profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists "本人可更新自己的檔案" on profiles;
create policy "本人可更新自己的檔案" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 手邊材料與收藏：僅本人
drop policy if exists "本人可管理自己的手邊材料" on user_pantry;
create policy "本人可管理自己的手邊材料" on user_pantry
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "本人可管理自己的收藏" on favorites;
create policy "本人可管理自己的收藏" on favorites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
