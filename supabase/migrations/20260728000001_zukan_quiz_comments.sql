-- 市区町村図鑑クイズ: カードへのコメント(ソーシャル機能)
--
-- 自分が獲得済みのカードにのみコメントできる(「クリア数に応じて投稿できればよい」という
-- 要望の実装として、そのカードを獲得済みであることをRLSで要求する簡易的なスパム対策。
-- ユーザー確認済み: モデレーション機能は未実装で、荒らしが出たら別途対応する方針)。
-- 1ユーザー1カードにつき1件(編集・削除は本人のみ)。閲覧はログインユーザーなら誰でも可

create table public.game_zukan_collection_comments (
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_code text not null,
  city_code text not null,
  nickname text, -- 記録時点の game_profiles.nickname のスナップショット(game_map_puzzle_challengesと同じパターン)
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, pref_code, city_code)
);

create trigger game_zukan_collection_comments_set_updated_at
  before update on public.game_zukan_collection_comments
  for each row execute function public.set_updated_at();

alter table public.game_zukan_collection_comments enable row level security;

create policy "game_zukan_collection_comments_select" on public.game_zukan_collection_comments
  for select using (auth.uid() is not null);

create policy "game_zukan_collection_comments_insert" on public.game_zukan_collection_comments
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.game_zukan_collections c
      where c.user_id = auth.uid() and c.pref_code = pref_code and c.city_code = city_code
    )
  );

create policy "game_zukan_collection_comments_update" on public.game_zukan_collection_comments
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.game_zukan_collections c
      where c.user_id = auth.uid() and c.pref_code = pref_code and c.city_code = city_code
    )
  );

create policy "game_zukan_collection_comments_delete" on public.game_zukan_collection_comments
  for delete using (auth.uid() = user_id);

-- 既知の挙動(暗黙GRANT、20260722000000/20260724000001/20260726000000参照)を踏まえ、
-- 明示的にREVOKEしてから意図した権限だけをGRANTする
revoke all on public.game_zukan_collection_comments from anon, authenticated;
grant select, insert, update, delete on public.game_zukan_collection_comments to authenticated;
