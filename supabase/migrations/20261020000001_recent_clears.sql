-- 地図パズル・地図ポットン: 各ゲームのトップに「最近クリアされたエリア」を表示するためのRPC。
--
-- 挑戦履歴(game_map_puzzle_challenges / game_map_pack_challenges)のSELECT RLSは本人のみだが、
-- ここではユーザーを一切特定しない集計(エリア+最後にクリアされた時刻のみ)を返すため、
-- 図鑑クイズの fetch_recent_zukan_registrations(20260804000000)と同じく security definer 関数で
-- テーブルを直接集計し、未ログイン(anon)にも実行を許可する。
-- 地図パズルは完成した挑戦しか記録しない(ギブアップは記録しない)ので全件が対象。
-- 地図ポットンはあきらめた挑戦も記録するので cleared = true に絞る

create function public.fetch_recent_map_puzzle_clears(p_limit integer default 8)
returns table (
  difficulty game_difficulty,
  pref_code text,
  pref_name text,
  city_code text,
  city_name text,
  last_cleared_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select difficulty, pref_code, max(pref_name), city_code, max(city_name), max(played_at) as last_cleared_at
  from public.game_map_puzzle_challenges
  group by difficulty, pref_code, city_code
  order by last_cleared_at desc
  limit least(greatest(p_limit, 0), 50);
$$;

create function public.fetch_recent_map_pack_clears(p_limit integer default 8)
returns table (
  difficulty game_difficulty,
  pref_code text,
  pref_name text,
  city_code text,
  city_name text,
  last_cleared_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select difficulty, pref_code, max(pref_name), city_code, max(city_name), max(played_at) as last_cleared_at
  from public.game_map_pack_challenges
  where cleared
  group by difficulty, pref_code, city_code
  order by last_cleared_at desc
  limit least(greatest(p_limit, 0), 50);
$$;

-- 未ログインでも見られる一覧なので anon にも実行を許可する(意図的)。PUBLIC からは剥がしておく
revoke all on function public.fetch_recent_map_puzzle_clears(integer) from public;
revoke all on function public.fetch_recent_map_pack_clears(integer) from public;
grant execute on function public.fetch_recent_map_puzzle_clears(integer) to anon, authenticated;
grant execute on function public.fetch_recent_map_pack_clears(integer) to anon, authenticated;
