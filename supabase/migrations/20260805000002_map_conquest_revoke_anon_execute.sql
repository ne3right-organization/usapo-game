-- 20260805000001 は "revoke all on function ... from public" だけで塞いだつもりだったが、
-- 実機のpg_proc.proaclを確認したところ anon=X/postgres という「PUBLICとは別の、anonへの
-- 明示的なEXECUTE権限」が付いたままだった。
--
-- 原因は 20260722000000_revoke_anon_grants.sql で既に確認済みだった挙動と同じ
-- (SupabaseはSQLマイグレーション経由で作成したオブジェクトにanon/authenticatedへの
-- デフォルト権限を自動付与するイベントトリガーを持っており、これはテーブルだけでなく
-- 関数(EXECUTE)にも及ぶ)。"revoke ... from public" は暗黙のPUBLIC付与を消すだけで、
-- この自動付与された anon への直接GRANTは別途 "revoke ... from anon" が必要だった。
--
-- 今後この地図制覇ゲームで新しい関数(RPC)を追加する際は、テーブルと同様に
-- 必ず "revoke all on function ... from anon;" も明示的に書くこと
-- (from public だけでは不十分、が今回の実機確認で得られた教訓)。

revoke all on function public.resolve_map_conquest_battle(uuid) from anon;
