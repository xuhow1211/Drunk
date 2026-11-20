-- ============================================================
-- 吹牛骰子遊戲：遊戲核心（Phase 3＋Phase 4 增修）
-- 資料表：game_sessions、game_rounds、game_player_state、
--         game_player_dice、game_actions、player_statistics
-- RPC：start_game／submit_bid／challenge_bid／sync_timeout（Phase 3）、
--      replay_room（Phase 4：房主重開回到等待中）
-- 寫入一律走 RPC（security definer）；RLS 僅開放 select，
-- game_player_dice 私有列僅本人可讀（realtime 依 RLS 過濾）。
-- 冪等：可重複執行（資料表 if not exists、publication 先查再加、
--       函式 or replace、policy drop if exists 再建）。
-- 注意：本檔為冪等腳本，重執不會清遊戲資料；正式庫由主控執行。
-- ============================================================

-- ============ 資料表 ============

-- 遊戲局主檔：一間房開始一次遊戲建一筆 session。
create table if not exists game_sessions (
  id           bigint generated always as identity primary key,
  room_id      text not null references game_rooms(room_id) on delete cascade,
  dice_count   int  not null check (dice_count between 2 and 5),
  turn_seconds int  not null check (turn_seconds between 5 and 30),
  started_at   timestamptz not null default now(),
  winner       uuid null references auth.users(id) on delete set null,
  ended_at     timestamptz null,
  settled_at   timestamptz null
);

-- 回合：bid_* 為目前喊牌（bid_seq 為本回合第幾手，0 表示尚未喊牌）。
-- reveal 僅在開盅時寫入（resolving／round_end），屬刻意公開的全員骰子。
create table if not exists game_rounds (
  session_id   bigint not null references game_sessions(id) on delete cascade,
  round_no     int    not null check (round_no >= 1),
  current_seat int    not null check (current_seat between 1 and 8),
  bid_count    int    null check (bid_count >= 1),
  bid_face     int    null check (bid_face between 1 and 6),
  bid_user     uuid   null references auth.users(id) on delete set null,
  bid_seq      int    not null default 0,
  deadline_at  timestamptz not null,
  status       text   not null
                   check (status in ('bidding','resolving','round_end','ended')),
  reveal       jsonb  null,
  resolve_note text   null,
  primary key (session_id, round_no)
);

