-- 地図ポットン: 「割って積み直す」(1回200点)を得点の計算に入れる。
--
-- 合体したかたまりが輪になって内側に入る地域がくっつけられなくなったとき用に、一番大きいかたまりを
-- 2つに割ってから全部を積み直す機能を追加した。クライアントの得点計算(MapPackGame.tsx)と同じく、
-- DB側でも 割った回数×200点 を差し引く。
-- 割ってくっつけ直した合体はクライアント側で0点にしている(一度くっついたことのある地域同士)ため、
-- 合体の点の上限(merge_points の CHECK 制約)はそのままで足りる

alter table public.game_map_pack_challenges
  add column split_count integer not null default 0 check (split_count >= 0);

-- 戻り値の型は変えないので create or replace でよい
create or replace function public.game_map_pack_challenges_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_best integer;
begin
  -- クライアントの得点計算(MapPackGame.tsx)と同じ式:
  --   max(0, 合体の点 - 積み直し回数×50 - 割って積み直した回数×200) + 完成ボーナス(1000 + 300秒を切った分×5)
  new.clear_bonus := case when new.cleared then 1000 + greatest(0, 300 - new.elapsed_seconds) * 5 else 0 end;
  new.score := greatest(0, new.merge_points - new.restack_count * 50 - new.split_count * 200) + new.clear_bonus;

  select best_score into current_best
  from public.game_map_pack_best
  where user_id = new.user_id
    and difficulty = new.difficulty
    and pref_code = new.pref_code
    and coalesce(city_code, '') = coalesce(new.city_code, '');

  new.is_new_best := current_best is null or new.score > current_best;
  return new;
end;
$$;

revoke all on function public.game_map_pack_challenges_before_insert() from public, anon;
