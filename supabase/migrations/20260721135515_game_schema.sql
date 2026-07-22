-- 地図パズル: プレイ履歴・プロフィール・ランキング用スキーマ
--
-- 移植元(team-kokuusa-platform-frontend, AWS Amplify Gen2: Cognito + AppSync + DynamoDB)の
-- GameProfile / GameMapPuzzleChallenge / GameMapPuzzleProgress / GameMapPuzzleBest を
-- Supabase(Postgres + Supabase Auth)向けに再設計したもの。
--
-- 元実装との主な違い:
-- - GameMapPuzzleBest の集計は元実装では1時間おきのバッチLambdaだったが、
--   ここでは挑戦(INSERT)のたびにトリガーで即座に再計算する(全件スキャン不要な規模のため)
-- - ニックネームの伝播も元実装は集計Lambda任せで最大1時間ずれたが、ここではUPDATE時に即時反映する
-- - プロフィール非公開の判定(nicknameが未設定なら他人からは見えない)は元実装ではAPI層でのみ
--   クライアント側が判断していたが、ここではRLSポリシーとしてDB層で強制する

create type game_difficulty as enum ('beginner', 'intermediate', 'advanced');

-- ─── game_profiles ──────────────────────────────────────────────────────────
-- ゲーム専用プロフィール。auth.users と1:1。nickname を設定すると他ユーザーに
-- プロフィール(合計スコア・ベストスコア一覧)が公開される

create table public.game_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nickname text check (char_length(nickname) between 1 and 12),
  total_score integer not null default 0,
  areas_played_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger game_profiles_set_updated_at
  before update on public.game_profiles
  for each row execute function public.set_updated_at();

-- ─── game_map_puzzle_challenges ─────────────────────────────────────────────
-- チャレンジ履歴。プレイのたびに1件作成される不変の生ログ(更新・削除はしない)

create table public.game_map_puzzle_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nickname text, -- 記録時点の game_profiles.nickname のスナップショット
  difficulty game_difficulty not null,
  pref_code text not null,
  pref_name text not null,
  city_code text, -- 上級のみ
  city_name text, -- 上級のみ
  total_pieces integer not null check (total_pieces > 0),
  miss_count integer not null check (miss_count >= 0),
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  base_score integer not null,
  time_bonus integer not null,
  miss_penalty integer not null,
  score integer not null,
  is_new_best boolean not null default false,
  comment text check (char_length(comment) <= 200),
  played_at timestamptz not null default now(),
  constraint advanced_requires_city check (
    difficulty <> 'advanced' or (city_code is not null and city_name is not null)
  )
);

create index game_map_puzzle_challenges_user_played_idx
  on public.game_map_puzzle_challenges (user_id, played_at desc);

-- ─── game_map_puzzle_progress ───────────────────────────────────────────────
-- 途中保存。難易度×エリアごとに最大1件(「保存して中断」用)

create table public.game_map_puzzle_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  difficulty game_difficulty not null,
  pref_code text not null,
  pref_name text not null,
  city_code text,
  city_name text,
  -- coalesce(city_code, '') を生成列にしたもの。理由は下のコメント参照
  city_code_key text generated always as (coalesce(city_code, '')) stored,
  placed_ids integer[] not null default '{}',
  miss_count integer not null default 0 check (miss_count >= 0),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  saved_at timestamptz not null default now()
);

-- 元実装の areaKey (`${difficulty}#${prefCode}#${cityCode ?? ''}`) と同じ役割。
-- Supabaseクライアントの upsert(onConflict) は式インデックスを指定できず実カラム名しか
-- 渡せないため、式インデックスではなく生成列 city_code_key への通常のUNIQUE制約にしている
create unique index game_map_puzzle_progress_area_unique
  on public.game_map_puzzle_progress (user_id, difficulty, pref_code, city_code_key);

-- ─── game_map_puzzle_best ───────────────────────────────────────────────────
-- ユーザー×エリアの自己ベスト。ランキング・合計スコア・プレイ済みエリア判定の参照元。
-- 書き込みはトリガー(SECURITY DEFINER)経由のみ。クライアントからは読み取り専用

create table public.game_map_puzzle_best (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  difficulty game_difficulty not null,
  pref_code text not null,
  pref_name text not null,
  city_code text,
  city_name text,
  best_score integer not null,
  best_challenge_id uuid references public.game_map_puzzle_challenges(id) on delete set null,
  play_count integer not null default 1,
  first_played_at timestamptz not null,
  last_played_at timestamptz not null
);

create unique index game_map_puzzle_best_area_unique
  on public.game_map_puzzle_best (user_id, difficulty, pref_code, coalesce(city_code, ''));

-- 都道府県別ランキング(中級)
create index game_map_puzzle_best_pref_score_idx
  on public.game_map_puzzle_best (pref_code, best_score desc);

-- 市区町村別ランキング(上級)
create index game_map_puzzle_best_city_score_idx
  on public.game_map_puzzle_best (city_code, best_score desc) where city_code is not null;

