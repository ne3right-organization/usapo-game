// ログイン後に、ログインボタンを押した画面へ戻すための共通処理。
// 以前は戻り先が地図パズルのトップ(/game/map-puzzle)に固定されていた(地図パズルしかなかった頃の名残)。
//
// 仕組み: 各画面を開くたびに今のURLを sessionStorage に覚えておき(ReturnPathTracker)、ログイン画面で
// Googleログインを始めるときにそれを短時間だけ有効な Cookie に入れ、認証後のコールバック(サーバー側)で読んで転送する。
// 戻り先を OAuth の redirectTo のクエリに載せないのは、Supabase の Redirect URLs の許可リストと
// 一致しなくなる恐れがあるため

export const RETURN_PATH_STORAGE_KEY = "loginReturnPath";
export const RETURN_PATH_COOKIE = "login_return_path";
export const RETURN_PATH_COOKIE_MAX_AGE = 600; // Googleでのログインにかかる時間として十分な長さ(秒)

/** 戻り先として安全なパスだけを通す(外部サイトやログイン画面自身には戻さない) */
export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/";
  if (path.startsWith("/login") || path.startsWith("/auth")) return "/";
  return path;
}
