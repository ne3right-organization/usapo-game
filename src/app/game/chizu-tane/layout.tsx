import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "うさぽ農園",
  description: "街の地区にまかれたタネを訪ねて分けてもらい、育てて収穫する位置情報ゲーム",
};

export default function ChizuTaneLayout({ children }: { children: React.ReactNode }) {
  return children;
}
