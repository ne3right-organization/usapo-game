# うさぽ農園 アイテムの絵の元画像

画像生成AIで作った元の画像を置くフォルダ。手順とプロンプトは [docs/地図タネ_絵の作り方.md](../../docs/地図タネ_絵の作り方.md)。

- `sheets/` … 作業表の1シートを1枚で。ファイル名はシートID（`plant-1.png` 〜 `building-4.png`）
- `singles/` … 1点だけ作り直したもの。ファイル名はアイテムID（例: `orchard_1.png`）
- 置いたら次を動かす。`public/chizu-tane/items/` にゲーム用の絵ができ、ゲームに出るようになる

  ```
  npx tsx scripts/chizu-tane/process-item-images.mts
  ```

元の画像は大きいので git には入れない（`.gitignore`）。コミットするのはできあがった `public/chizu-tane/items/` と `src/lib/game/chizuTane/itemImages.generated.ts`。