-- 玩家局內狀態：seat 為開局時的座位快照，dice_left 歸零即淘汰。
create table if not exists game_player_state (
  session_id bigint not null references game_sessions(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  seat       int    not null check (seat between 1 and 8),
  dice_left  int    not null default 0 check (dice_left >= 0),
  eliminated boolean not null default false,
  primary key (session_id, user_id)
);

-- 每回合的私有骰子：RLS 僅本人可讀，寫入只經 RPC。
create table if not exists game_player_dice (
  session_id bigint not null references game_sessions(id) on delete cascade,
  round_no   int    not null,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  dice       int[]  not null,
  primary key (session_id, round_no, user_id)
);

-- 操作紀錄：喊牌、質疑與系統代打（逾時）的歷史軌跡。
create table if not exists game_actions (
  session_id bigint not null references game_sessions(id) on delete cascade,
  seq        bigint generated always as identity,
  round_no   int    not null,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  action     text   not null
                    check (action in ('bid','challenge','timeout_bid','timeout_challenge')),
  count      int    null check (count >= 1),
  face       int    null check (face between 1 and 6),
  created_at timestamptz not null default now(),
  primary key (session_id, seq)
);

-- 個人累積戰績：僅正式結束的局計入，結算由 RPC 冪等維護。
create table if not exists player_statistics (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  games          int not null default 0,
  wins           int not null default 0,
  current_streak int not null default 0,
  best_streak    int not null default 0,
  last_played_at timestamptz null
);

-- 大廳導向 play 頁時的查找用索引（一房多局：取最新一局）。
create index if not exists game_sessions_room_idx on game_sessions (room_id, started_at desc);

-- ============ RLS：僅開放讀取，寫入只經 RPC ============
alter table game_sessions      enable row level security;
alter table game_rounds        enable row level security;
alter table game_player_state  enable row level security;
alter table game_player_dice   enable row level security;
alter table game_actions       enable row level security;
alter table player_statistics  enable row level security;

-- 公開表：全員可讀（骰子值不在任何公開欄位中；reveal 由開盅時刻意公開）
drop policy if exists "任何人可讀局況" on game_sessions;
create policy "任何人可讀局況" on game_sessions
  for select to anon, authenticated using (true);

drop policy if exists "任何人可讀回合" on game_rounds;
create policy "任何人可讀回合" on game_rounds
  for select to anon, authenticated using (true);

drop policy if exists "任何人可讀玩家局內狀態" on game_player_state;
create policy "任何人可讀玩家局內狀態" on game_player_state
  for select to anon, authenticated using (true);

drop policy if exists "任何人可讀操作紀錄" on game_actions;
create policy "任何人可讀操作紀錄" on game_actions
  for select to anon, authenticated using (true);

drop policy if exists "任何人可讀戰績" on player_statistics;
create policy "任何人可讀戰績" on player_statistics
  for select to anon, authenticated using (true);

-- 私有表：每回合骰子僅本人（realtime 端同樣依此過濾推送）
drop policy if exists "本人可讀自己的骰子" on game_player_dice;
create policy "本人可讀自己的骰子" on game_player_dice
  for select to authenticated using (user_id = auth.uid());

-- ============ 列入 realtime publication（已存在則跳過，冪等） ============
-- game_player_dice 一併列入：realtime 依 RLS 過濾，每人只收到自己那一列。
do $$
declare
  t text;
begin
  foreach t in array array['game_sessions', 'game_rounds', 'game_player_state', 'game_player_dice'] loop
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

-- ============ 內部共用函式（僅供本檔 RPC 呼叫，已撤銷外部執行權） ============

-- 擲 n 顆骰子成一陣列（1..6）。
create or replace function _roll_many(p_count int) returns int[]
language sql volatile security definer set search_path = public as $$
  select coalesce(array_agg(1 + floor(random() * 6)::int), '{}')
    from generate_series(1, greatest(p_count, 0))
$$;

-- 取 p_after_seat 之後的第一個未淘汰座位（超過 8 席時繞回 1 起算）。
create or replace function _next_alive_seat(p_session_id bigint, p_after_seat int)
returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(p.seat) from game_player_state p
      where p.session_id = p_session_id
        and p.seat > p_after_seat
        and p.eliminated = false),
    (select min(p.seat) from game_player_state p
      where p.session_id = p_session_id
        and p.seat <= p_after_seat
        and p.eliminated = false))
$$;

-- 顯示名稱：profiles 缺值時以「玩家」呈現（security definer 才能讀到名字）。
create or replace function _display_name(p_user_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(pr.display_name), ''), '玩家')
    from profiles pr where pr.id = p_user_id
$$;

