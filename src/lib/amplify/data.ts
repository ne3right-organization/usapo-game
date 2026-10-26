"use client";

import "@/lib/amplify/configure";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";

export type { Schema };

// ブラウザから Amplify Data(AppSync)を呼ぶクライアント。認可はログイン中の Cognito ユーザー
export const data = generateClient<Schema>();

/** Amplify Data の結果を、エラーなら例外にして中身だけ返す */
export function unwrap<R extends { data: unknown; errors?: readonly { message: string }[] }>(res: R): R["data"] {
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
  return res.data;
}

/** 難易度×エリアのキー(中断データ・ベスト記録の主キーの一部)。amplify/functions の Lambda と同じ形 */
export function areaKeyOf(area: { difficulty: string; prefCode: string; cityCode?: string | null }): string {
  return `${area.difficulty}#${area.prefCode}#${area.cityCode ?? ""}`;
}

/** エリア別ランキングのキー。上級だけ市区町村まで含める */
export function rankingKeyOf(area: { difficulty: string; prefCode: string; cityCode?: string | null }): string {
  return area.difficulty === "advanced"
    ? `${area.difficulty}#${area.prefCode}#${area.cityCode ?? ""}`
    : `${area.difficulty}#${area.prefCode}`;
}

/** ランキングなど人を出す一覧で、ニックネーム未設定の人を外すフィルタ(空・null・未設定はどれも "" より大きくない) */
export const HAS_NICKNAME = { nickname: { gt: "" } } as const;
