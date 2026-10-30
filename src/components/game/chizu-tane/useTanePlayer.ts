"use client";

import { useCallback, useEffect, useState } from "react";
import { currentUser } from "@/lib/auth";
import { fetchTanePlayer, type TanePlayer } from "@/lib/game/chizuTaneData";

export type TanePlayerState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "not-started" }
  | { status: "ready"; player: TanePlayer }
  | { status: "error"; message: string };

/** ログインと「コースを選んで始めたか」をまとめて見る。地図タネの各画面で使う */
export function useTanePlayer(): [TanePlayerState, () => void] {
  const [state, setState] = useState<TanePlayerState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(await currentUser())) {
          if (!cancelled) setState({ status: "signed-out" });
          return;
        }
        const player = await fetchTanePlayer();
        if (!cancelled) setState(player ? { status: "ready", player } : { status: "not-started" });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  return [state, reload];
}
