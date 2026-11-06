"use client";

import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import { asSeedLook } from "@/lib/game/chizuTane/mysteryItems";
import type { TaneSeedCount } from "@/lib/game/chizuTaneData";
import SwipePages from "./SwipePages";
import { CardBody, useCardLayout } from "./TaneCards";
import { SeedIcon } from "./TaneParts";

/** まくタネを選ぶ。カードをます目(ふつうは 3×3、1列は4段。表示の大きさで変わる。TaneCards)に並べ、左右のスワイプでめくる。選んでいるタネのページを最初に開く */
export default function SeedPicker({
  seeds,
  chosenItemId,
  onChoose,
  disabled,
}: {
  seeds: TaneSeedCount[];
  chosenItemId: string | null;
  onChoose: (itemId: string) => void;
  disabled?: boolean;
}) {
  const cards = useCardLayout();
  return (
    <div className="mb-3">
      <SwipePages
        items={seeds}
        perPage={cards.perPage}
        columns={cards.columns}
        layout="grid"
        keyOf={(sd) => sd.itemId}
        initialIndex={Math.max(0, seeds.findIndex((s) => s.itemId === chosenItemId))}
        render={(sd) => {
          const item = TANE_ITEM_BY_ID.get(sd.itemId);
          const type = item ? TANE_BASE_TYPE_BY_ID.get(item.baseTypeId) : undefined;
          const active = chosenItemId === sd.itemId;
          return (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChoose(sd.itemId)}
              aria-pressed={active}
              className={`relative w-full h-full rounded-xl border-2 px-1 pt-2 pb-1.5 text-center ${
                active ? "border-emerald-500 bg-emerald-50" : "border-[#f3ece0] bg-white"
              } disabled:opacity-50`}
            >
              <CardBody
                icon={item ? <SeedIcon item={item} size={44} /> : null}
                title={item ? asSeedLook(item).name : sd.itemId}
                note={type && <span className="block text-3xs text-[#a8937a] leading-tight">{type.name}になる</span>}
              >
                <span className="block text-2xs text-emerald-700">×{sd.quantity}</span>
              </CardBody>
            </button>
          );
        }}
      />
    </div>
  );
}
