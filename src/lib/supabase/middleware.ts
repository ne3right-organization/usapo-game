import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Server Component からは Cookie を書き込めないため、セッション(トークン)の更新は
// このヘルパーを proxy.ts (旧 middleware.ts) から呼び出す形で行う
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Supabaseプロジェクト未接続の間は素通りさせる(全ルートに影響するproxyなので、
  // 環境変数が無い状態で例外を投げてサイト全体を壊さないためのガード)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // トークンが期限切れなら更新する。呼び出し自体は必須(セッション維持のため)
  await supabase.auth.getUser();

  return response;
}
