-- game_zukan_municipality_trivia を削除する。
--
-- トリビアのデータソースを本体側(team-kokuusa-platform-frontend, AWS Amplify)の
-- 管理画面 + CloudFront配信(municipality-trivia/{prefCode}.json)に切り替えたため、
-- このテーブルはアプリケーションコードから一切参照されなくなった
-- (src/lib/game/zukanQuizData.ts の fetchTriviaCandidates が CloudFront から直接取得する)。
-- 詳細な経緯は CLAUDE.md の「トリビアヒント・正答率」セクション参照。
--
-- game_zukan_municipality_stats(正答率集計)は引き続き使うため対象外。
-- game_zukan_quiz_sessions / claim_zukan_quiz_answer 関数も出題の正誤判定の仕組みとして
-- 引き続き使うため対象外。

drop table if exists public.game_zukan_municipality_trivia;