-- 冪等結算：settled_at 為 null 時，全員 games +1、勝者 wins 與連勝維護。
create or replace function _settle_statistics(p_session_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- 二段更新（先清零再進勝者）＋ settled_at 競態守門：
  -- 只有「由 null 改為時間戳」的那一次呼叫會結算。
  update game_sessions set settled_at = now()
    where id = p_session_id and settled_at is null;
  if not found then
    return;
  end if;
  -- 全員納入統計（無資料者先補一列），遊戲數 +1
  insert into player_statistics (user_id)
    select user_id from game_player_state where session_id = p_session_id
    on conflict (user_id) do nothing;
  update player_statistics st
    set games = st.games + 1,
        last_played_at = now()
    from game_player_state ps
    where ps.session_id = p_session_id and st.user_id = ps.user_id;
  -- 敗者連勝歸零（勝者不在此次清零）
  update player_statistics st
    set current_streak = 0
    from game_player_state ps
    where ps.session_id = p_session_id
      and st.user_id = ps.user_id
      and st.user_id <> (select winner from game_sessions where id = p_session_id);
  -- 勝者累加勝場與連勝
  update player_statistics st
    set wins = st.wins + 1,
        current_streak = st.current_streak + 1,
        best_streak = greatest(st.best_streak, st.current_streak + 1)
    from game_sessions s
    where s.id = p_session_id and s.winner = st.user_id;
end $$;

-- 建立下一回合：重新擲骰（每位存活玩家 dice_left 顆）、座位接在
-- p_after_seat 之後、deadline 重設、bid_seq 歸 0。
create or replace function _start_next_round(
  p_session_id bigint,
  p_next_round_no int,
  p_after_seat int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s game_sessions%rowtype;
  next_seat int;
  rec record;
begin
  select * into s from game_sessions where id = p_session_id;
  select _next_alive_seat(p_session_id, p_after_seat) into next_seat;
  for rec in select p.user_id, p.dice_left
               from game_player_state p
              where p.session_id = p_session_id and p.eliminated = false loop
    insert into game_player_dice (session_id, round_no, user_id, dice)
      values (p_session_id, p_next_round_no, rec.user_id, _roll_many(rec.dice_left));
  end loop;
  insert into game_rounds (session_id, round_no, current_seat, status, deadline_at)
    values (p_session_id, p_next_round_no, next_seat, 'bidding',
            now() + make_interval(secs => s.turn_seconds));
end $$;

-- 開盅與後續流轉：呼叫者須已驗「本回合 bidding 且 bid_seq > 0」並鎖定 session。
--   本回合 → status='resolving'（廣播過場）→ 計算 → round_end（公開 reveal）
--   存活 ≤ 1 → 勝者、ended_at、冪等結算、房間轉 'ended'
--   否則 → 直接生成下一回合（bidding），本回合留 round_end 供顯示。
--   事件順序：round_end＋reveal 先於下一回合的 INSERT 送出，
--   否則客戶端（以 round_no 保留最新）會丟棄 reveal 事件。
create or replace function _open_pot(
  p_session_id bigint,
  p_actor uuid,
  p_action text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s game_sessions%rowtype;
  r game_rounds%rowtype;
  v_reveal jsonb;
  matched int := 0;
  loser uuid;
  loser_seat int;
  loser_out boolean;
  alive_count int;
  last_alive uuid;
  note text;
  bidder_name text;
  challenger_name text;
  loser_name text;
begin
  select * into s from game_sessions where id = p_session_id;
  select * into r from game_rounds
    where session_id = p_session_id
    order by round_no desc limit 1;

  -- 過場事件：本回合先落到 resolving（realtime 會送出過場事件）
  update game_rounds set status = 'resolving'
    where session_id = p_session_id and round_no = r.round_no;

  -- 公開全員骰子
  select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'dice', d.dice)
                   order by ps.seat)
    into v_reveal
    from game_player_dice d
    join game_player_state ps on ps.session_id = d.session_id and ps.user_id = d.user_id
    where d.session_id = p_session_id and d.round_no = r.round_no;

  -- 實際符合數（1 點為萬用骰：喊 2~6 點時 1 會一併計入）
  select coalesce(sum(case
    when f = r.bid_face then 1
    when f = 1 and r.bid_face <> 1 then 1
    else 0 end), 0)
    into matched
    from game_player_dice d
    cross join unnest(d.dice) as f
    where d.session_id = p_session_id and d.round_no = r.round_no;

  -- 輸家：實際數 < 喊數 → 喊牌者輸；否則質疑者輸
  loser := case when matched < r.bid_count then r.bid_user else p_actor end;
  select p.seat into loser_seat
    from game_player_state p
    where p.session_id = p_session_id and p.user_id = loser;

  -- 輸家 - 1 顆骰子；歸零即淘汰
  update game_player_state
    set dice_left = dice_left - 1,
        eliminated = (dice_left - 1) <= 0
    where session_id = p_session_id and user_id = loser
    returning eliminated into loser_out;

  select count(*) into alive_count
    from game_player_state
    where session_id = p_session_id and eliminated = false;
  select user_id into last_alive
    from game_player_state
    where session_id = p_session_id and eliminated = false
    limit 1;

  bidder_name := _display_name(r.bid_user);
  challenger_name := _display_name(p_actor);
  loser_name := _display_name(loser);
  note := format('%s 質疑 %s 的「%s 個 %s 點」：開盅實際符合 %s 個（含萬用骰），%s 失去 1 顆骰子。',
                 challenger_name, bidder_name, r.bid_count, r.bid_face, matched, loser_name)
          || case when loser_out then ' ' || loser_name || ' 已被淘汰。' else '' end;

  -- 本回合落成 round_end（公開 reveal）：須在生成下一回合「之前」發布事件，
  -- 客戶端以 round_no 保留最新回合，若下一回合（round_no+1）先送達，
  -- 這筆 round_end＋reveal 事件會被丟棄，開盅畫面將不會出現。
  update game_rounds
    set status = case when alive_count <= 1 then 'ended' else 'round_end' end,
        reveal = v_reveal,
        resolve_note = note
    where session_id = p_session_id and round_no = r.round_no;

  if alive_count <= 1 then
    -- 遊戲結束：勝者僅存一人（最後存活的玩家；理論上不為 null，保底防呆）
    update game_sessions set winner = last_alive, ended_at = now()
      where id = p_session_id and winner is null;
    perform _settle_statistics(p_session_id);
    -- 房間狀態同步轉為已結束（讓大廳端的訂閱也看得到收尾）
    update game_rooms set status = 'ended', last_activity_at = now()
      where room_id = s.room_id;
  else
    -- 生成下一回合（bidding；round_end 事件已先送出，見上）
    perform _start_next_round(p_session_id, r.round_no + 1, loser_seat);
  end if;

  insert into game_actions (session_id, round_no, user_id, action)
    values (p_session_id, r.round_no, p_actor, p_action);
end $$;

-- 逾時代理：deadline 已過時處理當前回合（首喊代喊 (1,1)、續喊代質疑）。
-- 呼叫者須已鎖定 session；回合不在 bidding 或尚未逾時時為無操作（冪等）。
create or replace function _apply_timeout(p_session_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r game_rounds%rowtype;
  actor uuid;
  next_seat int;
begin
  select * into r from game_rounds
    where session_id = p_session_id
    order by round_no desc limit 1;
  -- 回合不在喊牌階段：無操作（遊戲結束、開盅中、逾時已處理過）
  if not found or r.status <> 'bidding' then
    return;
  end if;
  if now() < r.deadline_at then
    return;
  end if;

  select user_id into actor from game_player_state
    where session_id = p_session_id and seat = r.current_seat and eliminated = false;
  if actor is null then
    return;
  end if;

  if r.bid_seq = 0 then
    -- 首喊逾時：自動代喊最小合法牌「1 個 1 點」
    select _next_alive_seat(p_session_id, r.current_seat) into next_seat;
    update game_rounds set
      bid_seq = r.bid_seq + 1,
      bid_count = 1,
      bid_face = 1,
      bid_user = actor,
      current_seat = next_seat,
      deadline_at = now() + make_interval(secs => (
        select turn_seconds from game_sessions where id = p_session_id))
      where session_id = p_session_id and round_no = r.round_no;
    insert into game_actions (session_id, round_no, user_id, action, count, face)
      values (p_session_id, r.round_no, actor, 'timeout_bid', 1, 1);
  else
    -- 續喊逾時：自動質疑（走完整開盅與流轉）
    perform _open_pot(p_session_id, actor, 'timeout_challenge');
  end if;
end $$;

-- 私用函式不對外開放：一律由本檔 RPC 內部呼叫
revoke execute on function _roll_many(int) from public, anon, authenticated;
revoke execute on function _next_alive_seat(bigint, int) from public, anon, authenticated;
revoke execute on function _display_name(uuid) from public, anon, authenticated;
revoke execute on function _settle_statistics(bigint) from public, anon, authenticated;
revoke execute on function _start_next_round(bigint, int, int) from public, anon, authenticated;
revoke execute on function _open_pot(bigint, uuid, text) from public, anon, authenticated;
revoke execute on function _apply_timeout(bigint) from public, anon, authenticated;

-- ============ RPC：狀態機與守門（security definer） ============
-- 共同守門：先取 session（或 room）的 advisory xact lock 序列化並行操作；
-- deadline 已過時先代理逾時再驗證，任何錯誤皆為簡短繁中。

-- 開始遊戲（房主專屬）：建 session、玩家狀態快照、擲第一輪骰子。
-- 回傳新 session id（play 頁路由用）。
create or replace function start_game(p_room_id text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
  room game_rooms%rowtype;
  player_count int;
  new_session bigint;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  -- 房間層級的 advisory lock：避免重複點擊開局造成雙 session
  perform pg_advisory_xact_lock(hashtextextended('liars-room:' || target, 0));

  select * into room from game_rooms where room_id = target;
  if not found then
    raise exception '房間不存在';
  end if;
  if room.host_id <> uid then
    raise exception '只有房主可以開始遊戲';
  end if;
  if room.status <> 'waiting' then
    raise exception '遊戲已開始或結束，無法再開';
  end if;
  select count(*) into player_count from game_room_players where room_id = target;
  if player_count < 2 then
    raise exception '至少需要 2 名玩家才能開始';
  end if;

  insert into game_sessions (room_id, dice_count, turn_seconds)
    values (target, room.dice_count, room.turn_seconds)
    returning id into new_session;

  insert into game_player_state (session_id, user_id, seat, dice_left)
    select new_session, p.user_id, p.seat, room.dice_count
      from game_room_players p where p.room_id = target;

  -- 第一輪：每位玩家擲 dice_count 顆，回合 1 由 seat 1 開始喊牌
  insert into game_player_dice (session_id, round_no, user_id, dice)
    select new_session, 1, p.user_id, _roll_many(p.dice_left)
      from game_player_state p where p.session_id = new_session;
  insert into game_rounds (session_id, round_no, current_seat, status, deadline_at)
    values (new_session, 1, 1, 'bidding', now() + make_interval(secs => room.turn_seconds));

  update game_rooms set status = 'playing', last_activity_at = now()
    where room_id = target;
  return new_session;
end $$;

-- 喊牌：僅當當前玩家、bidding 中、deadline 未過。驗證面數與加碼規則後
-- 更新喊牌、推進到下一存活座位、重設 deadline。
create or replace function submit_bid(
  p_session_id bigint,
  p_count int,
  p_face int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s game_sessions%rowtype;
  r game_rounds%rowtype;
  total_dice int;
  first_time boolean;
  ok boolean;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  perform pg_advisory_xact_lock(p_session_id);

  select * into s from game_sessions where id = p_session_id;
  if not found then
    raise exception '遊戲局不存在';
  end if;

  select * into r from game_rounds
    where session_id = p_session_id
    order by round_no desc limit 1;
  if not found then
    raise exception '遊戲回合不存在';
  end if;
  if r.status = 'ended' then
    raise exception '遊戲已結束';
  end if;
  if r.status <> 'bidding' then
    raise exception '開盅進行中，請稍候';
  end if;

  -- 逾時先代理（改寫 deadline 或直接結束回合），再驗證當前狀態；
  -- 原本這手若因此不再是當前玩家，會以「還不是你的回合」回覆。
  perform _apply_timeout(p_session_id);
  select * into r from game_rounds
    where session_id = p_session_id
    order by round_no desc limit 1;
  if r.status <> 'bidding' then
    return;
  end if;

  if not exists (
    select 1 from game_player_state
    where session_id = p_session_id
      and seat = r.current_seat
      and user_id = uid
      and eliminated = false
  ) then
    raise exception '還不是你的回合';
  end if;
  if p_face is null or p_face not between 1 and 6 then
    raise exception '點數須介於 1 與 6 之間';
  end if;
  if p_count is null or p_count < 1 then
    raise exception '數量須為正整數';
  end if;
  select coalesce(sum(p.dice_left), 0) into total_dice
    from game_player_state p
    where p.session_id = p_session_id and p.eliminated = false;
  if p_count > total_dice then
    raise exception '數量超過場上骰子總數';
  end if;

  -- 加碼規則（與前端 bidRules.ts 同一條件；SQL 為裁判）
  first_time := r.bid_seq = 0;
  ok := case
    when first_time then true
    else p_count > coalesce(r.bid_count, 0)
         or (p_count = coalesce(r.bid_count, 0) and p_face > coalesce(r.bid_face, 0)) end;
  if not ok then
    raise exception '喊牌必須大於前一筆，請提高數量或點數';
  end if;

  update game_rounds set
    bid_seq = r.bid_seq + 1,
    bid_count = p_count,
    bid_face = p_face,
    bid_user = uid,
    current_seat = _next_alive_seat(p_session_id, r.current_seat),
    deadline_at = now() + make_interval(secs => s.turn_seconds)
    where session_id = p_session_id and round_no = r.round_no;
  insert into game_actions (session_id, round_no, user_id, action, count, face)
    values (p_session_id, r.round_no, uid, 'bid', p_count, p_face);
end $$;

-- 質疑：僅當當前玩家、bidding 中且本回合已有人喊牌。
-- 走完整開盅、勝負、淘汰與（生成下一回合或結案）流程。
create or replace function challenge_bid(p_session_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s_ref game_sessions%rowtype;
  r_ref game_rounds%rowtype;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  perform pg_advisory_xact_lock(p_session_id);

  select * into s_ref from game_sessions where id = p_session_id;
  if not found then
    raise exception '遊戲局不存在';
  end if;

  select * into r_ref from game_rounds
    where session_id = p_session_id
    order by round_no desc limit 1;
  if not found then
    raise exception '遊戲回合不存在';
  end if;
  if r_ref.status = 'ended' then
    raise exception '遊戲已結束';
  end if;
  if r_ref.status <> 'bidding' then
    raise exception '開盅進行中，請稍候';
  end if;
  if r_ref.bid_seq = 0 then
    raise exception '本回合尚未有人喊牌，無法質疑';
  end if;

  -- 逾時先代理：若逾時已代質疑，本回合狀態會變動，改以後續驗證回覆
  perform _apply_timeout(p_session_id);
  select * into r_ref from game_rounds
    where session_id = p_session_id
    order by round_no desc limit 1;
  if r_ref.status <> 'bidding' or r_ref.bid_seq = 0 then
    return;
  end if;

  if not exists (
    select 1 from game_player_state
    where session_id = p_session_id
      and seat = r_ref.current_seat
      and user_id = uid
      and eliminated = false
  ) then
    raise exception '還不是你的回合';
  end if;

  perform _open_pot(p_session_id, uid, 'challenge');
end $$;

-- 逾時同步：deadline 已過的回合由本局成員呼叫即可推進（冪等）。
-- 首喊逾時＝代喊 (1,1)；續喊逾時＝代質疑。未逾時或非喊牌階段時無操作。
create or replace function sync_timeout(p_session_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  perform pg_advisory_xact_lock(p_session_id);
  if not exists (select 1 from game_sessions where id = p_session_id) then
    raise exception '遊戲局不存在';
  end if;
  -- 成員檢查：非本局玩家不得觸發逾時代打（避免旁人干預對局）
  if not exists (
    select 1 from game_player_state p
    join game_sessions s on s.id = p.session_id
    where s.id = p_session_id and p.user_id = uid
  ) then
    raise exception '只有本局玩家可以同步逾時';
  end if;
  perform _apply_timeout(p_session_id);
end $$;

-- ============ Phase 4：房主重開（再玩一局） ============

-- 房主重開房間：遊戲結束（或對局仍在進行）後，由房主把該房清回「等待中」，
-- 成員保留（game_room_players 不動），再由一般的 start_game 重新開局。
--   冪等：已 waiting 時直接返回；closed 房間不得重開。
--   清局：刪除房內全部 game_sessions（其回合／骰子／操作紀錄隨 FK 串聯刪除）。
create or replace function replay_room(p_room_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target text := upper(trim(p_room_id));
  room game_rooms%rowtype;
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  -- 與 start_game 同一把房間層級鎖：與開局互斥，避免重開與開局並行
  perform pg_advisory_xact_lock(hashtextextended('liars-room:' || target, 0));

  select * into room from game_rooms where room_id = target;
  if not found then
    raise exception '房間不存在';
  end if;
  if room.host_id <> uid then
    raise exception '只有房主可以重開房間';
  end if;
  if room.status = 'waiting' then
    -- 冪等：已在等待中（可能重複點擊或他人已重開）則無操作
    return;
  end if;
  if room.status = 'closed' then
    raise exception '房間已關閉，無法重開';
  end if;
  if room.status = 'playing' then
    raise exception '遊戲進行中，無法重開';
  end if;

  delete from game_sessions where room_id = target;
  update game_rooms set status = 'waiting', last_activity_at = now()
    where room_id = target;
end $$;
