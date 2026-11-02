import Link from "next/link";
import { TANE_NEWS } from "@/lib/game/chizuTane/news";
import { TaneHeading, TaneScreen } from "./TaneParts";

// お知らせの一覧(/game/chizu-tane/news)。トップのお知らせの「前のお知らせを見る」から開く。中身は src/lib/game/chizuTane/news.ts
export default function NewsView() {
  return (
    <TaneScreen>
      <TaneHeading title="📢 お知らせ" />
      <ul className="space-y-2">
        {TANE_NEWS.map((n) => (
          <li key={`${n.date}-${n.text}`} className="bg-white rounded-2xl px-4 py-3">
            <p className="text-2xs text-[#a8937a] mb-1">{n.date.replaceAll("-", "/")}</p>
            <p className="text-sm text-[#3c2a14] leading-relaxed">{n.text}</p>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm mt-6">
        <Link href="/game/chizu-tane" className="text-emerald-700 underline underline-offset-2">
          ← ホームにもどる
        </Link>
      </p>
    </TaneScreen>
  );
}
