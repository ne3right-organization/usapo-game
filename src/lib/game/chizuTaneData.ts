"use client";

import { currentUser } from "@/lib/auth";
import { data, unwrap, type Schema } from "@/lib/amplify/data";
import type { TaneCourse } from "@/lib/game/chizuTane/courses";
import type { GardenDesignId, GardenLayouts, GardenObject } from "@/lib/game/chizuTane/garden";
import { isAbandoned } from "@/lib/game/chizuTane/growth";
import {
  DAY_MS_DEV,
  DAY_MS_PRODUCTION,
  findTownDistrict,
  municipalityCandidates,
  townDistrictUrl,
  type MunicipalityBounds,
  type TownDistrict,
  type TownDistrictFeature,
} from "@/lib/game/chizuTane/geo";

// 地図タネのデータアクセス。書き込み(始める・タネをまく・チェックイン・ガーデンの保存)はすべて Lambda の
// カスタムミューテーションで、所持数・1地区1つ・1日1回などはサーバーで確かめる。モデルはクライアントからは読むだけ

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

export type TanePlayer = Schema["GameTanePlayer"]["type"];
export type TaneBase = Schema["GameTaneBase"]["type"];
export type TaneOwnedItem = Schema["GameTaneItem"]["type"];
export type TaneHarvest = Schema["GameTaneHarvest"]["type"];

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

/** コースごとの遊んでいる人数(始めた人の数)。読めなかったら空 */
export async function fetchCourseCounts(): Promise<Map<string, number>> {
  await requireUserId();
  const rows = unwrap(await data.queries.taneCourseCounts()) ?? [];
  return new Map(rows.filter((r) => r != null).map((r) => [r.course, r.players]));
}

type TaneOwnership = Schema["GameTaneOwnership"]["type"];

/** 自分の持ち主の行を全部(空き地に戻って手放した地区も含む) */
async function fetchMyOwnerships(): Promise<TaneOwnership[]> {
  const ownerId = await requireUserId();
  const rows: TaneOwnership[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneOwnership.list({ ownerId, nextToken });
    rows.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return rows;
}

/** 自分がまいたタネの地区(areaKey)。タネの行には持ち主を持たないので、本人しか読めない GameTaneOwnership から引く。手放した地区は除く */
export async function fetchMyAreaKeys(): Promise<Set<string>> {
  return new Set((await fetchMyOwnerships()).filter((o) => !o.releasedAt).map((o) => o.areaKey));
}

/** まいたことのあるタネ(まき直す前のものも含む)。レベルの条件「今のレベルのタネを3つともまいたか」に使う(Lambda の plantedItemIds と同じ) */
export async function fetchMyPlantedItemIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const o of await fetchMyOwnerships()) {
    ids.add(o.seedItemId);
    for (const past of o.pastSeedItemIds ?? []) if (past) ids.add(past);
  }
  return ids;
}

/** 自分がまいたタネ(新しい順)。タネ待ちのまま空き地に戻ったものは除く */
export async function fetchMyBases(): Promise<TaneBase[]> {
  const keys = await fetchMyAreaKeys();
  const now = new Date();
  const bases: TaneBase[] = [];
  await Promise.all(
    [...keys].map(async (areaKey) => {
      const b = unwrap(await data.models.GameTaneBase.get({ areaKey }));
      if (b && !isAbandoned(b, now, taneDayMs())) bases.push(b);
    })
  );
  return bases.sort((a, b) => b.plantedAt.localeCompare(a.plantedAt));
}

/** タネ待ちのまま空き地に戻ったタネを除く(行は、次にだれかがまくまで残っている) */
function withoutAbandoned(bases: TaneBase[]): TaneBase[] {
  const now = new Date();
  return bases.filter((b) => !isAbandoned(b, now, taneDayMs()));
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
  return withoutAbandoned(bases);
}

/**
 * 全国のタネ(全国農地用)。試作の規模なので全件を読む。遊ぶ人が増えたら、都道府県・市区町村ごとの数をまとめた行を持つなどに変える
 */
