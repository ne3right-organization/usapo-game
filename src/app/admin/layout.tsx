import type { Metadata } from "next";

// 管理用のページ(/admin 以下)。どこからもリンクせず、検索にも載せない。
// 今は公開して困る情報を出していない(定義の一覧など)のでログインの確認はしていない。利用者のデータを出すページを足すときは認可を考えること
export const metadata: Metadata = {
  title: { default: "管理", template: "%s（管理）" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
