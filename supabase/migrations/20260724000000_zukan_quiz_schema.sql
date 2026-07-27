-- 市区町村図鑑クイズ: 図鑑コレクション・出題セッション用スキーマ
--
-- 出題(ポリゴン・統計値の取得、ダミー選択肢の生成)は Next.js の Route Handler
-- (/api/zukan-quiz) が担当し、正答は game_zukan_quiz_sessions に保存する。
-- 地図パズル(game_map_puzzle_*)と同様、クライアントの自己申告(「正解でした」という
-- フラグ)を信用せず、正誤判定はこのファイルの claim_zukan_quiz_answer 関数(security definer)
-- がサーバー側(DB側)で行う。
--
-- 正答を隠す設計の要点:
-- - game_zukan_quiz_sessions は authenticated/anon どちらにも INSERT のみ許可し、
--   SELECT/UPDATE は一切許可しない(直接読めると正答が漏れるため)。参照・消費は
--   claim_zukan_quiz_answer 関数(security definer)経由のみ
-- - 出題API(/api/zukan-quiz)がクライアントへ返すシルエットは、CloudFrontのgeojsonから
--   座標だけを抜き出したもの(prefCode/cityCode/cityName等のプロパティは含めない)

-- ─── game_zukan_collections ─────────────────────────────────────────────────
-- 図鑑。正解した市区町村がユーザーごとに1行登録される

create table public.game_zukan_collections (
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_code text not null,
  city_code text not null,
  pref_name text not null,
  city_name text not null,
  population integer,
  households integer,
  correct_count integer not null default 1,
  first_acquired_at timestamptz not null default now(),
  last_acquired_at timestamptz not null default now(),
  primary key (user_id, pref_code, city_code)
);

create index game_zukan_collections_user_pref_idx
  on public.game_zukan_collections (user_id, pref_code);

alter table public.game_zukan_collections enable row level security;

-- 本人のみ閲覧可。書き込みは claim_zukan_quiz_answer 経由のみ(直接のINSERT/UPDATEは許可しない)
create policy "game_zukan_collections_select" on public.game_zukan_collections
  for select using (user_id = auth.uid());

-- ─── game_zukan_quiz_sessions ───────────────────────────────────────────────
-- 出題1回ごとの正答を保持する一時テーブル。回答(claim_zukan_quiz_answer)後は
-- consumed_at を立てて使い捨てにする(再送・使い回し防止)

create table public.game_zukan_quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  pref_code text not null,
  city_code text not null,
  pref_name text not null,
  city_name text not null,
  population integer,
  households integer,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

-- ─── GRANT ───────────────────────────────────────────────────────────────────
-- SQLマイグレーション経由のテーブルは「Automatically expose new tables」設定に
-- 関わらずanon/authenticatedへ暗黙のデフォルト権限が付くことが判明済みのため、
-- 意図した権限だけを明示的に付与する(20260722000000_revoke_anon_grants.sql の教訓)。
--
-- game_zukan_collections: authenticatedにはSELECTのみ許可。INSERT/UPDATEは許可しない
-- (許可すると、クイズを解かずに直接カードを自己付与できてしまうため)
-- game_zukan_quiz_sessions: authenticated/anonにはINSERTのみ許可。SELECT/UPDATEは許可しない
-- (SELECTを許可すると正答がそのまま読めてしまうため)。ゲストプレイもできる仕様のためanonにも付与

grant select on public.game_zukan_collections to authenticated;
grant insert on public.game_zukan_quiz_sessions to authenticated, anon;

-- ─── claim_zukan_quiz_answer ─────────────────────────────────────────────────
-- クイズの回答を受け取り、正誤判定・図鑑への登録までをサーバー側(DB側)で行う。
-- クライアントは選んだ(pref_code, city_code)しか送らず、正答そのものは一切送らない。

create or replace function public.claim_zukan_quiz_answer(
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
  households integer
)
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.claim_zukan_quiz_answer(uuid, text, text) to authenticated, anon;

-- ─── 期限切れセッションの掃除 ─────────────────────────────────────────────────
-- game_zukan_quiz_sessions はINSERTのみのテーブルなので、放置すると増え続ける。
-- pg_cronで日次で古い行を削除する(拡張が使えない環境向けに存在チェック付き)

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    -- 同名ジョブが既にあれば一旦解除してから登録し直す(マイグレーション再実行時の重複防止)
    if exists (select 1 from cron.job where jobname = 'zukan_quiz_sessions_cleanup') then
      perform cron.unschedule('zukan_quiz_sessions_cleanup');
    end if;

    perform cron.schedule(
      'zukan_quiz_sessions_cleanup',
      '0 18 * * *', -- 毎日18:00 UTC(日本時間 03:00)
      $cron$delete from public.game_zukan_quiz_sessions where created_at < now() - interval '1 day'$cron$
    );
  end if;
end;
$$;
