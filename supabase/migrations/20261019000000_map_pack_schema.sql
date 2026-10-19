-- 地図パック: 挑戦結果とランキング用スキーマ
--
-- 地図パズル(20260721135515_game_schema.sql)と同じ構成にしている:
--   挑戦履歴(不変ログ) → INSERTトリガーで得点をDB側で計算し直す → エリア別ベストを更新
-- 地図パズルとはゲームも得点の尺度も違うため別テーブルで集計し、game_profiles.total_score
-- (地図パズルのエリア別ベストの合計)には含めない。ニックネーム・公開範囲は game_profiles を共用する。
--
-- 物理演算はクライアント側で動くため、得点の元になる値(合体の点・積み直し回数・完成したか・タイム)は
-- 自己申告になる。地図パズルと同じく、得点そのものはクライアントから受け取らずDB側で計算し、
-- 明らかにありえない値はCHECK制約で弾く。

-- ─── game_map_pack_challenges ───────────────────────────────────────────────

create table public.game_map_pack_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nickname text, -- 記録時点の game_profiles.nickname のスナップショット
  difficulty game_difficulty not null,
  pref_code text not null,
  pref_name text not null,
  city_code text, -- 上級のみ(都道府県内の3桁コード)
  city_name text,
  total_pieces integer not null check (total_pieces > 1),
  -- 合体1回ごとに「合体後のピース数×10点」。全ピースを1つのかたまりに足し続けた場合が上限
  merge_points integer not null check (
    merge_points >= 0 and merge_points % 10 = 0
    and merge_points <= 10 * (total_pieces * (total_pieces + 1) / 2 - 1)
  ),
  restack_count integer not null check (restack_count >= 0),
  cleared boolean not null,
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  clear_bonus integer not null default 0,
  score integer not null default 0,
  is_new_best boolean not null default false,
  played_at timestamptz not null default now(),
  constraint map_pack_advanced_requires_city check (
    difficulty <> 'advanced' or (city_code is not null and city_name is not null)
  )
);

create index game_map_pack_challenges_user_played_idx
  on public.game_map_pack_challenges (user_id, played_at desc);

-- ─── game_map_pack_best ─────────────────────────────────────────────────────
-- ユーザー×エリアの自己ベスト。ランキングの参照元。書き込みはトリガー(SECURITY DEFINER)経由のみ

create table public.game_map_pack_best (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  difficulty game_difficulty not null,
  pref_code text not null,
  pref_name text not null,
  city_code text,
  city_name text,
  best_score integer not null,
  best_challenge_id uuid references public.game_map_pack_challenges(id) on delete set null,
  play_count integer not null default 1,
  first_played_at timestamptz not null,
  last_played_at timestamptz not null
);

create unique index game_map_pack_best_area_unique
  on public.game_map_pack_best (user_id, difficulty, pref_code, coalesce(city_code, ''));

create index game_map_pack_best_difficulty_score_idx
  on public.game_map_pack_best (difficulty, best_score desc);

create index game_map_pack_best_area_score_idx
  on public.game_map_pack_best (difficulty, pref_code, city_code, best_score desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.game_map_pack_challenges enable row level security;
alter table public.game_map_pack_best enable row level security;

-- 挑戦履歴は本人のみ閲覧・作成可。更新・削除は無し(不変ログ)
create policy "game_map_pack_challenges_select" on public.game_map_pack_challenges
  for select using (user_id = auth.uid());
create policy "game_map_pack_challenges_insert" on public.game_map_pack_challenges
  for insert with check (user_id = auth.uid());

-- ベストは nickname 設定済みなら誰でも閲覧可(地図パズルと同じ公開ルール)。書き込みはトリガー経由のみ
create policy "game_map_pack_best_select" on public.game_map_pack_best
  for select using (user_id = auth.uid() or nickname is not null);

-- ─── GRANT / REVOKE ──────────────────────────────────────────────────────────
-- SQLマイグレーションで作ったテーブル・関数には anon への権限が自動で付くことが分かっているため
-- (CLAUDE.md 参照)、明示的に剥がす。閲覧も要ログイン(地図パズルと同じ)

revoke all on public.game_map_pack_challenges from anon;
revoke all on public.game_map_pack_best from anon;
grant select, insert on public.game_map_pack_challenges to authenticated;
grant select on public.game_map_pack_best to authenticated;

-- ─── 集計トリガー ──────────────────────────────────────────────────────────

create or replace function public.game_map_pack_challenges_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_best integer;
begin
  -- クライアントの得点計算(MapPackGame.tsx)と同じ式:
  --   max(0, 合体の点 - 積み直し回数×50) + 完成ボーナス(1000 + 300秒を切った分×5)
  new.clear_bonus := case when new.cleared then 1000 + greatest(0, 300 - new.elapsed_seconds) * 5 else 0 end;
  new.score := greatest(0, new.merge_points - new.restack_count * 50) + new.clear_bonus;

  select best_score into current_best
  from public.game_map_pack_best
  where user_id = new.user_id
    and difficulty = new.difficulty
    and pref_code = new.pref_code
    and coalesce(city_code, '') = coalesce(new.city_code, '');

  new.is_new_best := current_best is null or new.score > current_best;
  return new;
end;
$$;

create trigger game_map_pack_challenges_before_insert
  before insert on public.game_map_pack_challenges
  for each row execute function public.game_map_pack_challenges_before_insert();

create or replace function public.game_map_pack_challenges_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_new_best then
    insert into public.game_map_pack_best (
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
      play_count = public.game_map_pack_best.play_count + 1,
      last_played_at = excluded.last_played_at;
  else
    update public.game_map_pack_best
    set play_count = play_count + 1,
        last_played_at = new.played_at
    where user_id = new.user_id
      and difficulty = new.difficulty
      and pref_code = new.pref_code
      and coalesce(city_code, '') = coalesce(new.city_code, '');
  end if;
  return new;
end;
$$;

create trigger game_map_pack_challenges_after_insert
  after insert on public.game_map_pack_challenges
  for each row execute function public.game_map_pack_challenges_after_insert();

-- ニックネーム変更を地図パックのベスト記録にも伝播する
-- (既存の game_profiles_propagate_nickname は地図パズルの game_map_puzzle_best のみが対象)
create or replace function public.game_profiles_propagate_nickname_map_pack()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nickname is distinct from old.nickname then
    update public.game_map_pack_best
    set nickname = new.nickname
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger game_profiles_after_update_map_pack
  after update on public.game_profiles
  for each row execute function public.game_profiles_propagate_nickname_map_pack();

-- 関数のEXECUTE権限も anon へ自動で付くことが分かっているため(CLAUDE.md 参照)、publicとanonの両方から明示的に剥がす。
-- (トリガー関数はRPCとして直接呼べないが、教訓どおり権限は残さない。authenticated は INSERT 時に
-- トリガーが動く経路なので触らない)
revoke all on function public.game_map_pack_challenges_before_insert() from public, anon;
revoke all on function public.game_map_pack_challenges_after_insert() from public, anon;
revoke all on function public.game_profiles_propagate_nickname_map_pack() from public, anon;
