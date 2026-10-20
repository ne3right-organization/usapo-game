import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { RETURN_PATH_COOKIE, safeReturnPath } from "@/lib/loginReturn";

// SupabaseのOAuth(Google)リダイレクト先。認可コードをセッションに交換する
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // ログインボタンを押した画面に戻す(ログイン画面が Cookie に入れておく。src/lib/loginReturn.ts 参照)
  const cookieStore = await cookies();
  const saved = cookieStore.get(RETURN_PATH_COOKIE)?.value;
  let savedPath: string | null = null;
  try {
    savedPath = saved ? decodeURIComponent(saved) : null;
  } catch {
    // 壊れた値ならトップに戻すだけ
  }
  const next = safeReturnPath(searchParams.get("next") ?? savedPath);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.delete(RETURN_PATH_COOKIE);
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
