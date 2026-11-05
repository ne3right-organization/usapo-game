import type { Metadata } from "next";
import AdminGate from "@/components/admin/AdminGate";

// 管理用のページ(/admin 以下)。どこからもリンクせず、検索にも載せない。
// ログインしていて Cognito の admin グループに入っている人だけが見られる(AdminGate)。
// 利用者のデータを出すときは、admin グループだけが呼べる API から読むこと(画面の出し分けだけでは守れない)
export const metadata: Metadata = {
  title: { default: "管理", template: "%s（管理）" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
