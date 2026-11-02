import type { TownDistrictFeature } from "@/lib/game/chizuTane/geo";

// 地区の塗り分け(おでかけ・全国農地で共通): いまいる(選んだ)地区は青、となりの地区(境目が接している地区。同じ市区町村の中だけ)はオレンジで薄く覆う

export const SELECTED_STYLE = { color: "#1d4ed8", weight: 3, opacity: 1, fillColor: "#1d4ed8", fillOpacity: 0.08 };
export const NEIGHBOR_STYLE = { color: "#ea580c", weight: 1.5, opacity: 0.8, fillColor: "#ea580c", fillOpacity: 0.08 };

/** geojson の座標の入れ子(Polygon / MultiPolygon)から、頂点を「経度,緯度」の文字列で取り出す(となりの地区を見分けるため) */
export function collectVertexKeys(coords: unknown, out: string[] = []): string[] {
  if (!Array.isArray(coords)) return out;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    out.push(`${coords[0].toFixed(6)},${coords[1].toFixed(6)}`);
  } else {
    for (const c of coords) collectVertexKeys(c, out);
  }
  return out;
}

/** その地区ととなりの地区(境目の頂点を1つでも共有している地区)の feature */
export function districtWithNeighbors(
  features: TownDistrictFeature[],
  areaKey: string
): { selected: TownDistrictFeature[]; neighbors: TownDistrictFeature[] } {
  const selected = features.filter((f) => f.properties.KEY_CODE === areaKey);
  const vertices = new Set(selected.flatMap((f) => collectVertexKeys(f.geometry?.coordinates)));
  const neighbors = features.filter(
    (f) => f.properties.KEY_CODE !== areaKey && collectVertexKeys(f.geometry?.coordinates).some((v) => vertices.has(v))
  );
  return { selected, neighbors };
}
