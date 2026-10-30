"use client";

import "@/lib/amplify/configure";
import { getCurrentUser, signInWithRedirect, signOut } from "aws-amplify/auth";

// ログイン(Cognito + Google)の共通処理。ユーザーIDは Cognito の sub

export interface CurrentUser {
  id: string;
}

/** 未ログインなら null */
export async function currentUser(): Promise<CurrentUser | null> {
  try {
    const { userId } = await getCurrentUser();
    return { id: userId };
  } catch {
    return null;
  }
}

/**
 * Google のログイン画面に移る。終わると Cognito の設定どおり /login に戻ってくる。
 * ブラウザに複数の Google アカウントがあっても選べるよう、毎回アカウントの選択画面を出させる
 * (Cognito が Google に prompt=select_account を渡す。Cognito のドメインが managed login であることが前提。amplify/backend.ts)
 */
export async function signInWithGoogle(): Promise<void> {
  await signInWithRedirect({ provider: "Google", options: { prompt: "SELECT_ACCOUNT" } });
}

/** Cognito からもログアウトして、サイトのトップに戻る */
export async function signOutUser(): Promise<void> {
  await signOut();
}
