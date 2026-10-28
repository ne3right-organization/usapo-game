"use client";

import { currentUser } from "@/lib/auth";
import { data, unwrap, type Schema } from "@/lib/amplify/data";
import type { TaneCourse } from "@/lib/game/chizuTane/courses";
import type { GardenObject } from "@/lib/game/chizuTane/garden";
import {
  findTownDistrict,
  municipalityCandidates,
  townDistrictUrl,
  type MunicipalityBounds,
  type TownDistrict,
  type TownDistrictFeature,
} from "@/lib/game/chizuTane/geo";

// 地図タネのデータアクセス。書き込み(始める・タネをまく・チェックイン・タネニワの保存)はすべて Lambda の
// カスタムミューテーションで、所持数・1地区1つ・1日1回などはサーバーで確かめる。モデルはクライアントからは読むだけ

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

export type TanePlayer = Schema["GameTanePlayer"]["type"];
export type TaneBase = Schema["GameTaneBase"]["type"];
export type TaneOwnedItem = Schema["GameTaneItem"]["type"];

async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error("認証が必要です。ログインしてください");
  return user.id;
}

/** a.json の値は二重に文字列化されて返ることがあるので、文字列である限り戻し続ける */
function parseJson<T>(value: unknown): T {
  let v = value;
  while (typeof v === "string") v = JSON.parse(v);
  return v as T;
}

/** まだ始めていなければ null */
export async function fetchTanePlayer(): Promise<TanePlayer | null> {
  const userId = await requireUserId();
  return unwrap(await data.models.GameTanePlayer.get({ userId }));
}

export async function startTane(course: TaneCourse): Promise<TanePlayer> {
  await requireUserId();
  const player = unwrap(await data.mutations.startTane({ course }));
  if (!player) throw new Error("始められませんでした");
  return player;
}

/** 自分がまいたタネ(新しい順) */
export async function fetchMyBases(): Promise<TaneBase[]> {
  const ownerId = await requireUserId();
  const bases: TaneBase[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneBase.listTaneBasesByOwner({ ownerId }, { sortDirection: "DESC", nextToken });
    bases.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return bases;
}

/** その市区町村にあるタネ */
export async function fetchBasesInCity(prefCode: string, cityCode: string): Promise<TaneBase[]> {
  await requireUserId();
  const bases: TaneBase[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneBase.listTaneBasesByCity({ cityKey: `${prefCode}${cityCode}` }, { nextToken });
    bases.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return bases;
}

export async function fetchMyItems(): Promise<TaneOwnedItem[]> {
  const userId = await requireUserId();
  const items: TaneOwnedItem[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneItem.list({ userId, nextToken });
    items.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

// ─── いまいる地区 ─────────────────────────────────────────────────────────

export interface Location {
  lng: number;
  lat: number;
}

let boundsPromise: Promise<MunicipalityBounds[]> | null = null;
const townPromises = new Map<string, Promise<TownDistrictFeature[] | null>>();

function fetchBounds(): Promise<MunicipalityBounds[]> {
  boundsPromise ??= fetch("/chizu-tane/municipality-bounds.json").then((res) => {
    if (!res.ok) throw new Error(`市区町村の範囲を読み込めませんでした (${res.status})`);
    return res.json() as Promise<MunicipalityBounds[]>;
  });
  boundsPromise.catch(() => (boundsPromise = null));
  return boundsPromise;
}

/** 町丁の geojson。同じ画面の中では読み直さない */
export function fetchTownDistrictFeatures(prefCode: string, cityCode: string): Promise<TownDistrictFeature[] | null> {
  const url = townDistrictUrl(CLOUDFRONT_URL, prefCode, cityCode);
  let p = townPromises.get(url);
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (res.ok) return ((await res.json()) as { features: TownDistrictFeature[] }).features;
      if (res.status === 403 || res.status === 404) return null; // CloudFront(S3)は無いファイルに 403 を返す
      throw new Error(`地区の地図を読み込めませんでした (${res.status})`);
    });
    townPromises.set(url, p);
    p.catch(() => townPromises.delete(url));
  }
  return p;
}

export function townDistrictGeojsonUrl(prefCode: string, cityCode: string): string {
  return townDistrictUrl(CLOUDFRONT_URL, prefCode, cityCode);
}

/**
 * 位置から地区を判定する。全国の市区町村の geojson は重いので、市区町村ごとの範囲の一覧
 * (public/chizu-tane/municipality-bounds.json)で候補を絞り、その町丁の geojson だけを読む。どこにも入らなければ null
 */
export async function locateTownDistrict(loc: Location): Promise<TownDistrict | null> {
  const candidates = municipalityCandidates(await fetchBounds(), loc.lng, loc.lat);
  for (const { prefCode, cityCode } of candidates) {
    const features = await fetchTownDistrictFeatures(prefCode, cityCode);
    const district = features ? findTownDistrict(features, loc.lng, loc.lat) : null;
    if (district) return district;
  }
  return null;
}

/** ブラウザの位置情報。許可されなかったときなどは、理由が分かるメッセージで例外にする */
export function getCurrentLocation(): Promise<Location> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("このブラウザでは位置情報が使えません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error("位置情報の利用が許可されていません。ブラウザの設定で、このサイトに位置情報の利用を許可してください"));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error("現在地を取得できませんでした（時間切れ）。屋外や窓の近くでもう一度試してください"));
        } else {
          reject(new Error("現在地を取得できませんでした。もう一度試してください"));
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

export async function placeBase(loc: Location, district: TownDistrict): Promise<TaneBase> {
  await requireUserId();
  const base = unwrap(
    await data.mutations.placeTaneBase({ lng: loc.lng, lat: loc.lat, prefCode: district.prefCode, cityCode: district.cityCode })
  );
  if (!base) throw new Error("タネをまけませんでした");
  return base;
}

export interface CheckInResult {
  status: "received" | "already" | "own";
  townName: string;
  baseTypeId: string;
  itemId: string | null;
  quantity: number | null;
}

export async function checkIn(loc: Location, district: TownDistrict): Promise<CheckInResult> {
  await requireUserId();
  const res = unwrap(
    await data.mutations.checkInTaneBase({ lng: loc.lng, lat: loc.lat, prefCode: district.prefCode, cityCode: district.cityCode })
  );
  if (!res) throw new Error("チェックインできませんでした");
  return { ...res, status: res.status as CheckInResult["status"], itemId: res.itemId ?? null, quantity: res.quantity ?? null };
}

// ─── タネニワ ─────────────────────────────────────────────────────────────

export interface GardenState {
  width: number;
  height: number;
  objects: GardenObject[];
  items: { itemId: string; quantity: number }[];
}

function toGardenState(res: Schema["TaneGardenState"]["type"] | null | undefined): GardenState {
  if (!res) throw new Error("タネニワを読み込めませんでした");
  return {
    width: res.width,
    height: res.height,
    objects: parseJson<GardenObject[]>(res.objects),
    items: parseJson<{ itemId: string; quantity: number }[]>(res.items),
  };
}

export async function openGarden(): Promise<GardenState> {
  await requireUserId();
  return toGardenState(unwrap(await data.mutations.openTaneGarden()));
}

export async function saveGarden(objects: GardenObject[]): Promise<GardenState> {
  await requireUserId();
  return toGardenState(unwrap(await data.mutations.saveTaneGarden({ objects: JSON.stringify(objects) })));
}

/** 開発用の位置指定を出してよい環境か(dev 環境と手元だけ。本番では出さない) */
export function isLocationOverrideAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "devgame.usapo.net";
}
