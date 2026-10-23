-- フォロー機能: プロフィール(コンプリート状況)のページから他の人をフォローできるようにする。
--
-- 誰が誰をフォローしているかは、フォローした本人とされた本人にしか見えない(他の人には公開しない)。
-- フォローする側・される側ともニックネームを設定している人に限る(ニックネームの無い人はプロフィールが
-- 非公開で、フォロワー一覧に出しても誰だか分からないため)。
-- 外部キーを game_profiles に向けているのは、フォロワー一覧で supabase-js からニックネームを
-- 一緒に引けるようにするため(PostgREST の埋め込みは外部キーが必要)

create table public.game_follows (
  follower_id uuid not null references public.game_profiles(user_id) on delete cascade,
  followee_id uuid not null references public.game_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- 自分のフォロワー一覧用(主キーの先頭は follower_id なので、followee_id 側の索引が別に要る)
create index game_follows_followee_idx on public.game_follows (followee_id, created_at desc);

alter table public.game_follows enable row level security;

create policy "game_follows_select" on public.game_follows
  for select using (follower_id = auth.uid() or followee_id = auth.uid());

create policy "game_follows_insert" on public.game_follows
  for insert with check (
    follower_id = auth.uid()
    and exists (select 1 from public.game_profiles p where p.user_id = follower_id and p.nickname is not null)
    and exists (select 1 from public.game_profiles p where p.user_id = followee_id and p.nickname is not null)
  );

create policy "game_follows_delete" on public.game_follows
  for delete using (follower_id = auth.uid());

-- SQLマイグレーションで作ったテーブルには anon・authenticated の両方に全権限が自動で付くことが
-- 分かっているため(CLAUDE.md 参照)、全部剥がしてから必要な分だけ付け直す
revoke all on public.game_follows from anon, authenticated;
grant select, insert, delete on public.game_follows to authenticated;
