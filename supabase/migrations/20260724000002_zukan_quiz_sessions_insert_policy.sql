-- 20260724000000で「INSERTのみ許可」と書きながら、RLSの有効化とINSERTポリシーの
-- 作成自体を書き忘れていた(GRANTだけではRLSが有効なテーブルへの書き込みは通らない)。
-- 実機確認(anonキーでのINSERTが row-level security policy 違反で失敗)で発覚したため追加する。

alter table public.game_zukan_quiz_sessions enable row level security;

-- 誰でも作成可(ログイン不要でクイズに挑戦できる仕様のため)。SELECT/UPDATEポリシーは
-- 意図的に作らない(正答はclaim_zukan_quiz_answer関数(security definer)経由でのみ参照・消費する)
create policy "game_zukan_quiz_sessions_insert" on public.game_zukan_quiz_sessions
  for insert with check (true);
