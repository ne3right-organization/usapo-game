// ログイン後に、ログインボタンを押した画面へ戻すための共通処理。
// 以前は戻り先が地図パズルのトップ(/game/map-puzzle)に固定されていた(地図パズルしかなかった頃の名残)。
//
// 仕組み: 各画面を開くたびに今のURLを sessionStorage に覚えておき(ReturnPathTracker)、Googleでのログインから
// ログイン画面(Cognito の戻り先)に戻ってきたときに、それを読んで転送する。同じタブの中なので sessionStorage が残っている

export const RETURN_PATH_STORAGE_KEY = "loginReturnPath";

/** 戻り先として安全なパスだけを通す(外部サイトやログイン画面自身には戻さない) */
export function safeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/";
  if (path.startsWith("/login") || path.startsWith("/auth")) return "/";
  return path;
}
