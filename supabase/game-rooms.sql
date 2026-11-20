-- ============================================================
-- 吹牛骰子遊戲：房間系統（Phase 2）
-- 資料表：game_rooms、game_room_players
-- 寫入一律走 RPC（security definer）；RLS 僅開放 select。
-- 冪等：可重複執行（enum 以 duplicate_object 忽略、
--       資料表 if not exists、publication 先查再加、函式 or replace）。
-- ============================================================

-- 房間狀態：等待中 / 遊戲中 / 已結束 / 已關閉
do $$
begin
  create type game_room_status as enum ('waiting', 'playing', 'ended', 'closed');
exception
  when duplicate_object then null;
end $$;

-- 房間主檔：room_id 為 6 碼英數（不易混淆字元集），last_activity_at 供閒置關閉
create table if not exists game_rooms (
  room_id          text primary key
                   check (length(room_id) = 6 and room_id ~ '^[A-HJKMNP-Z2-9]{6}$'),
  host_id          uuid not null references auth.users(id) on delete cascade,
  dice_count       int not null default 5 check (dice_count between 2 and 5),
  turn_seconds     int not null default 15 check (turn_seconds between 5 and 30),
  status           game_room_status not null default 'waiting',
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- 房內玩家：seat 由 1 起算（建立者為 1），每人一席、每席一人
create table if not exists game_room_players (
  room_id   text not null references game_rooms(room_id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  seat      int  not null check (seat between 1 and 8),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat)
);

-- 房間人數上限（最多 8 人）：資料層守門，RPC 之外也擋
create or replace function guard_room_player_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from game_room_players where room_id = new.room_id) >= 8 then
    raise exception '房間已滿';
  end if;
  return new;
end $$;

drop trigger if exists game_room_players_cap on game_room_players;
create trigger game_room_players_cap
  before insert on game_room_players
  for each row execute function guard_room_player_cap();

-- 列入 supabase_realtime publication（已存在則跳過，冪等）
do $$
declare
  t text;
