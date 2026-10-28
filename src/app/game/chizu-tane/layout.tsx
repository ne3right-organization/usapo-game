import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "地図タネ",
  description: "街の地区にまかれたタネを訪ねて分けてもらい、育てて収穫する位置情報ゲーム（プロトタイプ）",
};

export default function ChizuTaneLayout({ children }: { children: React.ReactNode }) {
  return children;
}
