"use client";

import "@/lib/amplify/configure";
import { generateClient } from "aws-amplify/data";
import { currentUser } from "@/lib/auth";
import type { Schema } from "../../../amplify/data/resource";

export type { Schema };

// ブラウザから Amplify Data(AppSync)を呼ぶクライアント。認可はログイン中の Cognito ユーザー
export const data = generateClient<Schema>();

/**
 * 未ログインでも呼べる API(図鑑クイズ・最近のクリア)用の認証方式。
 * ログインしていれば Cognito のユーザー、していなければ Identity Pool のゲストとして呼ぶ
 */
export async function guestOrUserAuthMode(): Promise<"userPool" | "identityPool"> {
  return (await currentUser()) ? "userPool" : "identityPool";
}

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