begin
  foreach t in array array['game_rooms', 'game_room_players'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============ RLS：僅開放讀取，寫入只經 RPC ============
alter table game_rooms        enable row level security;
alter table game_room_players enable row level security;

drop policy if exists "任何人可讀房間" on game_rooms;
create policy "任何人可讀房間" on game_rooms
  for select to anon, authenticated using (true);

drop policy if exists "任何人可讀房內玩家" on game_room_players;
create policy "任何人可讀房內玩家" on game_room_players
  for select to anon, authenticated using (true);

-- ============ RPC（security definer，內部以 auth.uid() 驗身） ============
-- 錯誤訊息為簡短繁中，前端直接轉成提示文字。

-- 產生一組不重複的 6 碼房間 ID：
-- 字元集去掉易混淆的 I、L、O 與 0、1；先查表確認唯一再使用。
create or replace function generate_room_id() returns text
language plpgsql security definer set search_path = public as $$
declare
  charset constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    select string_agg(
             substr(charset, 1 + floor(random() * length(charset))::int, 1), ''
           )
      into candidate
      from generate_series(1, 6);
    -- 不易混淆字元集 + 檢查通過才回傳，避免撞上既有房間
    if candidate is not null
       and candidate ~ '^[A-HJKMNP-Z2-9]{6}$'
       and not exists (select 1 from game_rooms where room_id = candidate) then
      return candidate;
    end if;
  end loop;
end $$;

-- 建立房間：呼叫者成為房主並坐 1 號位，回傳房間 ID。
create or replace function create_room(
  p_dice_count int default 5,
  p_turn_seconds int default 15
) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_id text;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  if p_dice_count not between 2 and 5 then
    raise exception '骰子數須介於 2 與 5 之間';
  end if;
  if p_turn_seconds not between 5 and 30 then
    raise exception '思考時間須介於 5 與 30 秒之間';
  end if;

  -- 撞號（機率極低）時重試；人數上限由觸發器守門
  for attempt in 1..10 loop
    new_id := generate_room_id();
    begin
      insert into game_rooms (room_id, host_id, dice_count, turn_seconds)
        values (new_id, uid, p_dice_count, p_turn_seconds);
      insert into game_room_players (room_id, user_id, seat)
        values (new_id, uid, 1);
      return new_id;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception '房間建立失敗，請再試一次';
end $$;

-- 加入房間：驗存在、狀態、人數；已是成員則冪等返回。
create or replace function join_room(p_room_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
  current_status game_room_status;
  member_count int;
  next_seat int;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  select r.status,
         (select count(*) from game_room_players p where p.room_id = r.room_id)
    into current_status, member_count
    from game_rooms r
    where r.room_id = target;
  if not found then
    raise exception '房間不存在';
  end if;
  if current_status <> 'waiting' then
    raise exception '房間已開始，無法加入';
  end if;
  if member_count >= 8 then
    raise exception '房間已滿';
  end if;
  -- 冪等重入：已是成員只更新活動時間
  if exists (select 1 from game_room_players
             where room_id = target and user_id = uid) then
    update game_rooms set last_activity_at = now() where room_id = target;
    return;
  end if;

  select coalesce(max(seat), 0) + 1 into next_seat
    from game_room_players where room_id = target;
  begin
    insert into game_room_players (room_id, user_id, seat)
      values (target, uid, next_seat);
  exception when unique_violation then
    -- 兩人同時補入最後席位的競態：改為可重試的繁中訊息
    raise exception '加入房間發生競態，請再試一次' using errcode = '23505';
  end;
  update game_rooms set last_activity_at = now() where room_id = target;
end $$;

-- 離開房間：房主離開時移交給 seat 最小者；房內無人則關房。（僅成員可觸發活動時間更新）
create or replace function leave_room(p_room_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
  r_host uuid;
  is_member boolean;
begin
  if uid is null then return; end if;
  select r.host_id,
         exists (select 1 from game_room_players p
                  where p.room_id = r.room_id and p.user_id = uid)
    into r_host, is_member
    from game_rooms r
    where r.room_id = target;
  -- 房間不存在或自己不是成員：冪等返回（不更新活動時間，
  -- 避免非成員反覆刷新讓閒置關閉永遠不觸發）
  if not found then return; end if;
  if not is_member then return; end if;

  delete from game_room_players where room_id = target and user_id = uid;
  if r_host = uid then
    -- 房主移交：新任房主取剩餘成員中 seat 最小者（SQL 內驗證為成員）；
    -- 已無成員則關房。
    update game_rooms r set
      host_id = coalesce(
        (select p.user_id from game_room_players p
          where p.room_id = r.room_id order by p.seat asc limit 1),
        r.host_id),
      status = case
        when exists (select 1 from game_room_players p
                     where p.room_id = r.room_id) then r.status
        else 'closed'::game_room_status end,
      last_activity_at = now()
      where r.room_id = target;
  else
    update game_rooms set last_activity_at = now() where room_id = target;
  end if;
end $$;

-- 更新房間設定：僅房主、僅 waiting；傳 null 的項目維持原值。
create or replace function update_room_settings(
  p_room_id text,
  p_dice_count int default null,
  p_turn_seconds int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
  r game_rooms%rowtype;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  select * into r from game_rooms where room_id = target;
  if not found then
    raise exception '房間不存在';
  end if;
  if r.host_id <> uid then
    raise exception '只有房主可以調整設定';
  end if;
  if r.status <> 'waiting' then
    raise exception '遊戲開始後不可調整設定';
  end if;
  if p_dice_count is not null and p_dice_count not between 2 and 5 then
    raise exception '骰子數須介於 2 與 5 之間';
  end if;
  if p_turn_seconds is not null and p_turn_seconds not between 5 and 30 then
    raise exception '思考時間須介於 5 與 30 秒之間';
  end if;

  update game_rooms set
    dice_count = coalesce(p_dice_count, r.dice_count),
    turn_seconds = coalesce(p_turn_seconds, r.turn_seconds),
    last_activity_at = now()
    where room_id = target;
end $$;

-- 關閉房間：僅房主；waiting 或 playing 均可關。
create or replace function close_room(p_room_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
  r game_rooms%rowtype;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  select * into r from game_rooms where room_id = target;
  if not found then
    raise exception '房間不存在';
  end if;
  if r.host_id <> uid then
    raise exception '只有房主可以關閉房間';
  end if;
  if r.status = 'closed' then
    return;
  end if;
  update game_rooms set status = 'closed', last_activity_at = now()
    where room_id = target;
end $$;

-- 踢除玩家：僅房主、僅 waiting；不可踢房主本人。
create or replace function kick_player(p_room_id text, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
  r game_rooms%rowtype;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  select * into r from game_rooms where room_id = target;
  if not found then
    raise exception '房間不存在';
  end if;
  if r.host_id <> uid then
    raise exception '只有房主可以移除玩家';
  end if;
  if r.status <> 'waiting' then
    raise exception '遊戲開始後不可移除玩家';
  end if;
  if p_user_id = uid then
    raise exception '房主不可移除自己';
  end if;
  if not exists (select 1 from game_room_players
                 where room_id = target and user_id = p_user_id) then
    raise exception '該玩家不在房間內';
  end if;
  delete from game_room_players where room_id = target and user_id = p_user_id;
  update game_rooms set last_activity_at = now() where room_id = target;
end $$;

-- 心跳：已成員更新 last_activity_at（presence 心跳共用欄位；
-- 非成員或房間不存在時靜默返回，不讓心跳拋錯打斷前端）。
create or replace function heartbeat_room(p_room_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
begin
  if uid is null then return; end if;
  update game_rooms r set last_activity_at = now()
    where r.room_id = target
      and exists (select 1 from game_room_players p
                   where p.room_id = r.room_id and p.user_id = uid);
end $$;

-- 房間成員清單（含 display_name）：大廳畫面用。
-- profiles 的 RLS 僅本人可讀，故以 security definer 取得房內成員的顯示名稱；
-- game_room_players 本身為公開讀取，此函式僅放寫「名字」這個欄位範圍。
create or replace function room_member_list(p_room_id text)
returns table (
  user_id      uuid,
  seat         int,
  joined_at    timestamptz,
  display_name text
)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.seat, p.joined_at, pr.display_name
    from game_room_players p
    left join profiles pr on pr.id = p.user_id
    where p.room_id = upper(trim(p_room_id))
    order by p.seat asc
$$;

-- 提醒：本階段不做自動閒置關閉的排程（last_activity_at 欄位已備妥，
-- 之後以 pg_cron 或應用端排程依「閒置 30 分鐘 closed」處理）。
