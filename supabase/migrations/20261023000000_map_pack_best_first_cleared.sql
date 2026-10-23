-- 地図ポットン: ベスト記録に「初めて完成させた日時」を持たせる。
--
-- 地図ポットンはあきらめた挑戦も記録するため、game_map_pack_best に行があっても完成させたとは限らない。
-- 挑戦履歴(game_map_pack_challenges)のSELECT RLSは本人のみなので、他の人のプロフィールの
-- コンプリート表示やランキングのエリア一覧で「完成させたか」を出すには、公開されているベスト記録の側に
-- 持たせる必要がある。null なら未完成

alter table public.game_map_pack_best
  add column first_cleared_at timestamptz;

-- これまでの記録から埋める
update public.game_map_pack_best b
set first_cleared_at = c.first_cleared_at
from (
  select user_id, difficulty, pref_code, coalesce(city_code, '') as city_code_key, min(played_at) as first_cleared_at
  from public.game_map_pack_challenges
  where cleared
  group by user_id, difficulty, pref_code, coalesce(city_code, '')
) c
where b.user_id = c.user_id
  and b.difficulty = c.difficulty
  and b.pref_code = c.pref_code
  and coalesce(b.city_code, '') = c.city_code_key;

-- 戻り値の型は変えないので create or replace でよい。
-- 完成した挑戦がベスト更新にならなかった場合(前に完成させたときの方が点が高い、など)もあるので、両方の分岐で埋める
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
  return new;
end;
$$;

revoke all on function public.game_map_pack_challenges_after_insert() from public, anon;
