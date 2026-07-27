import { NextResponse } from "next/server";
import { ALL_PREF_CODES, fetchMunicipalities } from "@/lib/game/zukanQuizData";

// 図鑑画面の「都道府県別コンプリート率」表示用。分母(都道府県ごとの市区町村総数)を返す。
// CloudFrontのgeojsonから毎回47件フェッチするのはクライアント側では重いため、
// サーバー側(fetch自体はNext.jsのData Cacheでキャッシュ済み)でまとめて集計して返す。
export async function GET() {
  const results = await Promise.all(
    ALL_PREF_CODES.map(async (prefCode) => {
      const municipalities = await fetchMunicipalities(prefCode);
      return {
        prefCode,
        prefName: municipalities[0]?.prefName ?? prefCode,
        total: municipalities.length,
      };
    })
  );

  return NextResponse.json(results);
}
