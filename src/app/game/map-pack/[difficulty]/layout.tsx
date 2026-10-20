import type { Metadata } from "next";

const TITLES: Record<string, string> = {
  beginner: "地図ポットン | 都道府県ポットン - 全国",
  intermediate: "地図ポットン | 自治体ポットン",
  advanced: "地図ポットン | ご近所ポットン",
};

// エリア名(選択後にクライアント側で決まる)まではここでは分からないため、難易度から分かる範囲の固定タイトルにする
export async function generateMetadata({
  params,
}: {
  params: Promise<{ difficulty: string }>;
}): Promise<Metadata> {
  const { difficulty } = await params;
  return { title: TITLES[difficulty] ?? "地図ポットン" };
}

export default function DifficultyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
