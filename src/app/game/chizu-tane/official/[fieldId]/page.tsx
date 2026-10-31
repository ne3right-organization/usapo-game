"use client";

import { use } from "react";
import OfficialFieldView from "@/components/game/chizu-tane/OfficialFieldView";

type Props = { params: Promise<{ fieldId: string }> };

export default function OfficialFieldPage({ params }: Props) {
  const { fieldId } = use(params);
  return <OfficialFieldView fieldId={fieldId} />;
}
