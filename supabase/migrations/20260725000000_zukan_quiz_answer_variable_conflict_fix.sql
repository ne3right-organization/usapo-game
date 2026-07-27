-- claim_zukan_quiz_answer関数の "column reference "pref_code" is ambiguous" エラーを修正。
--
-- 原因: RETURNS TABLE(pref_code text, city_code text, ...) で宣言した戻り値の列名が、
-- 関数内部ではPL/pgSQLの変数としても存在する。INSERT ... ON CONFLICT (user_id, pref_code, city_code)
-- の対象列リストは(他のSQLの式と同様に)一般の式として解釈されるため、
-- 「game_zukan_collectionsテーブルのpref_code列」なのか「同名の変数」なのかが曖昧になっていた。
--
-- #variable_conflict use_column を指定し、この関数内で名前が衝突した場合は
-- テーブルの列を優先する(= ON CONFLICTの列リストは意図通りテーブルの列として解決される)。
-- 変数への代入文(pref_code := v_session.pref_code など)の左辺は元々このプラグマの影響を受けず、
-- 常に変数として扱われるため、既存の代入ロジックへの影響はない。

create or replace function public.claim_zukan_quiz_answer(
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
  households integer
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

  if is_correct and auth.uid() is not null then
    insert into public.game_zukan_collections (
      user_id, pref_code, city_code, pref_name, city_name, population, households,
      correct_count, first_acquired_at, last_acquired_at
    )
    values (
      auth.uid(), v_session.pref_code, v_session.city_code, v_session.pref_name, v_session.city_name,
      v_session.population, v_session.households, 1, now(), now()
    )
    on conflict (user_id, pref_code, city_code) do update set
      correct_count = public.game_zukan_collections.correct_count + 1,
      last_acquired_at = now();
  end if;

  return next;
end;
$$;
