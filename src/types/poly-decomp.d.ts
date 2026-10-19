// poly-decomp には型定義が同梱されていないため、地図パックで使う関数だけ宣言する
declare module "poly-decomp" {
  type Polygon = [number, number][];
  const decomp: {
    quickDecomp(polygon: Polygon): Polygon[];
    isSimple(polygon: Polygon): boolean;
    makeCCW(polygon: Polygon): boolean;
    removeCollinearPoints(polygon: Polygon, thresholdAngle?: number): number;
    removeDuplicatePoints(polygon: Polygon, precision?: number): void;
  };
  export default decomp;
}