export async function fetchAllBases(): Promise<TaneBase[]> {
  await requireUserId();
  const bases: TaneBase[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneBase.list({ limit: 1000, nextToken });
    bases.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return withoutAbandoned(bases);
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

/** 収穫の記録(実1個ごと)。新しい順 */
export async function fetchMyHarvests(): Promise<TaneHarvest[]> {
  const userId = await requireUserId();
  const harvests: TaneHarvest[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneHarvest.list({ userId, nextToken, sortDirection: "DESC" });
    harvests.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);
  return harvests;
}

/** 生産者(タネをまいた人)の見え方: 自分 / 農園を見せてくれている人(ニックネームを出す) / それ以外(出さない) */
export type TaneOwnerView = { kind: "me" } | { kind: "shared"; userId: string; nickname: string } | { kind: "hidden" };

/**
 * 生産者を、その人が自分に農園を見せてくれていて(GameTaneShare)、自分がその人をフォローしている間だけ明かす。
 * パズルのランキングなどからフォローされただけでは、畑の場所(生活圏)が分からないように、はじめは誰にも見せない
 */
export async function fetchOwnerViews(ownerIds: string[]): Promise<Map<string, TaneOwnerView>> {
  const me = await requireUserId();
  const views = new Map<string, TaneOwnerView>();
  await Promise.all(
    [...new Set(ownerIds)].map(async (ownerId) => {
      if (ownerId === me) return views.set(ownerId, { kind: "me" });
      const [share, following] = await Promise.all([
        data.models.GameTaneShare.get({ ownerId, viewerId: me }),
        data.models.GameFollow.get({ followerId: me, followeeId: ownerId }),
      ]);
      const nickname =
        unwrap(share) && unwrap(following) ? unwrap(await data.models.GameProfile.get({ userId: ownerId }))?.nickname : null;
      views.set(ownerId, nickname ? { kind: "shared", userId: ownerId, nickname } : { kind: "hidden" });
    })
  );
  return views;
}

/** 自分が農園を見せているフォロワーの ID */
export async function fetchTaneShareViewerIds(): Promise<Set<string>> {
  const ownerId = await requireUserId();
  const ids = new Set<string>();
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneShare.list({ ownerId, nextToken });
    for (const s of unwrap(page)) ids.add(s.viewerId);
    nextToken = page.nextToken;
  } while (nextToken);
  return ids;
}

/** そのフォロワーに農園を見せる・見せない */
export async function setTaneShare(viewerId: string, share: boolean): Promise<void> {
  const ownerId = await requireUserId();
  if (share) {
    if (unwrap(await data.models.GameTaneShare.get({ ownerId, viewerId }))) return;
    unwrap(await data.models.GameTaneShare.create({ ownerId, viewerId }));
  } else {
    await data.models.GameTaneShare.delete({ ownerId, viewerId });
  }
}

/** 持っているタネ(もの単位。みかんの木のタネ、梨の木のタネ…) */
export interface TaneSeedCount {
  itemId: string;
  quantity: number;
}

/** 持っているタネ(0個のものは除く) */
export async function fetchMySeeds(): Promise<TaneSeedCount[]> {
  const userId = await requireUserId();
  const seeds: TaneSeedCount[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneHeldSeed.list({ userId, nextToken });
    for (const s of unwrap(page)) if (s.quantity > 0) seeds.push({ itemId: s.itemId, quantity: s.quantity });
    nextToken = page.nextToken;
  } while (nextToken);
  return seeds;
}

/** ご当地のタネをもらった都道府県(都道府県コード)。1個目をもらった県だけ行がある */
export async function fetchMyLocalGrantPrefs(): Promise<Set<string>> {
  const userId = await requireUserId();
  const prefs = new Set<string>();
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneLocalGrant.list({ userId, nextToken });
    for (const g of unwrap(page)) prefs.add(g.prefCode);
    nextToken = page.nextToken;
  } while (nextToken);
  return prefs;
}

/** いまいる都道府県の1個目のご当地のタネをもらう(Lv.3 以上、1人1都道府県に1回)。もらったタネの itemId を返す */
export async function claimLocalSeed(loc: Location, district: TownDistrict): Promise<string> {
  await requireUserId();
  const itemId = unwrap(
    await data.mutations.claimLocalTaneSeed({ lng: loc.lng, lat: loc.lat, prefCode: district.prefCode, cityCode: district.cityCode })
  );
  if (!itemId) throw new Error("ご当地のタネをもらえませんでした");
  return itemId;
}

