-- 地図制覇ゲーム(プロトタイプ): 戦闘からサイコロ補正を廃止。
--
-- 当初はdocs/map_conquest_game/battle-phase-mock.htmlの「事前勝率をサイコロの出目で補正する」
-- 式をそのまま移植していたが、ユーザー指示によりサイコロは移動フェーズ専用の演出とし、
-- 戦闘の勝敗判定は事前勝率(攻撃力/(攻撃力+守備力)、5%〜95%にクランプ)をそのまま使う方式に変更する。
--
-- RETURNS TABLEの列構成(diceを削除、final_probability→win_probabilityに変更)を変えるため、
-- create or replaceでは対応できない(20260725000000等で踏んだ既知の制約)。drop→createし直す。

drop function if exists public.resolve_map_conquest_battle(uuid);

create or replace function public.resolve_map_conquest_battle(p_session_id uuid)
returns table (
  is_win boolean,
  win_probability numeric,
  budget_delta integer,
  new_budget integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_map_conquest_battle_sessions;
  v_prob numeric;
  v_win boolean;
  v_delta integer;
  v_budget integer;
begin
  select * into v_session
  from public.game_map_conquest_battle_sessions s
  where s.id = p_session_id
    and s.user_id = auth.uid()
    and s.consumed_at is null
    and s.created_at > now() - interval '30 minutes'
  for update;

  if not found then
    raise exception 'この戦闘は期限切れか、すでに決着しています';
  end if;

  update public.game_map_conquest_battle_sessions
  set consumed_at = now()
  where id = p_session_id;

  v_prob := least(0.95, greatest(0.05, v_session.attack_value::numeric / (v_session.attack_value + v_session.defense_value)));
  v_win := random() < v_prob;

  insert into public.game_map_conquest_players (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  if v_win then
    v_delta := round(v_session.defense_value * 0.15);

    insert into public.game_map_conquest_tiles (
      user_id, pref_code, city_code, town_code, town_name, attribute, captured_at
    )
    values (
      auth.uid(), v_session.pref_code, v_session.city_code, v_session.town_code,
      v_session.town_name, v_session.attribute, now()
    )
    on conflict (user_id, pref_code, city_code, town_code) do nothing;

    update public.game_map_conquest_players
    set budget = budget + v_delta
    where user_id = auth.uid()
    returning budget into v_budget;
  else
    v_delta := -round(v_session.defense_value * 0.12);

    update public.game_map_conquest_players
    set budget = greatest(0, budget + v_delta)
    where user_id = auth.uid()
    returning budget into v_budget;
  end if;

  is_win := v_win;
  win_probability := v_prob;
  budget_delta := v_delta;
  new_budget := v_budget;

  return next;
end;
$$;

-- 関数のEXECUTE権限はPostgres/Supabaseの挙動によりPUBLIC・anonへ暗黙付与されるため
-- (20260805000001/20260805000002参照)、drop+create後もあらためて明示的に締め出す
revoke all on function public.resolve_map_conquest_battle(uuid) from public;
revoke all on function public.resolve_map_conquest_battle(uuid) from anon;
grant execute on function public.resolve_map_conquest_battle(uuid) to authenticated;
