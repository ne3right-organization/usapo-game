-- 地図制覇ゲーム(プロトタイプ): 自分の進行状況をリセットする関数。
--
-- 設計上「占領は恒久的(シーズンリセットなし)」が本来の方針だが、現段階はまだ大田区限定の
-- プロトタイプで、繰り返しテストプレイする用途のために「テスト用リセットボタン」が欲しいと
-- ユーザーから要望があった。本番機能というより開発中の検証用機能という位置づけのため、
-- UI側にもその旨を明記する(将来的にマクロ層・本番相当の機能が揃った段階で、この関数/ボタンを
-- 残すかどうかは改めて検討する)。
--
-- SECURITY DEFINERはRLSを経由しないため、必ずauth.uid()で自分の行だけに絞ること
-- (絞り忘れると他ユーザーの行まで消せてしまう関数になってしまう)。

create or replace function public.reset_map_conquest_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.game_map_conquest_tiles where user_id = auth.uid();
  delete from public.game_map_conquest_municipalities where user_id = auth.uid();
  delete from public.game_map_conquest_prefecture_progress where user_id = auth.uid();
  delete from public.game_map_conquest_players where user_id = auth.uid();
end;
$$;

-- 関数のEXECUTE権限もテーブルと同様anonへ自動付与されることが判明済みのため
-- (20260805000002_map_conquest_revoke_anon_execute.sql参照)、明示的に締め出す
revoke all on function public.reset_map_conquest_progress() from public;
revoke all on function public.reset_map_conquest_progress() from anon;
grant execute on function public.reset_map_conquest_progress() to authenticated;
