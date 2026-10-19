-- 地図制覇ゲーム(プロトタイプ Phase 1): 町丁目(ミクロ)層の恒久占領・戦闘・資金用スキーマ
--
-- 設計の要点(docs/map_conquest_game_design.md 参照):
-- - 占領は恒久的(シーズンリセットなし)。守備力・攻撃力・勝敗は docs/map_conquest_game/battle-phase-mock.html
--   の暫定式をそのまま踏襲する(詳細は src/lib/game/mapConquestData.ts のコメント参照)
-- - 地図パズル・図鑑クイズと同様、クライアントの「勝ちました」という自己申告は信用しない。
--   守備力・攻撃力は事前にRoute Handler(サーバー側、外部データ取得が必要なためDB関数では計算不可)が
--   算出して game_map_conquest_battle_sessions に保存し、実際のダイス・勝敗判定・占領・資金増減は
--   resolve_map_conquest_battle 関数(security definer)がDB側で行う(claim_zukan_quiz_answerと同じ型)
-- - 占領は恒久的なアカウント資産のため、地図パズル・図鑑クイズと異なりこのゲームはログイン必須とする
--   (ゲストプレイ不可)
--
-- 今回はミクロ層(町丁目レベル、大田区固定)のみ実装する。マクロ層(市区町村をまたぐ隣接ロック・
-- 侵入口の動的決定・都道府県クリア判定)はテーブルのみ用意し、UI/APIの実装は次イテレーション以降に回す
-- (game_map_conquest_prefecture_progress / game_map_conquest_municipalities)。

-- ─── game_map_conquest_players ──────────────────────────────────────────────
-- 資金(インフラ維持予算)。戦闘の勝敗に応じて増減する。行は resolve_map_conquest_battle が
-- 初回のみ遅延作成する(クライアントからのINSERTは許可しない)

create table public.game_map_conquest_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  budget integer not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- public.set_updated_at() は 20260721135515_game_schema.sql で定義済みのものを再利用する
create trigger game_map_conquest_players_set_updated_at
  before update on public.game_map_conquest_players
  for each row execute function public.set_updated_at();

-- ─── game_map_conquest_tiles ────────────────────────────────────────────────
-- 町丁目単位の恒久占領記録(ミクロ層)。書き込みは resolve_map_conquest_battle 経由のみ

create table public.game_map_conquest_tiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_code text not null,
  city_code text not null,
  town_code text not null, -- geojsonのKEY_CODE
  town_name text not null, -- 捕獲時点の S_NAME スナップショット
  attribute text not null check (attribute in ('land', 'fire', 'wind', 'water')),
  captured_at timestamptz not null default now(),
  primary key (user_id, pref_code, city_code, town_code)
);

create index game_map_conquest_tiles_user_city_idx
  on public.game_map_conquest_tiles (user_id, pref_code, city_code);

-- ─── game_map_conquest_battle_sessions ──────────────────────────────────────
-- 戦闘1回ごとの守備力・攻撃力を保持する一時セッション。resolve_map_conquest_battle 消費後は
-- consumed_at を立てて使い捨てにする(game_zukan_quiz_sessions と同じ考え方)。
-- 守備力・攻撃力は外部データ(CloudFrontのgeojson・stat.usapo.net)に依存するためDB関数では
-- 算出できず、Route Handler(信頼できるサーバー側コード)がここに書き込む値を信頼する設計

create table public.game_map_conquest_battle_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pref_code text not null,
  city_code text not null,
  town_code text not null,
  town_name text not null,
  attribute text not null check (attribute in ('land', 'fire', 'wind', 'water')),
  defense_value integer not null,
  attack_value integer not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

-- ─── game_map_conquest_prefecture_progress (マクロ層、スキーマのみ・今回は未使用) ──────
-- 都道府県キャンペーンの開始・クリア状況。書き込みはマクロ層実装時に追加する

create table public.game_map_conquest_prefecture_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_code text not null,
  started_at timestamptz not null default now(),
  cleared_at timestamptz,
  primary key (user_id, pref_code)
);

-- ─── game_map_conquest_municipalities (マクロ層、スキーマのみ・今回は未使用) ────────────
-- 市区町村単位の恒久占領記録(マクロ層)。書き込みはマクロ層実装時に追加する

