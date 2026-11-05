import type { Metadata } from "next";
import FieldStatusView from "./FieldStatusView";

// 管理: 遊んでいる人と畑の状況(ゲームが進んでいるかの確認用)
export const metadata: Metadata = {
  title: "うさぽ農園 遊んでいる人と畑",
};

export default function ChizuTaneFieldStatusPage() {
  return <FieldStatusView />;
}
