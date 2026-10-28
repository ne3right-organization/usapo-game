// 地図タネの「どの地区(町丁)にいるか」の判定。画面と Lambda の両方から使う(ブラウザ・Node のどちらにも依存しない)。
// 町丁のポリゴンは地図パズルと同じ CloudFront の geojson(/geojson/town-district/2020/{pref}/{city}.geojson)

type Position = number[];
type Ring = Position[];

export interface TownDistrictFeature {
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] } | null;
}

/** 地区(町丁)。areaKey は e-Stat 小地域の KEY_CODE(拠点の主キー) */
export interface TownDistrict {
  areaKey: string;
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
  townName: string;
  /** 代表点(geojson の X_CODE / Y_CODE)。移動の速さの確認に使う(プレイヤーの実際の位置は保存しない) */
  repLng: number;
  repLat: number;
}

export function townDistrictUrl(cloudFrontUrl: string, prefCode: string, cityCode: string): string {
  return `${cloudFrontUrl}/geojson/town-district/2020/${prefCode}/${cityCode}.geojson`;
}

export function isPrefCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}$/.test(value);
}

export function isCityCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{3}$/.test(value);
}

export function townDistrictOf(feature: TownDistrictFeature): TownDistrict | null {
  const p = feature.properties;
  const areaKey = typeof p.KEY_CODE === "string" ? p.KEY_CODE : null;
  if (!areaKey) return null;
  return {
    areaKey,
    prefCode: String(p.PREF ?? ""),
    prefName: String(p.PREF_NAME ?? ""),
    cityCode: String(p.CITY ?? ""),
    cityName: String(p.CITY_NAME ?? ""),
    townName: String(p.S_NAME ?? ""),
    repLng: Number(p.X_CODE),
    repLat: Number(p.Y_CODE),
  };
}

// 射線法。リングの最初と最後が同じ点でも違っても動く
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 1つ目が外周、2つ目以降が穴 */
function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  if (rings.length === 0 || !inRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(lng, lat, rings[i])) return false;
  return true;
}

export function featureContains(feature: TownDistrictFeature, lng: number, lat: number): boolean {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === "Polygon") return inPolygon(lng, lat, g.coordinates);
  return g.coordinates.some((rings) => inPolygon(lng, lat, rings));
}

/** 点を含む地区。どれにも入らなければ null */
export function findTownDistrict(features: TownDistrictFeature[], lng: number, lat: number): TownDistrict | null {
  for (const f of features) {
    if (featureContains(f, lng, lat)) return townDistrictOf(f);
  }
  return null;
}

/** 市区町村ごとの範囲の一覧(public/chizu-tane/municipality-bounds.json)の1行 */
export type MunicipalityBounds = [prefCode: string, cityCode: string, minLng: number, minLat: number, maxLng: number, maxLat: number];

/** 点を囲む範囲を持つ市区町村(範囲は四角なので、隣の市区町村も入ることがある) */
export function municipalityCandidates(rows: MunicipalityBounds[], lng: number, lat: number): { prefCode: string; cityCode: string }[] {
  return rows
    .filter(([, , minLng, minLat, maxLng, maxLat]) => lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat)
    .map(([prefCode, cityCode]) => ({ prefCode, cityCode }));
}

/** 2点間の距離(km) */
export function distanceKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** これより速く移動していたら、位置を偽っているとみなす(新幹線より少し速い) */
export const MAX_SPEED_KMH = 350;
/** 隣の地区くらいの距離なら、速さは見ない(代表点どうしの距離なので、すぐ隣でも離れて見えることがある) */
export const SPEED_CHECK_MIN_KM = 3;

export function isTooFast(
  from: { lng: number; lat: number; at: string } | null,
  to: { lng: number; lat: number },
  now: Date
): boolean {
  if (!from) return false;
  const km = distanceKm(from.lng, from.lat, to.lng, to.lat);
  if (km < SPEED_CHECK_MIN_KM) return false;
  const hours = Math.max((now.getTime() - new Date(from.at).getTime()) / 3_600_000, 1 / 3600);
  return km / hours > MAX_SPEED_KMH;
}

/** 日本時間の日付(YYYY-MM-DD)。「拠点ごとに1日1回」の判定に使う */
export function jstDate(d: Date): string {
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
