-- 地図ポットン: 難易度別ランキングを「1人1行」にするための集計RPC。
--
-- これまでは game_map_pack_best(ユーザー×エリアの自己ベスト)をそのまま点数順に並べていたため、
-- たくさんのエリアを遊んだ人が上位を何行も占めていた。ユーザーごとに、その難易度のエリアごとの
-- 自己ベストの合計点で並べ、一番点の高いエリアも一緒に返す。
--
-- security invoker(既定)なので game_map_pack_best のRLSがそのまま効く:
-- ニックネームを設定した人の行と、自分自身の行だけが集計の対象になる(公開範囲はこれまでのランキングと同じ)。
-- これまでのランキングと同じく閲覧は要ログインとし、anon には実行を許可しない

create function public.fetch_map_pack_user_ranking(
  p_difficulty game_difficulty,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  nickname text,
  total_score integer,
  areas_count integer,
  top_pref_code text,
  top_pref_name text,
  top_city_code text,
  top_city_name text,
  top_score integer,
  last_played_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with b as (
    select * from public.game_map_pack_best where difficulty = p_difficulty
  ),
  agg as (
    select user_id, max(nickname) as nickname, sum(best_score)::integer as total_score,
           count(*)::integer as areas_count, max(last_played_at) as last_played_at
    from b
    group by user_id
  ),
  top as (
    select distinct on (user_id) user_id, pref_code, pref_name, city_code, city_name, best_score
    from b
    order by user_id, best_score desc, last_played_at desc
  )
  select a.user_id, a.nickname, a.total_score, a.areas_count,
         t.pref_code, t.pref_name, t.city_code, t.city_name, t.best_score, a.last_played_at
  from agg a
  join top t using (user_id)
  order by a.total_score desc, a.user_id
  limit least(greatest(p_limit, 0), 100)
  offset greatest(p_offset, 0);
$$;

-- 関数のEXECUTE権限は anon にも自動で付くことが分かっているため(CLAUDE.md 参照)、明示的に剥がす
revoke all on function public.fetch_map_pack_user_ranking(game_difficulty, integer, integer) from public, anon;
grant execute on function public.fetch_map_pack_user_ranking(game_difficulty, integer, integer) to authenticated;
