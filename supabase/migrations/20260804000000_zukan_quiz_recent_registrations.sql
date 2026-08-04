-- 市区町村図鑑クイズ: トップページに「最近図鑑に登録された自治体」を表示するためのRPC。
--
-- game_zukan_collectionsのSELECT RLSは「本人 or nickname公開済みユーザー」のみ許可だが、
-- ここではユーザーを一切特定しない集計(自治体名+最終登録時刻のみ)を返すため、
-- privacyの観点ではnickname非公開ユーザーの分も含めて構わない。RLSを経由せず
-- security definer関数でテーブルを直接集計し、匿名(anon)にも実行を許可する
-- (むずかしいでクリアするとトリビア未登録の自治体も出るため、この一覧を見た人に
-- トリビア提案や管理者への連絡を促す狙い)

create function public.fetch_recent_zukan_registrations(p_limit integer default 8)
returns table (
  pref_code text,
  pref_name text,
  city_code text,
  city_name text,
  last_acquired_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select pref_code, pref_name, city_code, city_name, max(last_acquired_at) as last_acquired_at
  from public.game_zukan_collections
  group by pref_code, pref_name, city_code, city_name
  order by last_acquired_at desc
  limit greatest(p_limit, 0);
$$;

revoke all on function public.fetch_recent_zukan_registrations(integer) from public;
grant execute on function public.fetch_recent_zukan_registrations(integer) to anon, authenticated;
