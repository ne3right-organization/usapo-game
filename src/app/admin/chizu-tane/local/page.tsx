import type { Metadata } from "next";
import LocalStatusView from "./LocalStatusView";

// 管理: ご当地の実の状況。ご当地の畑・市場に並んでいる実・ご当地のタネをもらった記録・ご当地の実を持っている人の数
export const metadata: Metadata = {
  title: "うさぽ農園 ご当地の実の状況",
};

export default function ChizuTaneLocalStatusPage() {
  return <LocalStatusView />;
}
