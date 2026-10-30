// scripts/chizu-tane/process-item-images.mts が作るファイル。手で直さない
// 育つ途中の絵(growth.ts の GROWTH_STAGES の番号か waiting(タネ待ち) → 画像の URL)。無いときは絵文字などを出す
export const GROWTH_IMAGE_URLS: Record<string, string> = {
  "0": "/chizu-tane/growth/growth_0.png?v=5b5181a3",
  "1": "/chizu-tane/growth/growth_1.png?v=b4b9c1b8",
  "2": "/chizu-tane/growth/growth_2.png?v=b176d7c6",
  "3": "/chizu-tane/growth/growth_3.png?v=64e304ea",
  "4": "/chizu-tane/growth/growth_4.png?v=95b1b2d7",
  "waiting": "/chizu-tane/growth/growth_waiting.png?v=80fbe398",
};
