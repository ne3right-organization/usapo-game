-- 20260722000000_revoke_anon_grants.sql と同じ既知の挙動(SQLマイグレーション経由で
-- 作成したテーブルには、明示したGRANT文の内容に関わらずanon/authenticatedへ暗黙の
-- デフォルト権限が付くことがある)が、今回の2テーブルでも発生していることを
-- 実機確認(anonキーでのSELECTが本来失敗すべきところ200 OKで応答)したため、
-- 明示的にREVOKEしてから意図した権限だけをGRANTし直す。

revoke all on public.game_zukan_collections from anon, authenticated;
revoke all on public.game_zukan_quiz_sessions from anon, authenticated;

grant select on public.game_zukan_collections to authenticated;
grant insert on public.game_zukan_quiz_sessions to authenticated, anon;