-- モード内グローバルランキング
create index game_map_puzzle_best_difficulty_score_idx
  on public.game_map_puzzle_best (difficulty, best_score desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.game_profiles enable row level security;
alter table public.game_map_puzzle_challenges enable row level security;
alter table public.game_map_puzzle_progress enable row level security;
alter table public.game_map_puzzle_best enable row level security;

-- game_profiles: nickname設定済みなら誰でも閲覧可。書き込みは本人のみ
create policy "game_profiles_select" on public.game_profiles
  for select using (user_id = auth.uid() or nickname is not null);
create policy "game_profiles_insert" on public.game_profiles
  for insert with check (user_id = auth.uid());
create policy "game_profiles_update" on public.game_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- game_map_puzzle_challenges: 履歴は本人のみ閲覧・作成可。更新・削除は無し(不変ログ)
create policy "game_map_puzzle_challenges_select" on public.game_map_puzzle_challenges
  for select using (user_id = auth.uid());
create policy "game_map_puzzle_challenges_insert" on public.game_map_puzzle_challenges
  for insert with check (user_id = auth.uid());

-- game_map_puzzle_progress: 本人のみ全操作可
create policy "game_map_puzzle_progress_all" on public.game_map_puzzle_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- game_map_puzzle_best: nickname設定済みなら誰でも閲覧可。書き込みはトリガー経由のみ
create policy "game_map_puzzle_best_select" on public.game_map_puzzle_best
  for select using (user_id = auth.uid() or nickname is not null);

-- ─── GRANT ───────────────────────────────────────────────────────────────────
-- Supabaseダッシュボードの「Automatically expose new tables」を無効(推奨設定)にしている場合、
-- テーブル作成時に authenticated/anon ロールへ自動で権限が付与されないため、ここで明示的に
-- 付与する。実際の行単位のアクセス制御は上記RLSポリシーが担う(GRANTはその手前のゲート)。
-- 未ログインでも遊べる仕様(ゲストプレイ)だが、履歴・ランキング等の閲覧は要ログインとし、
-- 元実装(Cognito版、全ルートで認証必須)にならって anon には一切付与しない

grant usage on schema public to authenticated;

grant select, insert, update on public.game_profiles to authenticated;
grant select, insert on public.game_map_puzzle_challenges to authenticated;
grant select, insert, update, delete on public.game_map_puzzle_progress to authenticated;
grant select on public.game_map_puzzle_best to authenticated;

-- ─── 集計トリガー ──────────────────────────────────────────────────────────
-- 挑戦(INSERT)のたびに:
--   (1) スコアをサーバー側(DB側)で再計算し、クライアントが送ってきた値は信用しない
--       (元実装がAPI Route層でやっていたことと同じ。RLSでINSERT自体は許可しているため、
--       スコア偽装を防ぐにはここで上書きするしかない)
--   (2) is_new_best を判定
--   → (3) ベスト記録・途中保存・プロフィール集計を更新(after insertトリガー側)

create or replace function public.game_challenges_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_best integer;
begin
  new.base_score := new.total_pieces * 10;
  new.time_bonus := greatest(0, new.total_pieces * 5 - floor(new.elapsed_seconds / 10));
  new.miss_penalty := new.miss_count * 5;
  new.score := greatest(0, new.base_score + new.time_bonus - new.miss_penalty);

  select best_score into current_best
  from public.game_map_puzzle_best
  where user_id = new.user_id
    and difficulty = new.difficulty
    and pref_code = new.pref_code
    and coalesce(city_code, '') = coalesce(new.city_code, '');

  new.is_new_best := current_best is null or new.score > current_best;
  return new;
end;
$$;

create trigger game_challenges_before_insert
  before insert on public.game_map_puzzle_challenges
  for each row execute function public.game_challenges_before_insert();

create or replace function public.game_challenges_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_new_best then
    insert into public.game_map_puzzle_best (
      user_id, nickname, difficulty, pref_code, pref_name, city_code, city_name,
      best_score, best_challenge_id, play_count, first_played_at, last_played_at
    )
    values (
      new.user_id,
      (select nickname from public.game_profiles where user_id = new.user_id),
      new.difficulty, new.pref_code, new.pref_name, new.city_code, new.city_name,
      new.score, new.id, 1, new.played_at, new.played_at
    )
    on conflict (user_id, difficulty, pref_code, coalesce(city_code, ''))
    do update set
      nickname = excluded.nickname,
      best_score = excluded.best_score,
      best_challenge_id = excluded.best_challenge_id,
      pref_name = excluded.pref_name,
      city_name = excluded.city_name,
      play_count = public.game_map_puzzle_best.play_count + 1,
      last_played_at = excluded.last_played_at;
  else
    update public.game_map_puzzle_best
    set play_count = play_count + 1,
        last_played_at = new.played_at
    where user_id = new.user_id
      and difficulty = new.difficulty
      and pref_code = new.pref_code
      and coalesce(city_code, '') = coalesce(new.city_code, '');
  end if;

  -- 該当エリアの途中保存があればクリア済みなので削除する
  delete from public.game_map_puzzle_progress
  where user_id = new.user_id
    and difficulty = new.difficulty
    and pref_code = new.pref_code
    and coalesce(city_code, '') = coalesce(new.city_code, '');

  -- プロフィール集計を再計算(規模が小さいので毎回SUM/COUNTし直して正確性を優先する)
  insert into public.game_profiles (user_id, total_score, areas_played_count)
  select new.user_id, coalesce(sum(best_score), 0), count(*)
  from public.game_map_puzzle_best
  where user_id = new.user_id
  on conflict (user_id) do update set
    total_score = excluded.total_score,
    areas_played_count = excluded.areas_played_count;

  return new;
end;
$$;

create trigger game_challenges_after_insert
  after insert on public.game_map_puzzle_challenges
  for each row execute function public.game_challenges_after_insert();

-- ニックネーム変更を、その場でベスト記録側にも伝播する
-- (元実装は集計Lambdaが1時間おきに上書きするため最大1時間ずれていたが、ここでは即時反映する)
create or replace function public.game_profiles_propagate_nickname()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nickname is distinct from old.nickname then
    update public.game_map_puzzle_best
    set nickname = new.nickname
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger game_profiles_after_update
  after update on public.game_profiles
  for each row execute function public.game_profiles_propagate_nickname();
