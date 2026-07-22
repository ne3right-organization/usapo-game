-- Supabaseの新規プロジェクトは「Automatically expose new tables」の設定にかかわらず、
-- (SQLマイグレーション経由で作成したテーブルについて) anon ロールにもデフォルト権限が
-- 付与されることが判明したため、明示的に剥奪する。
--
-- RLSポリシー自体は auth.uid() 一致を要求する設計のため、この付与だけで実害のある穴には
-- なっていなかったが(未ログイン状態の auth.uid() は null になるため)、多層防御として
-- GRANTレベルでも anon を締め出しておく。ログイン必須の仕様（元実装のCognito版と同様）

revoke all on public.game_profiles from anon;
revoke all on public.game_map_puzzle_challenges from anon;
revoke all on public.game_map_puzzle_progress from anon;
revoke all on public.game_map_puzzle_best from anon;
