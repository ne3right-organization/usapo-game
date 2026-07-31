-- 市区町村図鑑クイズ: 難易度3段階(かんたん/ふつう/むずかしい)対応
--
-- 難易度は地図パズルと同じスラッグ(beginner/intermediate/advanced)を使う。
-- 難易度・出題時に見せたヒント項目は、クライアントの自己申告を信用せず
-- game_zukan_quiz_sessions にサーバー側(Route Handler)で保存し、
-- claim_zukan_quiz_answer がそこから読んで game_zukan_collections に反映する
-- (地図パズルと同じ「自己採点はDB側で完結させる」方針)。

alter table public.game_zukan_quiz_sessions
  add column difficulty text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  add column hint_fields text[] not null default '{}';

-- 図鑑カードは自治体1枚 + 最高難易度クリアのラベルとする(ユーザー確認済み)
alter table public.game_zukan_collections
  add column best_difficulty text not null default 'intermediate'
    check (best_difficulty in ('beginner', 'intermediate', 'advanced')),
  add column hint_fields text[] not null default '{}';

-- 難易度の大小比較用(むずかしい > ふつう > かんたん)
create function public.zukan_quiz_difficulty_rank(p_difficulty text)
returns smallint
language sql
immutable
as $$
  select case p_difficulty
    when 'advanced' then 3
    when 'intermediate' then 2
    when 'beginner' then 1
    else 0
  end;
$$;

-- 他プレイヤーのカード(コメント含む)も見られるようにする(ソーシャル機能のため)。
-- game_profiles/game_map_puzzle_best と同じ「nickname設定済みなら公開」ルールに揃える
drop policy if exists "game_zukan_collections_select" on public.game_zukan_collections;
create policy "game_zukan_collections_select" on public.game_zukan_collections
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.game_profiles p
      where p.user_id = game_zukan_collections.user_id and p.nickname is not null
    )
  );

-- claim_zukan_quiz_answer: 戻り値にdifficultyを追加するため、create or replaceでは
-- 型変更エラーになる(20260726000000と同じ制約)。先にdropしてから作り直す
drop function if exists public.claim_zukan_quiz_answer(uuid, text, text);

create function public.claim_zukan_quiz_answer(
  p_session_id uuid,
  p_answer_pref_code text,
  p_answer_city_code text
)
returns table (
  is_correct boolean,
  pref_code text,
  pref_name text,
  city_code text,
  city_name text,
  population integer,
  households integer,
  attempt_count integer,
  correct_count integer,
  difficulty text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_session public.game_zukan_quiz_sessions;
begin
  select * into v_session
  from public.game_zukan_quiz_sessions s
  where s.id = p_session_id
    and s.consumed_at is null
    and s.created_at > now() - interval '30 minutes'
  for update;

  if not found then
    raise exception 'このクイズは期限切れか、すでに回答済みです';
  end if;

  update public.game_zukan_quiz_sessions
  set consumed_at = now()
  where id = p_session_id;

  is_correct := (p_answer_pref_code = v_session.pref_code and p_answer_city_code = v_session.city_code);
  pref_code := v_session.pref_code;
  pref_name := v_session.pref_name;
  city_code := v_session.city_code;
  city_name := v_session.city_name;
  population := v_session.population;
  households := v_session.households;
  difficulty := v_session.difficulty;

  insert into public.game_zukan_municipality_stats (pref_code, city_code, attempt_count, correct_count)
  values (v_session.pref_code, v_session.city_code, 1, case when is_correct then 1 else 0 end)
  on conflict (pref_code, city_code) do update set
    attempt_count = public.game_zukan_municipality_stats.attempt_count + 1,
    correct_count = public.game_zukan_municipality_stats.correct_count
      + (case when is_correct then 1 else 0 end)
  returning public.game_zukan_municipality_stats.attempt_count, public.game_zukan_municipality_stats.correct_count
  into attempt_count, correct_count;

  if is_correct and auth.uid() is not null then
    insert into public.game_zukan_collections (
      user_id, pref_code, city_code, pref_name, city_name, population, households,
      correct_count, first_acquired_at, last_acquired_at, best_difficulty, hint_fields
    )
    values (
      auth.uid(), v_session.pref_code, v_session.city_code, v_session.pref_name, v_session.city_name,
      v_session.population, v_session.households, 1, now(), now(), v_session.difficulty, v_session.hint_fields
    )
    on conflict (user_id, pref_code, city_code) do update set
      correct_count = public.game_zukan_collections.correct_count + 1,
      last_acquired_at = now(),
      hint_fields = excluded.hint_fields,
      best_difficulty = case
        when public.zukan_quiz_difficulty_rank(excluded.best_difficulty)
          > public.zukan_quiz_difficulty_rank(public.game_zukan_collections.best_difficulty)
        then excluded.best_difficulty
        else public.game_zukan_collections.best_difficulty
      end;
  end if;

  return next;
end;
$$;

-- drop functionで既存のexecute権限も失われるため再付与する
grant execute on function public.claim_zukan_quiz_answer(uuid, text, text) to authenticated, anon;
