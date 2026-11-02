"use client";

import type { CSSProperties, ReactNode } from "react";
import { useDisplaySize } from "@/lib/displaySize";

// うさぽ農園のカード(あなたの畑・集めたもの・公式の畑・棚・ガーデンの持っているもの・タネを選ぶところ・フォロワー・見に行けるガーデン・手伝いの畑)の並べ方を揃える部品。
// 列の数は設定の「表示の大きさ」で 3・2・1 列(src/lib/displaySizes.ts の cardColumns)。
// 3列は絵が上で文字が下の縦長、2列は絵が左で名前・数・説明が右、1列は 絵・名前と数・説明(右端に寄せる)の3つに分けた横長にして、間延びしないようにする。
// 情報の多いカード(手伝いの畑)は、カードには短く出して、タップしたら下に詳しく出す

/** いまの表示の大きさの、カードの列の数と、スワイプ1ページの段の数 */
export function useCardLayout(): { columns: number; rows: number; perPage: number; wide: boolean } {
  const { cardColumns, cardRows } = useDisplaySize();
  return { columns: cardColumns, rows: cardRows, perPage: cardColumns * cardRows, wide: cardColumns <= 2 };
}

/** スワイプしないで並べるときの、カードのます目 */
export function CardGrid({ children, as = "div" }: { children: ReactNode; as?: "div" | "ul" }) {
  const { columns } = useCardLayout();
  const Tag = as;
  return (
    <Tag className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {children}
    </Tag>
  );
}

/** 名前を lines 行で切る(reserve なら、短くてもその行数ぶんの高さを取る)。leading-tight は 1.25 なので、1行は 1.25em */
function clampStyle(lines: number | undefined, reserve: boolean): CSSProperties | undefined {
  if (!lines) return undefined;
  return {
    ...(reserve ? { minHeight: `${lines * 1.25}em` } : {}),
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

/**
 * カードの中身。icon は絵、title は名前、children は名前のすぐ下の行(数など)、note は説明(状態・ボタンなど。1列のときは右端に出す)、
 * corner は右上に重ねるもの(🌰 など)。titleLines を渡すと、名前がそれより長ければその行数で切り、2列のときはその行数ぶんの高さも取る(名前の長さでカードの見た目がそろわないとき)。noteBeside なら 2列のとき、名前の下の行の数の右に note を出す(棚のボタンなど)。
 * 外側の枠(白い背景・ボタン・リンク)は呼ぶ側で付ける(枠に relative を付ける)
 */
export function CardBody({
  icon,
  title,
  children,
  note,
  noteBeside = false,
  titleLines,
  corner,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  noteBeside?: boolean;
  titleLines?: number;
  corner?: ReactNode;
}) {
  const { wide, columns } = useCardLayout();
  const cornerNode = corner && <span className="absolute top-1 right-1.5 text-xs">{corner}</span>;
  if (columns === 1) {
    // 1列: 絵・名前と数・説明の3つに分け、説明は右端に寄せる。絵の幅をそろえて名前の位置をそろえる
    return (
      <span className="flex items-center gap-3 text-left">
        {cornerNode}
        <span className="shrink-0 min-w-16 flex items-center justify-center">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-[#3c2a14] leading-tight" style={clampStyle(titleLines, false)}>
            {title}
          </span>
          {children}
        </span>
        {note && <span className="shrink-0 max-w-[45%] text-right pr-4">{note}</span>}
      </span>
    );
  }
  if (wide && noteBeside && note) {
    // 2列で説明を横に出すとき: 絵が左、右に名前を1行使い、その下の行に数と説明(ボタン)を左右に並べる(名前が折り返さないように)
    return (
      <span className="flex items-center gap-2 text-left">
        {cornerNode}
        <span className="shrink-0 flex items-center justify-center">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-[#3c2a14] leading-tight">{title}</span>
          <span className="flex items-center gap-1">
            <span className="flex-1 min-w-0">{children}</span>
            <span className="shrink-0">{note}</span>
          </span>
        </span>
      </span>
    );
  }
  if (wide) {
    // 2列: 絵が左、名前と説明は右に縦に並べる(幅が狭いので絵の大きさのまま)
    return (
      <span className="flex items-center gap-2 text-left">
        {cornerNode}
        <span className="shrink-0 flex items-center justify-center">{icon}</span>
        <span className="flex-1 min-w-0 pr-4">
          <span
            className="block text-sm font-bold text-[#3c2a14] leading-tight"
            style={clampStyle(titleLines, true)}
          >
            {title}
          </span>
          {children}
          {note}
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-center text-center">
      {cornerNode}
      <span className="min-h-10 flex items-center justify-center">{icon}</span>
      <span className="block w-full text-xs font-bold text-[#3c2a14] leading-tight mt-1 line-clamp-2">{title}</span>
      {children}
      {note}
    </span>
  );
}
