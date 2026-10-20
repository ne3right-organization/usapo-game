-- 地図ポットン(旧称: 地図パック): 途中保存(「中断」ボタン)用テーブル
--
-- 地図パズルの game_map_puzzle_progress と同じく、難易度×エリアごとに最大1件。
-- 地図パズルは配置済みピースのidだけで復元できるが、地図ポットンは物理演算で積んだ状態
-- (どの地域が合体してかたまりになっているか・位置・向き・残りの出題順など)を戻す必要があるため、
-- 状態はクライアントが作るJSONをそのまま state に入れる(サーバー側で中身を解釈することはない)。
-- 得点は完成・あきらめた時の記録(game_map_pack_challenges)でDB側が計算し直すので、
-- ここに入る値を信用しても得点の偽装にはつながらない(合体の点の上限はそちらのCHECK制約で弾く)

create table public.game_map_pack_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  difficulty game_difficulty not null,
  pref_code text not null,
  pref_name text not null,
  city_code text,
  city_name text,
  -- Supabaseクライアントの upsert(onConflict) は式インデックスを指定できないため、生成列への通常のUNIQUE制約にする
  -- (地図パズルの game_map_puzzle_progress と同じ理由)
  city_code_key text generated always as (coalesce(city_code, '')) stored,
  state jsonb not null check (pg_column_size(state) < 500000),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  saved_at timestamptz not null default now()
);

create unique index game_map_pack_progress_area_unique
  on public.game_map_pack_progress (user_id, difficulty, pref_code, city_code_key);

alter table public.game_map_pack_progress enable row level security;

create policy "game_map_pack_progress_all" on public.game_map_pack_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- anon・authenticated とも自動で全権限が付くことが分かっているため(CLAUDE.md 参照)、
-- いったん全部剥がしてから必要な分だけ付け直す
revoke all on public.game_map_pack_progress from anon, authenticated;
grant select, insert, update, delete on public.game_map_pack_progress to authenticated;

-- 完成・あきらめて記録したら、そのエリアの途中保存は消す(地図パズルと同じ)。
-- 戻り値の型は変えないので create or replace でよい
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

  delete from public.game_map_pack_progress
  where user_id = new.user_id
    and difficulty = new.difficulty
    and pref_code = new.pref_code
    and city_code_key = coalesce(new.city_code, '');

  return new;
end;
$$;

-- create or replace で関数を作り直すと権限が付け直されることがあるため、念のため再度剥がす
revoke all on function public.game_map_pack_challenges_after_insert() from public, anon;