/** たずねた(もらったことのある)ほかの人のタネの数。レベルの条件の1つ(courses.ts の levelFor) */
export async function fetchVisitedCount(): Promise<number> {
  const userId = await requireUserId();
  let count = 0;
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneVisit.list({ userId, nextToken });
    count += unwrap(page).length;
    nextToken = page.nextToken;
  } while (nextToken);
  return count;
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

/** 持っているタネ(itemId)をまく。そのものの種類の拠点ができる(梨の木のタネ → 果樹園) */
export async function placeBase(loc: Location, district: TownDistrict, itemId: string): Promise<TaneBase> {
  await requireUserId();
  const base = unwrap(
    await data.mutations.placeTaneBase({
      lng: loc.lng,
      lat: loc.lat,
      prefCode: district.prefCode,
      cityCode: district.cityCode,
      itemId,
    })
  );
  if (!base) throw new Error("タネをまけませんでした");
  return base;
}

/** タネ待ちの自分の畑に、同じ種類の畑のタネ(itemId)をまき直す(遠くからでもよい)。まき直したあとのタネを返す */
export async function replantBase(areaKey: string, itemId: string): Promise<TaneBase> {
  await requireUserId();
  const base = unwrap(await data.mutations.replantTaneBase({ areaKey, itemId }));
  if (!base) throw new Error("タネをまき直せませんでした");
  return base;
}

export interface CheckInResult {
  /**
   * watered: 水をやった / ripened: 水をやって実った / fruit: 実をもらった / have: ご当地の実をもう持っているので、もらわなかった /
   * waiting: タネ待ちの畑 / already: この時間帯はもう来た
   */
  status: "watered" | "ripened" | "fruit" | "have" | "waiting" | "already";
  townName: string;
  baseTypeId: string;
  itemId: string | null;
  /** もらったあとに持っている数 */
  quantity: number | null;
  /** このチェックインでもらった実の数(1か0) */
  gainedItems: number | null;
  /** ほかの人のタネに初めて来た(拠点にタネが1個落ちた) */
  firstVisit: boolean;
  /** チェックインのあとのたまった水と、残っている実の数 */
  water: number;
  fruits: number;
  level: number | null;
  leveledUp: boolean;
  /** 増えたタネ。level: レベルが上がった / local: 自分のご当地の畑が実った・配り終えたので、次のご当地のタネが届いた */
  seedsGained: { itemId: string; count: number; reason: "level" | "local" }[];
  /** チェックインのあと、この拠点に落ちているタネの数 */
  droppedSeeds: number;
  /** チェックインのあとの育ちの段階(growth.ts) */
  stage: number | null;
  rank: number | null;
}

export async function checkIn(loc: Location, district: TownDistrict): Promise<CheckInResult> {
  await requireUserId();
  const res = unwrap(
    await data.mutations.checkInTaneBase({ lng: loc.lng, lat: loc.lat, prefCode: district.prefCode, cityCode: district.cityCode })
  );
  if (!res) throw new Error("チェックインできませんでした");
  return {
    status: res.status as CheckInResult["status"],
    townName: res.townName,
    baseTypeId: res.baseTypeId,
    itemId: res.itemId ?? null,
    quantity: res.quantity ?? null,
    gainedItems: res.gainedItems ?? null,
    firstVisit: res.firstVisit ?? false,
    water: res.water ?? 0,
    fruits: res.fruits ?? 0,
    level: res.level ?? null,
    leveledUp: res.leveledUp ?? false,
    seedsGained: parseJson<CheckInResult["seedsGained"] | null>(res.seedsGained) ?? [],
    droppedSeeds: res.droppedSeeds ?? 0,
    stage: res.stage ?? null,
    rank: res.rank ?? null,
  };
}

/** 自分のタネに遠くから水をやる(タネごとに朝・昼・夜に1回、効き目は現地の10分の1)。水をやったあとのタネを返す */
export async function waterRemotely(areaKey: string): Promise<TaneBase> {
  await requireUserId();
  const base = unwrap(await data.mutations.waterTaneBaseRemotely({ areaKey }));
  if (!base) throw new Error("水をやれませんでした");
  return base;
}

