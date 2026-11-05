import Link from "next/link";

// 管理のトップ。管理用のページを足したら ADMIN_LINKS に1行足す
const ADMIN_LINKS: { section: string; links: { href: string; label: string; description: string }[] }[] = [
  {
    section: "🌱 うさぽ農園",
    links: [
      {
        href: "/admin/chizu-tane/items",
        label: "アイテム一覧",
        description: "コース・タネの種類・アイテムの定義と、実とタネの絵（courses.ts）。ご当地のもののたたき台（localItems.ts）",
      },
      {
        href: "/admin/chizu-tane/levels",
        label: "レベルとガーデンの条件",
        description: "ユーザーのレベルアップの条件・もらえるタネ・家と柵、ガーデンが増える条件、畑のランク",
      },
      {
        href: "/admin/chizu-tane/fields",
        label: "遊んでいる人と畑",
        description: "遊んでいる人ごとのレベル・畑の数・たずねた数・手伝い・収穫・最後に動いた日時と、その人の畑（状態・最後の水・次に起きること）",
      },
      {
        href: "/admin/chizu-tane/local",
        label: "ご当地の実の状況",
        description: "ご当地の畑（持ち主・実の数・市場に並ぶ日・枯れる日）、市場に並んでいる実、ご当地のタネをもらった記録、ご当地の実を集めた人の数",
      },
      {
        href: "/admin/chizu-tane/gardens",
        label: "ガーデンのデザイン",
        description: "ガーデン4種類 × 家と柵の4段階の見た目",
      },
    ],
  },
];

export default function AdminPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-6 text-[#3c2a14]">
      <h1 className="text-xl font-bold mb-1">管理</h1>
      <p className="text-xs text-[#78716c] mb-6">開発・運営用のページです（どこからもリンクしていません。Cognito の admin グループの人だけが見られます）</p>
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
