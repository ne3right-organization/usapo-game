-- 市区町村図鑑クイズ: トリビア(主な産業・名物)と正答率集計
--
-- シルエットのみでは出題が難しすぎるというフィードバックを受け、正答前のヒントとして
-- 「主な産業」「名物・特産品」を表示できるようにする(表示タイミングはユーザー確認済み:
-- 回答前にヒントとして表示)。データはまず少数自治体(12件)で試す方針(ユーザー確認済み)。
-- 出典はWikipedia(日本語版、CC BY-SA)の該当記事から実際に取得した記述を要約したもの。
-- 事実の要約であり著作権保護対象の創作的表現の転載ではないが、出典を明示する目的で
-- source_urlを保持し、UI上でも出典リンクを表示する。
--
-- 出題対象は「トリビア登録済みの自治体のみ」に限定する(ユーザー確認済み)。
-- game_zukan_quiz_data.ts側の出題ロジックは、このテーブルの内容をRoute Handlerが
-- 取得してから対象自治体を選ぶ形に変更する(全国ランダム→トリビア登録済みからランダム)。
--
-- 注意: トリビアの中身(実データ)はこのマイグレーションには含めない(公開リポジトリに
-- クイズの元ネタをそのまま置くと答えが割れる・スクレイピングされやすくなるため)。
-- テーブル定義のみここで管理し、データ投入はSupabase Management APIから別途行う運用とする。

create table public.game_zukan_municipality_trivia (
  pref_code text not null,
  city_code text not null,
  industry text, -- 主な産業
  specialty text, -- 名物・特産品
  source_url text, -- 出典(Wikipedia記事URL)
  created_at timestamptz not null default now(),
  primary key (pref_code, city_code)
);

alter table public.game_zukan_municipality_trivia enable row level security;

create policy "game_zukan_municipality_trivia_select" on public.game_zukan_municipality_trivia
  for select using (true);

-- 20260722000000/20260724000001で判明した「SQLマイグレーション経由のテーブルは明示GRANT
-- の内容に関わらずanon/authenticatedへ暗黙権限が付くことがある」という既知の挙動を踏まえ、
-- 今回は先に明示的にREVOKEしてから意図した権限だけをGRANTする
revoke all on public.game_zukan_municipality_trivia from anon, authenticated;
-- 出題API(/api/zukan-quiz)がanonキーで読む(ログイン状態に関わらず出題は誰でも可能なため)。
-- クイズ本文は非公開情報ではないのでauthenticatedにも合わせて許可する
grant select on public.game_zukan_municipality_trivia to anon, authenticated;

-- ─── 正答率の集計 ────────────────────────────────────────────────────────────
-- 自治体ごとの出題回数・正解回数を全ユーザー横断で集計する(ユーザーからの追加要望)。
-- ログイン有無に関わらずすべての回答を対象にする(母数を増やして統計としての意味を持たせるため)。
-- 書き込み・参照はclaim_zukan_quiz_answer関数(security definer)経由のみ。
-- 直接のGRANTは一切行わない(不正な水増しを防ぐため)

create table public.game_zukan_municipality_stats (
  pref_code text not null,
  city_code text not null,
  attempt_count integer not null default 0,
  correct_count integer not null default 0,
  primary key (pref_code, city_code)
);

alter table public.game_zukan_municipality_stats enable row level security;
revoke all on public.game_zukan_municipality_stats from anon, authenticated;
-- RLSポリシーを意図的に作らない(anon/authenticatedにはGRANTも無いため、
-- ポリシーが無くてもテーブルへの直接アクセスは全て拒否される)

-- claim_zukan_quiz_answer を再定義し、回答のたびに正答率集計を更新して結果に含める。
-- 戻り値の列(RETURNS TABLE)を増やすため、create or replaceでは型変更エラーになる。
-- 先にdropしてから作り直す
drop function if exists public.claim_zukan_quiz_answer(uuid, text, text);

create function public.claim_zukan_quiz_answer(
  p_session_id uuid,
  p_answer_pref_code text,
  p_answer_city_code text
)
returns table (
  is_correct boolean,
  pref_code text,
  pref_name text,
  city_code text,
  city_name text,
  population integer,
  households integer,
  attempt_count integer,
  correct_count integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_session public.game_zukan_quiz_sessions;
begin
  select * into v_session
  from public.game_zukan_quiz_sessions s
  where s.id = p_session_id
    and s.consumed_at is null
    and s.created_at > now() - interval '30 minutes'
  for update;

  if not found then
    raise exception 'このクイズは期限切れか、すでに回答済みです';
  end if;

  update public.game_zukan_quiz_sessions
  set consumed_at = now()
  where id = p_session_id;

  is_correct := (p_answer_pref_code = v_session.pref_code and p_answer_city_code = v_session.city_code);
  pref_code := v_session.pref_code;
  pref_name := v_session.pref_name;
  city_code := v_session.city_code;
  city_name := v_session.city_name;
  population := v_session.population;
  households := v_session.households;

  insert into public.game_zukan_municipality_stats (pref_code, city_code, attempt_count, correct_count)
  values (v_session.pref_code, v_session.city_code, 1, case when is_correct then 1 else 0 end)
  on conflict (pref_code, city_code) do update set
    attempt_count = public.game_zukan_municipality_stats.attempt_count + 1,
    correct_count = public.game_zukan_municipality_stats.correct_count
      + (case when is_correct then 1 else 0 end)
  returning public.game_zukan_municipality_stats.attempt_count, public.game_zukan_municipality_stats.correct_count
  into attempt_count, correct_count;

  if is_correct and auth.uid() is not null then
    insert into public.game_zukan_collections (
      user_id, pref_code, city_code, pref_name, city_name, population, households,
      correct_count, first_acquired_at, last_acquired_at
    )
    values (
      auth.uid(), v_session.pref_code, v_session.city_code, v_session.pref_name, v_session.city_name,
      v_session.population, v_session.households, 1, now(), now()
    )
    on conflict (user_id, pref_code, city_code) do update set
      correct_count = public.game_zukan_collections.correct_count + 1,
      last_acquired_at = now();
  end if;

  return next;
end;
$$;

-- drop functionで既存のexecute権限も失われるため再付与する
grant execute on function public.claim_zukan_quiz_answer(uuid, text, text) to authenticated, anon;