/** いまいる地区のタネに落ちているタネを count 個拾う(誰でも早い者勝ち)。拾えた数を返す(先を越されたら0) */
export async function pickUpSeeds(loc: Location, district: TownDistrict, count: number): Promise<number> {
  await requireUserId();
  return (
    unwrap(
      await data.mutations.pickUpTaneSeeds({
        lng: loc.lng,
        lat: loc.lat,
        prefCode: district.prefCode,
        cityCode: district.cityCode,
        count,
      })
    ) ?? 0
  );
}

// ─── ガーデン ─────────────────────────────────────────────────────────────

export interface GardenState {
  width: number;
  height: number;
  /** おうちの庭 */
  objects: GardenObject[];
  /** 開拓した地区の数で増えるほかのガーデン */
  layouts: GardenLayouts;
  items: { itemId: string; quantity: number }[];
  /** レベル(家と柵の見た目) */
  level: number;
  /** 開拓した地区の数(使えるガーデン) */
  plantedCount: number;
}

/** そのガーデンの配置 */
export function gardenObjectsOf(state: Pick<GardenState, "objects" | "layouts">, id: GardenDesignId): GardenObject[] {
  return id === "home" ? state.objects : (state.layouts[id] ?? []);
}

function toGardenState(res: Schema["TaneGardenState"]["type"] | null | undefined): GardenState {
  if (!res) throw new Error("ガーデンを読み込めませんでした");
  return {
    width: res.width,
    height: res.height,
    objects: parseJson<GardenObject[]>(res.objects),
    layouts: parseJson<GardenLayouts | null>(res.layouts) ?? {},
    items: parseJson<{ itemId: string; quantity: number }[]>(res.items),
    level: res.level,
    plantedCount: res.plantedCount,
  };
}

export async function openGarden(): Promise<GardenState> {
  await requireUserId();
  return toGardenState(unwrap(await data.mutations.openTaneGarden()));
}

/**
 * ほかの人のガーデン(見るだけ)。持ち主が自分に「農園を見せる」にしていて、自分が持ち主をフォローしているときだけ見られる
 * (確かめるのは Lambda。見られなければエラー)
 */
export interface FriendGarden {
  nickname: string | null;
  width: number;
  height: number;
  objects: GardenObject[];
  layouts: GardenLayouts;
  level: number;
  plantedCount: number;
}

export async function fetchGardenOf(userId: string): Promise<FriendGarden> {
  await requireUserId();
  const g = unwrap(await data.queries.viewTaneGarden({ ownerId: userId }));
  if (!g) throw new Error("この人のガーデンは見られません");
  return {
    nickname: g.nickname ?? null,
    width: g.width,
    height: g.height,
    objects: parseJson<GardenObject[]>(g.objects),
    layouts: parseJson<GardenLayouts | null>(g.layouts) ?? {},
    level: g.level,
    plantedCount: g.plantedCount,
  };
}

/** 自分に農園を見せてくれている人の ID(見せてくれている側が作った行を、見せてもらっている側から引く) */
export async function fetchTaneSharerIds(): Promise<Set<string>> {
  const viewerId = await requireUserId();
  const ids = new Set<string>();
  let nextToken: string | null | undefined;
  do {
    const page = await data.models.GameTaneShare.listTaneSharesByViewer({ viewerId }, { nextToken });
    for (const s of unwrap(page)) ids.add(s.ownerId);
    nextToken = page.nextToken;
  } while (nextToken);
  return ids;
}

/** 1つのガーデンの配置を保存する(gardenId を省略するとおうちの庭) */
export async function saveGarden(objects: GardenObject[], gardenId: GardenDesignId = "home"): Promise<GardenState> {
  await requireUserId();
  return toGardenState(unwrap(await data.mutations.saveTaneGarden({ objects: JSON.stringify(objects), gardenId })));
}

/** チェックイン・遠くからの水やりの区切りの長さ。dev(devgame.usapo.net・手元)は5分、本番は朝・昼・夜(Lambda 側も同じ値にしている) */
export function taneDayMs(): number {
  return isLocationOverrideAllowed() ? DAY_MS_DEV : DAY_MS_PRODUCTION;
}

/** 開発用の位置指定を出してよい環境か(dev 環境と手元だけ。本番では出さない) */
export function isLocationOverrideAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "devgame.usapo.net";
}
