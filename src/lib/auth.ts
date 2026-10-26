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

/** Google のログイン画面に移る。終わると Cognito の設定どおり /login に戻ってくる */
export async function signInWithGoogle(): Promise<void> {
  await signInWithRedirect({ provider: "Google" });
}

/** Cognito からもログアウトして、サイトのトップに戻る */
export async function signOutUser(): Promise<void> {
  await signOut();
}
