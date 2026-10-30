"use client";

import { TANE_BASE_TYPE_BY_ID, TANE_ITEM_BY_ID } from "@/lib/game/chizuTane/courses";
import type { TaneSeedCount } from "@/lib/game/chizuTaneData";
import SwipePages from "./SwipePages";
import { SeedIcon } from "./TaneParts";

/** まくタネを選ぶ。3つずつ横に並べ、左右のスワイプでめくる。選んでいるタネのページを最初に開く */
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
  return (
    <div className="mb-3">
      <SwipePages
        items={seeds}
        perPage={3}
        layout="cols"
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
              className={`w-full h-full flex flex-col items-center rounded-xl border-2 px-1 pt-2 pb-1.5 text-center ${
                active ? "border-emerald-500 bg-emerald-50" : "border-[#f3ece0] bg-white"
              } disabled:opacity-50`}
            >
              {item ? <SeedIcon item={item} size={44} /> : null}
              <span className="mt-1 text-xs font-bold text-[#3c2a14] leading-tight">{item?.name ?? sd.itemId}</span>
              {type && <span className="text-[10px] text-[#a8937a] leading-tight">{type.name}になる</span>}
              <span className="text-[11px] text-emerald-700">×{sd.quantity}</span>
            </button>
          );
        }}
      />
    </div>
  );
}
