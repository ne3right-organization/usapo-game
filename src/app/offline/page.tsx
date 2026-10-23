import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "オフライン",
};

// サービスワーカー(public/sw.js)が、通信できないときにページ遷移の代わりに出す画面
export default function OfflinePage() {
  return (
    <main className="min-h-full bg-[#fdf8f0]">
      <div className="max-w-lg mx-auto px-4 pt-16 pb-16 text-center">
        <div className="text-5xl mb-4">📡</div>
        <h1 className="text-lg font-bold text-[#3c2a14] mb-2">インターネットにつながっていません</h1>
        <p className="text-sm text-[#78716c] leading-relaxed mb-6">
          地図のデータや記録はインターネット経由で読み込むため、オフラインでは遊べません。
          <br />
          つながったら、もう一度開いてください。
        </p>
        {/* Link のクライアント遷移ではなく、ページを丸ごと読み直してつながったか確かめる */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/"className="inline-block px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-teal-700">
          もう一度読み込む
        </a>
      </div>
    </main>
  );
}
