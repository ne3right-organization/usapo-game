-- 地図ポットン: 挑戦を記録したら、そのエリアの中断データ(game_map_pack_progress)を消す処理を戻す。
--
-- 20261020000000_map_pack_progress.sql で after insert トリガーに入れた delete が、
-- 20261023000000_map_pack_best_first_cleared.sql で関数を create or replace し直したときに抜け落ちていた。
-- そのため完成させても中断データが残り、トップの「中断中のゲーム」やプレイ画面の再開確認に
-- 終わったはずのゲームが出続けていた

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
      best_score, best_challenge_id, play_count, first_played_at, last_played_at, first_cleared_at
    )
    values (
      new.user_id,
      (select nickname from public.game_profiles where user_id = new.user_id),
      new.difficulty, new.pref_code, new.pref_name, new.city_code, new.city_name,
      new.score, new.id, 1, new.played_at, new.played_at,
      case when new.cleared then new.played_at end
    )
    on conflict (user_id, difficulty, pref_code, coalesce(city_code, ''))
    do update set
      nickname = excluded.nickname,
      best_score = excluded.best_score,
      best_challenge_id = excluded.best_challenge_id,
      pref_name = excluded.pref_name,
      city_name = excluded.city_name,
      play_count = public.game_map_pack_best.play_count + 1,
      last_played_at = excluded.last_played_at,
      first_cleared_at = coalesce(public.game_map_pack_best.first_cleared_at, excluded.first_cleared_at);
  else
    update public.game_map_pack_best
    set play_count = play_count + 1,
        last_played_at = new.played_at,
        first_cleared_at = coalesce(first_cleared_at, case when new.cleared then new.played_at end)
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

revoke all on function public.game_map_pack_challenges_after_insert() from public, anon;

-- 抜け落ちていた間に残ってしまった中断データ(保存した後にそのエリアの挑戦が記録されているもの)を消す
delete from public.game_map_pack_progress p
where exists (
  select 1 from public.game_map_pack_challenges c
  where c.user_id = p.user_id
    and c.difficulty = p.difficulty
    and c.pref_code = p.pref_code
    and coalesce(c.city_code, '') = p.city_code_key
    and c.played_at > p.saved_at
);