create table public.game_map_conquest_municipalities (
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_code text not null,
  city_code text not null,
  city_name text not null,
  entry_town_code text, -- 動的に決定される侵入口。都道府県内で最初に確保した市区町村はNULL
  captured_at timestamptz not null default now(),
  primary key (user_id, pref_code, city_code)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.game_map_conquest_players enable row level security;
alter table public.game_map_conquest_tiles enable row level security;
alter table public.game_map_conquest_battle_sessions enable row level security;
alter table public.game_map_conquest_prefecture_progress enable row level security;
alter table public.game_map_conquest_municipalities enable row level security;

create policy "game_map_conquest_players_select" on public.game_map_conquest_players
  for select using (user_id = auth.uid());

create policy "game_map_conquest_tiles_select" on public.game_map_conquest_tiles
  for select using (user_id = auth.uid());

create policy "game_map_conquest_battle_sessions_insert" on public.game_map_conquest_battle_sessions
  for insert with check (user_id = auth.uid());

create policy "game_map_conquest_prefecture_progress_select" on public.game_map_conquest_prefecture_progress
  for select using (user_id = auth.uid());

create policy "game_map_conquest_municipalities_select" on public.game_map_conquest_municipalities
  for select using (user_id = auth.uid());

-- ─── GRANT ───────────────────────────────────────────────────────────────────
-- SQLマイグレーション経由のテーブルは「Automatically expose new tables」設定に関わらず
-- anon/authenticatedへ暗黙のデフォルト権限が付くことが判明済みのため、意図した権限だけを
-- 明示的に付与する(20260722000000_revoke_anon_grants.sql の教訓。以後の新規テーブルでも必ず書く)。
--
-- このゲームはログイン必須(ゲストプレイ不可)のため、anonへは一切付与しない。
-- players/tiles/prefecture_progress/municipalities はSELECTのみ(書き込みはRPC経由)。
-- battle_sessions はINSERTのみ(SELECTを許可すると意味は薄いが、結果はRPCの戻り値で
-- 返すため不要。zukan_quiz_sessionsと同じ考え方)

grant usage on schema public to authenticated;

grant select on public.game_map_conquest_players to authenticated;
grant select on public.game_map_conquest_tiles to authenticated;
grant insert on public.game_map_conquest_battle_sessions to authenticated;
grant select on public.game_map_conquest_prefecture_progress to authenticated;
grant select on public.game_map_conquest_municipalities to authenticated;

-- anon には明示的に何も付与しない(GRANTを書かないことがREVOKEの代わりにはならないため、
-- 念のため明示的にREVOKEしておく。上記の暗黙GRANTの挙動が今後変わった場合の保険)

revoke all on public.game_map_conquest_players from anon;
revoke all on public.game_map_conquest_tiles from anon;
revoke all on public.game_map_conquest_battle_sessions from anon;
revoke all on public.game_map_conquest_prefecture_progress from anon;
revoke all on public.game_map_conquest_municipalities from anon;

-- ─── resolve_map_conquest_battle ────────────────────────────────────────────
-- 戦闘セッションを消費し、ダイスを振って勝敗を判定し、勝てば恒久占領・資金増加、
-- 負ければ資金減少までをサーバー側(DB側)で完結させる。
-- 勝率式は docs/map_conquest_game/battle-phase-mock.html の暫定式をそのまま移植したもの:
--   事前勝率 = clamp(攻撃力 / (攻撃力 + 守備力), 5%, 95%)
--   最終勝率 = clamp(事前勝率 + (出目1〜6 - 3.5) * 6%, 5%, 95%)
--   勝ち: 資金 += round(守備力 * 15%) / 負け: 資金 -= round(守備力 * 12%) (下限0)

create or replace function public.resolve_map_conquest_battle(p_session_id uuid)
returns table (
  is_win boolean,
  dice integer,
  final_probability numeric,
  budget_delta integer,
  new_budget integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_map_conquest_battle_sessions;
  v_dice integer;
  v_base_prob numeric;
  v_final_prob numeric;
  v_win boolean;
  v_delta integer;
  v_budget integer;
begin
  select * into v_session
  from public.game_map_conquest_battle_sessions s
  where s.id = p_session_id
    and s.user_id = auth.uid()
    and s.consumed_at is null
    and s.created_at > now() - interval '30 minutes'
  for update;

  if not found then
    raise exception 'この戦闘は期限切れか、すでに決着しています';
  end if;

  update public.game_map_conquest_battle_sessions
  set consumed_at = now()
  where id = p_session_id;

  v_dice := 1 + floor(random() * 6)::integer;
  v_base_prob := least(0.95, greatest(0.05, v_session.attack_value::numeric / (v_session.attack_value + v_session.defense_value)));
  v_final_prob := least(0.95, greatest(0.05, v_base_prob + (v_dice - 3.5) * 0.06));
  v_win := random() < v_final_prob;

  insert into public.game_map_conquest_players (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  if v_win then
    v_delta := round(v_session.defense_value * 0.15);

    insert into public.game_map_conquest_tiles (
      user_id, pref_code, city_code, town_code, town_name, attribute, captured_at
    )
    values (
      auth.uid(), v_session.pref_code, v_session.city_code, v_session.town_code,
      v_session.town_name, v_session.attribute, now()
    )
    on conflict (user_id, pref_code, city_code, town_code) do nothing;

    update public.game_map_conquest_players
    set budget = budget + v_delta
    where user_id = auth.uid()
    returning budget into v_budget;
  else
    v_delta := -round(v_session.defense_value * 0.12);

    update public.game_map_conquest_players
    set budget = greatest(0, budget + v_delta)
    where user_id = auth.uid()
    returning budget into v_budget;
  end if;

  is_win := v_win;
  dice := v_dice;
  final_probability := v_final_prob;
  budget_delta := v_delta;
  new_budget := v_budget;

  return next;
end;
$$;

grant execute on function public.resolve_map_conquest_battle(uuid) to authenticated;

-- ─── 期限切れセッションの掃除 ─────────────────────────────────────────────────
-- game_map_conquest_battle_sessions はINSERTのみのテーブルなので、放置すると増え続ける。
-- zukan_quiz_sessions と同じく pg_cron で日次で古い行を削除する

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    if exists (select 1 from cron.job where jobname = 'map_conquest_battle_sessions_cleanup') then
      perform cron.unschedule('map_conquest_battle_sessions_cleanup');
    end if;

    perform cron.schedule(
      'map_conquest_battle_sessions_cleanup',
      '10 18 * * *', -- 毎日18:10 UTC(日本時間 03:10。zukan_quiz_sessionsの掃除と時間をずらす)
      $cron$delete from public.game_map_conquest_battle_sessions where created_at < now() - interval '1 day'$cron$
    );
  end if;
end;
$$;
