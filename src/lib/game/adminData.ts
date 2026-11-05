"use client";

import { data, unwrap } from "@/lib/amplify/data";

// 管理画面(/admin)のデータ。どれも Cognito の admin グループの人だけが呼べる API

export interface AdminUser {
  userId: string;
  nickname: string;
}

/** ご当地の実の状況(chizu-tane-admin の adminTaneLocalStatus) */
export interface AdminLocalStatus {
  generatedAt: string;
  fields: {
    areaKey: string;
    place: string;
    itemId: string;
    owner: AdminUser;
    plantedAt: string;
    water: number;
    fruits: number;
    ripenedAt: string | null;
    lastWateredAt: string | null;
  }[];
  market: { itemId: string; localRank: number; producer: AdminUser; leftover: number; updatedAt: string }[];
  grants: { user: AdminUser; prefCode: string; course: string; firstAt: string; secondAt: string | null; thirdAt: string | null }[];
  holders: { itemId: string; collectors: number; quantity: number }[];
}

export async function fetchAdminLocalStatus(): Promise<AdminLocalStatus> {
  let value: unknown = unwrap(await data.queries.adminTaneLocalStatus());
  // AppSync で二重に文字列化されて返ることがあるので、文字列である限り戻す
  while (typeof value === "string") value = JSON.parse(value);
  if (!value) throw new Error("読み込めませんでした");
  return value as AdminLocalStatus;
}

/** 遊んでいる人と畑の状況(chizu-tane-admin の adminTaneFieldStatus) */
export interface AdminFieldStatus {
  generatedAt: string;
  players: {
    userId: string;
    nickname: string;
    course: string;
    level: number;
    visits: number;
    official: number;
    helps: number;
    harvests: number;
    opened: number;
    lastMovedAt: string | null;
    startedAt: string;
  }[];
  fields: {
    areaKey: string;
    ownerId: string;
    place: string;
    baseTypeId: string;
    seedItemId: string;
    rank: number;
    water: number;
    fruits: number;
    plantedAt: string;
    ripenedAt: string | null;
    waitingSince: string | null;
    lastWateredAt: string | null;
  }[];
}

export async function fetchAdminFieldStatus(): Promise<AdminFieldStatus> {
  let value: unknown = unwrap(await data.queries.adminTaneFieldStatus({ fields: true }));
  while (typeof value === "string") value = JSON.parse(value);
  if (!value) throw new Error("読み込めませんでした");
  return value as AdminFieldStatus;
}
