-- 20260805000000で作成した resolve_map_conquest_battle に execute on function を
-- authenticated へ付与したが、Postgresは関数作成時にPUBLICへEXECUTE権限を暗黙付与する
-- (テーブルと異なる挙動)ため、明示的なrevokeを書き忘れるとanonからも呼び出せてしまう。
--
-- 実機確認したところ、実際にanonキーで resolve_map_conquest_battle を呼び出せてしまう
-- ことを確認した(セッション行のuser_id = auth.uid()判定によりanonでは実データには
-- 到達できないが、意図(ログイン必須)に反しておりリスクの芽になるため塞ぐ)。
-- 20260804000000_zukan_quiz_recent_registrations.sql で既に踏んでいた教訓と同種のもの。
-- 今後この地図制覇ゲームで新しい関数(RPC)を追加する際も、必ず
-- `revoke all on function ... from public;` を先に書いてから意図したロールにgrantすること。

revoke all on function public.resolve_map_conquest_battle(uuid) from public;
grant execute on function public.resolve_map_conquest_battle(uuid) to authenticated;
