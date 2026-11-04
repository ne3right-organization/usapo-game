// うさぽ農園のご当地のものの絵を、ChatGPT の画像生成(OpenAI の API)に頼んで作る。
// 頼む文は local-art-prompts.mts と同じ。できたシートを art/chizu-tane/sheets/ に保存し、process-item-images.mts で切り分ける。
// 手順は docs/地図タネ_絵の作り方.md の4章。
//
//   npx tsx scripts/chizu-tane/generate-local-art.mts 13-1        # 1シートだけ(まずはこれで試す)
//   npx tsx scripts/chizu-tane/generate-local-art.mts 13          # 東京都の3シート
//   npx tsx scripts/chizu-tane/generate-local-art.mts --next 6    # まだ絵の無いシートを6枚
//   npx tsx scripts/chizu-tane/generate-local-art.mts 13-1 --force  # 置いてあるシートも作り直す
//   npx tsx scripts/chizu-tane/generate-local-art.mts 13 --dry-run  # 頼まずに、何を頼むかだけ出す
//
// API キー: 環境変数 OPENAI_API_KEY か、.env.local の OPENAI_API_KEY=...(.env* は git に入らない)。
// API は ChatGPT の月額とは別の従量課金。1シートごとにかかるので、まず1シートで試してから増やす。
// 見本の画像: art/chizu-tane/style-reference.png があればそれを、無ければ通常のアイテムの Lv.1〜3 のシート(plant-1 など)を添付する。
// 環境変数 OPENAI_IMAGE_MODEL(既定 gpt-image-1)・OPENAI_IMAGE_QUALITY(low / medium / high、既定 medium)で変えられる

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Sheet, isPlaced, prompt, selectSheets, sheetLabel } from "./local-art-prompts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SHEETS_DIR = join(ROOT, "art/chizu-tane/sheets");
const STYLE_REFERENCE = join(ROOT, "art/chizu-tane/style-reference.png");
const FALLBACK_REFERENCES = ["plant-1", "animal-1", "hobby-1", "vehicle-1", "building-1"].map((id) => join(SHEETS_DIR, `${id}.png`));

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? "medium";
const SIZE = "1536x1024"; // 横長。5マスなら1マスは300px ほどで、96px の絵には十分
const API_URL = "https://api.openai.com/v1/images/edits"; // 見本の画像を添えて頼むので edits
const RETRIES = 2;

/** 環境変数か .env.local から API キーを読む */
function apiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = join(ROOT, ".env.local");
  if (existsSync(envFile)) {
    const m = /^OPENAI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(readFileSync(envFile, "utf8"));
    if (m) return m[1].trim();
  }
  throw new Error("OPENAI_API_KEY がありません。.env.local に OPENAI_API_KEY=sk-... と書くか、環境変数で渡してください");
}

function referenceImages(): string[] {
  if (existsSync(STYLE_REFERENCE)) return [STYLE_REFERENCE];
  const found = FALLBACK_REFERENCES.filter((f) => existsSync(f));
  if (found.length === 0) throw new Error("見本の画像がありません(art/chizu-tane/style-reference.png か sheets/plant-1.png など)");
  return found;
}

async function generate(sheet: Sheet, key: string, references: string[]): Promise<Buffer> {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt(sheet));
  form.append("size", SIZE);
  form.append("quality", QUALITY);
  form.append("background", "transparent");
  form.append("output_format", "png");
  form.append("n", "1");
  for (const file of references) form.append("image[]", new Blob([readFileSync(file)], { type: "image/png" }), basename(file));

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const body = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (res.ok && body.data?.[0]?.b64_json) return Buffer.from(body.data[0].b64_json, "base64");
    const message = body.error?.message ?? `HTTP ${res.status}`;
    // 混んでいる・一時的な失敗だけやり直す(頼む文が断られたときなどはやり直さない)
    if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
      console.warn(`  やり直します(${message})`);
      await new Promise((r) => setTimeout(r, 20_000 * (attempt + 1)));
      continue;
    }
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const sheets = selectSheets(args).filter((s) => {
    if (force || !isPlaced(s)) return true;
    console.log(`${s.id}: シートはもう置いてあるので飛ばします(作り直すときは --force)`);
    return false;
  });
  if (sheets.length === 0) {
    console.log("頼むシートがありません");
    return;
  }
  const references = referenceImages();
  console.log(`${sheets.length} シートを頼みます(${MODEL}・${QUALITY}・${SIZE})。見本: ${references.map((f) => basename(f)).join("、")}`);
  if (dryRun) {
    for (const s of sheets) console.log(`\n==== ${s.id}\n${prompt(s)}`);
    return;
  }

  const key = apiKey();
  const made: string[] = [];
  for (const sheet of sheets) {
    console.log(`\n${sheet.id}（${sheetLabel(sheet)}）を頼んでいます…(1〜2分かかります)`);
    try {
      const png = await generate(sheet, key, references);
      writeFileSync(join(SHEETS_DIR, `${sheet.id}.png`), png);
      console.log(`  art/chizu-tane/sheets/${sheet.id}.png に保存しました`);
      made.push(sheet.id);
    } catch (e) {
      console.error(`  ! ${sheet.id}: うまくいきませんでした: ${(e as Error).message}`);
    }
  }
  if (made.length === 0) return;

  // できたシートを切り分ける(public/chizu-tane/items/ と itemImages.generated.ts ができる)
  console.log("\n切り分けます");
  spawnSync("npx", ["tsx", join(ROOT, "scripts/chizu-tane/process-item-images.mts"), ...made], { stdio: "inherit", shell: true, cwd: ROOT });
}

await main();
