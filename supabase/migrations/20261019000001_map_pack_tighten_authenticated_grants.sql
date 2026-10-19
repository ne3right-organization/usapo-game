-- 地図パック: authenticated の権限を必要なものだけに絞る。
--
-- 20261019000000_map_pack_schema.sql では anon の権限だけを明示的に剥がしたが、適用後に
-- information_schema.role_table_grants を確認したところ、authenticated にも
-- DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE が自動で付いていた
-- (anon への自動付与と同じ挙動。CLAUDE.md 参照)。
-- UPDATE/DELETE は RLS ポリシーが無いので実際には拒否されるが、TRUNCATE は RLS の対象外のため、
-- 図鑑クイズ(20260724000001_zukan_quiz_revoke_grants.sql)と同じく全部剥がしてから必要な分だけ付け直す。

revoke all on public.game_map_pack_challenges from authenticated;
revoke all on public.game_map_pack_best from authenticated;

grant select, insert on public.game_map_pack_challenges to authenticated;
grant select on public.game_map_pack_best to authenticated;
