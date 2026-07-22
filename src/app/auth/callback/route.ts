import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabaseのマジックリンク/OAuthリダイレクト先。認可コードをセッションに交換する
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/game/map-puzzle";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
