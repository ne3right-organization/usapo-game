// 国土地理院タイル(陰影起伏図)を取得してcanvasに合成するユーティリティ。
// 出典表示が必須のため、呼び出し側で「国土地理院」のクレジットを表示すること
// (https://maps.gsi.go.jp/development/ichiran.html)

export interface LngLatBBox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 16;
const TARGET_PX = 480;
const MAX_TILE_COUNT = 64;

function lngToGlobalPx(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToGlobalPx(lat: number, zoom: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return y * TILE_SIZE * 2 ** zoom;
}

// bbox(経緯度)がおおよそTARGET_PXに収まるズームを、zoom0でのpx幅から逆算する
// (単純に高ズームから探索すると常に最大ズームがヒットしてタイル枚数が爆発するため、対数から直接求める)
function pickZoom(bbox: LngLatBBox): number {
  const lngPxAtZoom0 = ((bbox.maxLng - bbox.minLng) / 360) * TILE_SIZE;
  const latPxAtZoom0 = latToGlobalPx(bbox.minLat, 0) - latToGlobalPx(bbox.maxLat, 0);
  const idealZoomLng = Math.log2(TARGET_PX / Math.max(lngPxAtZoom0, 1e-9));
  const idealZoomLat = Math.log2(TARGET_PX / Math.max(latPxAtZoom0, 1e-9));
  const zoom = Math.floor(Math.min(idealZoomLng, idealZoomLat));
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function loadTileImage(z: number, x: number, y: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`hillshade tile load failed: ${z}/${x}/${y}`));
    img.src = `https://cyberjapandata.gsi.go.jp/xyz/hillshademap/${z}/${x}/${y}.png`;
  });
}

// bboxにクロップした陰影起伏図をcanvasで返す。取得に失敗した場合はnull(呼び出し側で単色塗りにフォールバックする想定)
export async function fetchHillshadeRaster(bbox: LngLatBBox): Promise<HTMLCanvasElement | null> {
  try {
    const zoom = pickZoom(bbox);
    const pxMinX = lngToGlobalPx(bbox.minLng, zoom);
    const pxMaxX = lngToGlobalPx(bbox.maxLng, zoom);
    const pxMinY = latToGlobalPx(bbox.maxLat, zoom); // 北(緯度大)ほどpxは小さい
    const pxMaxY = latToGlobalPx(bbox.minLat, zoom);

    const tileXStart = Math.floor(pxMinX / TILE_SIZE);
    const tileXEnd = Math.floor((pxMaxX - 0.001) / TILE_SIZE);
    const tileYStart = Math.floor(pxMinY / TILE_SIZE);
    const tileYEnd = Math.floor((pxMaxY - 0.001) / TILE_SIZE);

    const tileCountX = tileXEnd - tileXStart + 1;
    const tileCountY = tileYEnd - tileYStart + 1;
    if (tileCountX <= 0 || tileCountY <= 0 || tileCountX * tileCountY > MAX_TILE_COUNT) return null;

    const tiles = await Promise.all(
      Array.from({ length: tileCountX * tileCountY }, (_, i) => {
        const tx = tileXStart + (i % tileCountX);
        const ty = tileYStart + Math.floor(i / tileCountX);
        return loadTileImage(zoom, tx, ty).then((img) => ({ img, tx, ty }));
      })
    );

    const merged = document.createElement("canvas");
    merged.width = tileCountX * TILE_SIZE;
    merged.height = tileCountY * TILE_SIZE;
    const mergedCtx = merged.getContext("2d");
    if (!mergedCtx) return null;
    for (const { img, tx, ty } of tiles) {
      mergedCtx.drawImage(img, (tx - tileXStart) * TILE_SIZE, (ty - tileYStart) * TILE_SIZE);
    }

    const cropX = pxMinX - tileXStart * TILE_SIZE;
    const cropY = pxMinY - tileYStart * TILE_SIZE;
    const cropWidth = pxMaxX - pxMinX;
    const cropHeight = pxMaxY - pxMinY;

    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, Math.round(cropWidth));
    cropped.height = Math.max(1, Math.round(cropHeight));
    const croppedCtx = cropped.getContext("2d");
    if (!croppedCtx) return null;
    croppedCtx.drawImage(merged, cropX, cropY, cropWidth, cropHeight, 0, 0, cropped.width, cropped.height);

    return cropped;
  } catch {
    return null;
  }
}
