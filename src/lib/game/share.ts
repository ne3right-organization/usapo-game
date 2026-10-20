// クリア画面から X(旧Twitter)に結果をシェアするための投稿画面URL。
// x.com/intent/post は未ログインだとログイン画面に飛ぶが、そのあと投稿画面に戻れる

export const SHARE_HASHTAG = "うさぽゲーム";

export function xShareUrl(text: string, url: string, hashtags: string[] = [SHARE_HASHTAG]): string {
  const q = new URLSearchParams({ text, url, hashtags: hashtags.join(",") });
  return `https://x.com/intent/post?${q.toString()}`;
}

/** 相対パスをこのサイトの絶対URLにする(シェアするリンク用) */
export function absoluteUrl(path: string): string {
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
}
