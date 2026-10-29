// Web Push(PWA の通知)の VAPID の公開鍵。公開してよい鍵なので、画面(購読するとき)と Lambda(送るとき)の両方から使う。
// 対になる秘密鍵は Amplify のシークレット VAPID_PRIVATE_KEY(リポジトリには置かない)。鍵を作り直したら、両方を替える
export const VAPID_PUBLIC_KEY = "BOb5_vllLoGHa1TeradJzrxKhglA1P-zIml4wb2VWYVlsXOqQeCJTcsUH8umZIMxjyfUHQ5wxTiJjvJj9fNT4XM";

/** 送り主を名乗る連絡先(Web Push の決まりで mailto: か https: の URL) */
export const VAPID_SUBJECT = "https://game.usapo.net";
