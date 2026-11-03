import { Suspense } from "react";
import LocalCollectionView from "@/components/game/chizu-tane/LocalCollectionView";

export default function ChizuTaneLocalCollectionPage() {
  // ?pref= と ?mode=secret を useSearchParams で読むので Suspense で包む
  return (
    <Suspense>
      <LocalCollectionView />
    </Suspense>
  );
}
