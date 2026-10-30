"use client";

import { use } from "react";
import FriendGardenView from "@/components/game/chizu-tane/FriendGardenView";

type Props = { params: Promise<{ userId: string }> };

export default function FriendGardenPage({ params }: Props) {
  const { userId } = use(params);
  return <FriendGardenView userId={userId} />;
}
