import Link from "next/link";

// 管理のトップ。管理用のページを足したら ADMIN_LINKS に1行足す
const ADMIN_LINKS: { section: string; links: { href: string; label: string; description: string }[] }[] = [
  {
    section: "🌱 うさぽ農園",
    links: [
      {
        href: "/admin/chizu-tane/items",
        label: "アイテム一覧",
        description: "コース・タネの種類・アイテムの定義と、実とタネの絵（courses.ts）",
      },
    ],
  },
];

export default function AdminPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-6 text-[#3c2a14]">
      <h1 className="text-xl font-bold mb-1">管理</h1>
      <p className="text-xs text-[#78716c] mb-6">開発・運営用のページです（どこからもリンクしていません）</p>
      {ADMIN_LINKS.map((group) => (
        <section key={group.section} className="mb-6">
          <h2 className="text-sm font-bold text-[#a8937a] mb-2">{group.section}</h2>
          <ul className="space-y-2">
            {group.links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(120,90,40,0.06)] hover:shadow-[0_4px_16px_rgba(120,90,40,0.12)] transition"
                >
                  <span className="font-bold text-sm">{link.label}</span>
                  <span className="block text-xs text-[#78716c] mt-0.5">{link.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
