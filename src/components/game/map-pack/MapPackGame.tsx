"use client";

// 地図ポットン: 地域(都道府県/市区町村/町丁)のピースを箱に落とし、隣接する地域同士が触れたら
// 実際の地図上の位置関係のまま1つに固まる。全ピースが1つに固まったら完成。
// 物理演算は Matter.js、描画は canvas に自前で行う(Matter.Render は使わない)。

import Matter from "matter-js";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buildAreaData, simplifyRing, type AreaData, type Point } from "@/lib/game/mapPack/regions";
import { clearShapeCache, regionConvexParts } from "@/lib/game/mapPack/shapes";
import { absoluteUrl, xShareUrl } from "@/lib/game/share";
import {
  clearMapPackSessionSaves,
  currentUserId,
  discardMapPackProgress,
  mapPackSessionKey,
  saveMapPackProgress,
  type MapPackSessionSave,
  type MapPackSnapshot,
  mapPackAreaRankingHref,
  mapPackPlayHref,
  submitMapPackChallenge,
  type MapPackArea,
} from "@/lib/game/mapPackData";

// ===== 箱とワールド(物理演算の座標系、1単位 ≒ 表示幅に応じて拡縮) =====
const BW = 300, BH = 420;
const MARGIN = 16;
const TOP = 110;                      // 箱の上の、次のピースを構えるスペース
const W = BW + MARGIN * 2, H = TOP + BH + 12;
const BOX_L = MARGIN, BOX_R = MARGIN + BW, RIM_Y = TOP, FLOOR_Y = TOP + BH;
const WALL_T = 200;                   // 壁・床の厚み(すり抜け防止)
const WALL_H = 4000;                  // あふれても終了しないので、壁は上方向に十分高くしておく

// ===== ピースの大きさ =====
// 一辺 ∝ 面積^SIZE_EXP。0.5未満なので、合体したピースは元の合計より小さくなり箱に隙間ができる
const SIZE_EXP = 0.35;
const MERGED_MAX = 0.9;               // 合体ピース(完成形を含む)の直径は箱の幅の90%まで
// ピースの大きさの基準: 全ピースをばらばらのまま並べたときの面積の合計が、箱の面積のこの割合になるようにする。
// ピース数が多いエリア(小田原市の町丁196、北海道の市区町村188など)でも箱からあふれすぎず、少ないエリアでは大きく見える。
// (最初は「全地域が固まった完成形が箱に収まる」大きさを基準にしたが、日本列島のように細長い地図だと
//  ピースが極端に小さくなったため不採用。完成形・合体ピースは buildPiece で MERGED_MAX に収まるよう個別に縮める)
const FILL_RATIO = 0.5;
// 小さい地域でも見える・当たる大きさを確保する。ただしピース数が多いエリア(岐阜市の町丁は2,142)では
// この大きさでも箱に入りきらない(最小サイズのピースだけで箱の2.4倍)ため、ピース数に応じて MIN_SIDE_FLOOR まで下げる
const MIN_SIDE = 12;
const MIN_SIDE_FLOOR = 7;
const PHYS_TOL = 2;                   // 物理形状の許容誤差(ワールド単位)。ピース数が多いエリアの負荷を抑えるため粗め
const DRAW_TOL = 0.4;                 // 描画用の間引きの許容誤差(ワールド単位)
// 合体したピースの中の地域は、一辺がこれ以上なら小さめの文字でラベルを描く(単独のピースは常に描く)。
// 最初は26にしていたが、合体すると地名がほとんど消えてどこにくっつければいいか分からなくなったため下げた
const LABEL_MIN = 14;
const LABEL_FONT: [number, number] = [6.5, 9]; // ラベルの文字の大きさ(ワールド単位)の範囲
// スマホでスクロールせずに遊べるよう、箱を画面の高さにも収める。サイト共通ヘッダー・タイトル行・HUD・ボタンの分の高さ(px)
const RESERVED_HEIGHT_PX = 230;

// ===== ピースの弾み =====
// 一辺が BOUNCY_SIDE_MAX 未満のピースは、小さいほど反発係数を上げる。
// 止まっているピースは大きさを問わず時々ポンと跳ねる(合体したピースが固まったまま動かなくなるのを防ぐ)。
// 小さいピースほど高く・頻繁に、大きいピースほど低く・まれに跳ねる
const BOUNCY_SIDE_MAX = 30;
const RESTITUTION_MIN = 0.05, RESTITUTION_MAX = 0.6;
const HOP_INTERVAL_MS: [number, number] = [1000, 3500]; // 最も小さいピースの間隔。大きいピースは最大2倍まで延びる
// 上向きの初速(大きいピース 〜 最も小さいピース)。重力1.3では初速vで約 v²/0.72 だけ浮く(3.5で約17、5.5で約42)
const HOP_UP: [number, number] = [3.5, 5.5];
const HOP_SIDE = 1.5;                        // 横方向の初速の最大
// 回転の初速(ラジアン/ステップ)の範囲。向きはランダムで、ほぼ回らないハズレが出ないよう下限を設ける
const HOP_SPIN: [number, number] = [0.08, 0.16];
// これより遅ければ「落下中ではない」とみなして跳ねさせる。積み重なったピースはプルプル揺れて速度0にならないため、
// 揺れは含めて落下・跳躍中だけを除外できる値にする(落下中は3〜7程度)
const HOP_REST_SPEED = 1.5;

// ===== 積み直す(合体が止まったとき用) =====
// 箱の中のピースを全部取り出し、ランダムな順番で1つずつ時間差で落とし直す。
// 落とす位置は RESTACK_AIM の確率で、箱の中にある隣接地域の真上に寄せる(積み直すたびに合体が起きやすくなる)。
// 不採用にした方式: 全ピースを同時に跳ね上げる/まとめて上に積んで同時に降らせる → どちらも同じ速さで
// まとまって落ちるため並びがほとんど変わらなかった
const RESTACK_INTERVAL_MS = 150;
const RESTACK_AIM = 0.7;
const RESTACK_PENALTY = 50;
// 割って積み直す: 一番大きいかたまりを2つに割ってから、全部を積み直す。かたまりが輪になって内側に入る地域が
// くっつけられなくなったとき用(試遊での指摘。最初は「囲まれた地域は輪のどこに触れてもくっつく」自動の対応を
// 入れたが、点数を使って自分でこじ開ける方が遊びとして良いというユーザー判断で置き換えた)
const SPLIT_PENALTY = 200;
// 割るときにこれより小さい部分(全体に対する割合・地域数)ができたら、隣の部分にくっつけたまま割る。
// 切る線の片側が地続きでないと1〜3地域の細かいかけらが生まれ、動けなくなっていた(関市の中断データで確認)
const SPLIT_MIN_PART_RATIO = 0.1;
const SPLIT_MIN_PART = 3;
// 割ったかたまり同士が再びくっつかないのは、積み直しで最後のピースを落としてからこの時間だけ。
// 時間制限が無いと、隣が同じ割り方のかたまりにしかないかけらが永久にくっつけなくなっていた
const SPLIT_BLOCK_MS = 15000;
const SPAWN_GAP = 4;                  // 落とす・落とし直すピースを、真下のピースからこれだけ離して出現させる

// ===== まとめて落とす =====
// ピース数が多いエリア(900ピース近い市区町村もある)で、1つずつ落とすだけで一苦労なため、
// 次の何個かをバラバラのまま続けて落とせるようにする(あらかじめくっつけて落とす案はユーザーが不採用)。
// 個数はエリアのピース数で決める。250個未満はボタンを出さない
const BATCH_SIZES: [minPieces: number, size: number][] = [[1000, 20], [750, 15], [500, 10], [250, 5]];
const batchSizeFor = (pieces: number) => BATCH_SIZES.find(([min]) => pieces >= min)?.[1] ?? 0;
const BATCH_INTERVAL_MS = 120;
const BATCH_SPREAD = 0.3;             // 狙った位置から左右に、箱の幅のこの割合まで散らす

// ===== 物理・進行 =====
const STEP_MS = 1000 / 60;
const SUBSTEPS = 3;
const GRAVITY = 1.3;
const DROP_WAIT_MS = 600;             // 落としてから次のピースが出るまで
const NEIGHBOR_BIAS = 0.6;            // 箱の中の地域に隣接する地域を優先して出す確率
// 地名の先頭がこの文字数だけ同じもの(例: 加納〇〇町、長良〇〇)を「地名の系統」とし、系統の中は名前順
// (一丁目→二丁目→…)に続けて出す。同じ地区・番号の近い丁目は隣り合っていることが多く、落とした直後に
// くっつきやすくなる(2,000ピースを超える岐阜市でほとんどくっつけられなかったことへの対応)
const FAMILY_PREFIX_LEN = 2;

const KANJI_DIGITS = "〇一二三四五六七八九";
/** 一〜九十九の漢数字を数にする(丁目の並べ替え用) */
function kanjiNumber(k: string): number {
  const i = k.indexOf("十");
  if (i < 0) return KANJI_DIGITS.indexOf(k);
  const tens = i === 0 ? 1 : KANJI_DIGITS.indexOf(k.slice(0, i));
  const ones = i === k.length - 1 ? 0 : KANJI_DIGITS.indexOf(k.slice(i + 1));
  return tens * 10 + ones;
}
/** 地名を「丁目を除いた名前」と「丁目の番号」に分ける */
function splitChome(name: string): [string, number] {
  const m = name.match(/^(.*?)([一二三四五六七八九十]+)丁目$/);
  return m ? [m[1], kanjiNumber(m[2])] : [name, 0];
}
// 大きすぎる地域・歪な地域は、ふつうの地域を出し終わってから出す(序盤から箱を塞がないように)。
// 面積の大きい順・歪な順(円形度 4π×面積÷周長² の低い順)にそれぞれこの割合を後回しにする
const DEFER_LARGE_RATIO = 0.15;
const DEFER_IRREGULAR_RATIO = 0.15;

// ===== くっつく相手の引き上げ =====
// 落とす位置の線(点線)に重なっている、くっつく相手のピースを上に引っ張り上げる。
// 相手が山の下の方に埋まっていると、上から落としても届かずくっつけられないため(試遊での指摘)。
// 引っ張るのは狙っている間だけで、落とした(指を離した)瞬間にやめる(ユーザー指示)
// 力は一定ではなく、浮き上がる速さが LIFT_TARGET_SPEED になるよう自動で調整する。
// (最初は重力の2.2倍の一定の力にしたが、邪魔がないと強すぎて飛び上がり、上に乗られている・挟まっていると
//  弱すぎて動かなかったため。試遊での指摘)
// 力(重力の何倍か) = 1 + LIFT_GAIN × (目標の速さ - 今の上向きの速さ) + 詰まり分。
// 詰まり分は、速さが目標の半分に届かない間 LIFT_BOOST_STEP ずつ増え、動き出すと減る。合計は LIFT_MAX まで
const LIFT_TARGET_SPEED = 1.2;        // 目標の上向きの速さ(ワールド単位/ステップ)
const LIFT_GAIN = 1.5;
const LIFT_BOOST_STEP = 0.04;         // 1サブステップごとに増やす詰まり分(約1.5秒で最大に届く)
const LIFT_MAX = 6;
// 合体して大きくなったピースの底の方にくっつく相手がいると、引き上げても相手は底を向いたままで、
// 上から落としたピースが触れられない(試遊での指摘)。相手の地域が上を向くようにピースを回す
const LIFT_ROT_MIN_OFFSET = 8;        // 相手の地域がピースの中心からこれ以上離れていれば回す(中心付近なら向きは関係ない)
const LIFT_ROT_GAIN = 0.05;           // 角度のずれ(ラジアン)あたりの目標の回転の速さ
const LIFT_ROT_MAX = 0.04;            // 回転の速さの上限(ラジアン/ステップ)
const LIFT_ROT_BLEND = 0.2;           // 今の回転の速さを目標に近づける割合(サブステップごと)
const LIFT_STOP_BELOW_RIM = 30;       // 箱の縁からこの距離より上まで来たら引っ張るのをやめる(飛び出さないように)
const LIFT_PAUSE_AFTER_RESTACK_MS = 1000; // 積み直しで最後のピースを落としてから、引き上げを再開するまで
const FLASH_MS = 450;
const POPUP_MS = 900;
const CONFIRM_MS = 3000;              // やり直す・あきらめるを1回押してから、2回目を受け付ける時間

// ===== 得点 =====
// 合体1回ごとに「合体後のピースの地域数 × MERGE_POINT」。大きなかたまりに足していくほど伸びる。
// 得点 = max(0, 合体の点 - 積み直し回数 × RESTACK_PENALTY) + 完成ボーナス。
// DB側(supabase/migrations/20261019000000_map_pack_schema.sql のトリガー)でも同じ式で計算し直すので、変えるときは両方そろえること
const MERGE_POINT = 10;
const CLEAR_BONUS = 1000;
const TIME_BONUS_SEC = 300;           // 完成までこの秒数を切った分だけ、1秒あたり TIME_BONUS_PER_SEC 点
const TIME_BONUS_PER_SEC = 5;

type RegionPart = Matter.Body & { regionId?: number };

type Piece = {
  body: Matter.Body;
  regionIds: number[];
  area: number;
  cx: number;
  cy: number;
  scale: number;
  /** ピースのローカル座標系(角度0)での剛体の重心位置 */
  origin: { x: number; y: number };
  /** regionIds と同じ順番の、地域ごとの輪郭 */
  paths: Path2D[];
  /** regionIds と同じ順番の、地域ごとの重心(ピースのローカル座標) */
  centers: { x: number; y: number }[];
  labels: { text: string; x: number; y: number; size: number }[];
  /** 弾みやすさ(0: 弾まない 〜 1: 最も小さいピース) */
  bounciness: number;
  /** 次にポンと跳ねてよい時刻(0なら未設定) */
  nextHopAt: number;
  /**
   * 割って積み直したときに分かれたかたまりに付ける印(同じ割り方で分かれたものは同じ番号)。同じ印同士は
   * 再びくっつかない(切り口で隣り合っているので、すぐ輪に戻ってしまうため)。別のピースとくっつくと印は消える
   */
  splitTag: number | null;
  fill: string;
  stroke: string;
};

type HoverInfo = { name: string; index: number; total: number };

type Hud = {
  dropped: number;
  total: number;
  largest: number;
  score: number;
  hover: HoverInfo | null;
};

type Submit =
  | { status: "sending" }
  | { status: "guest" }
  | { status: "done"; isNewBest: boolean }
  | { status: "error"; message: string };

type Result = {
  kind: "clear" | "giveup";
  score: number;
  /** 完成時のボーナス(クリアボーナス+タイムボーナス)。あきらめた場合は0 */
  bonus: number;
  sec: number;
  largest: number;
};

const GROUP_HUE_STEP = 137.508; // 黄金角で町名ごとの色相を散らす

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type MapPackGameProps = {
  geojsonUrl: string;
  areaLabel: string;
  /** 地域名が入っている geojson のプロパティ名 */
  nameKey: string;
  /** 「町丁」「市区町村」「都道府県」など、ピース1つの呼び方 */
  unitLabel: string;
  /** ランキングの集計単位 */
  area: MapPackArea;
  /** 中断したところから再開する場合の状態 */
  initialSnapshot?: MapPackSnapshot | null;
  /** 「中断」で保存し終えたあとに呼ぶ(ゲームのトップに戻るなど) */
  onSaveAndExit?: () => void;
};

export default function MapPackGame({ geojsonUrl, nameKey, ...rest }: MapPackGameProps) {
  const [data, setData] = useState<AreaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(geojsonUrl)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((json) => {
        if (cancelled) return;
        clearShapeCache();
        setData(buildAreaData(json, nameKey));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [geojsonUrl, nameKey]);

  if (error) return <p className="text-center text-sm text-red-600 py-10">地図データを読み込めませんでした（{error}）</p>;
  if (!data) return <p className="text-center text-sm text-[#a8937a] py-10">地図データを読み込み中…</p>;
  // やり直したら中断の状態からではなく最初から
  return (
    <MapPackBoard
      key={round}
      data={data}
      geojsonUrl={geojsonUrl}
      {...rest}
      initialSnapshot={round === 0 ? rest.initialSnapshot : null}
      onRestart={() => setRound((r) => r + 1)}
    />
  );
}

type BoardProps = Omit<MapPackGameProps, "nameKey"> & { data: AreaData; onRestart: () => void };

const AUTO_SAVE_MS = 2000;            // 同じタブの sessionStorage に自動保存する間隔

function MapPackBoard({ data, geojsonUrl, areaLabel, unitLabel, area, initialSnapshot, onSaveAndExit, onRestart }: BoardProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<Hud>({ dropped: 0, total: data.regions.length, largest: 0, score: 0, hover: null });
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  // 結果のポップアップを閉じて、完成した地図だけを見られるようにする(閉じても操作ボタンは押せないまま)
  const [resultHidden, setResultHidden] = useState(false);
  /** 今の状態を書き出す(1つも落としていなければ null) */
  const snapshotRef = useRef<() => MapPackSnapshot | null>(() => null);
  const [saving, setSaving] = useState<"idle" | "saving" | "error">("idle");
  const [submit, setSubmit] = useState<Submit | null>(null);
  const giveUpRef = useRef<() => void>(() => {});
  /** 積み直しを始め、全ピースを落とし終えるまでの見込み時間(ms)を返す */
  const restackRef = useRef<() => number>(() => 0);
  const splitRef = useRef<() => number>(() => 0);
  const [restacking, setRestacking] = useState(false);
  // やり直す・あきらめるの確認。ブラウザの確認ダイアログ(window.confirm)は、スマホで何度か出すと
  // 「このページでダイアログを表示しない」状態になったり、アプリ内ブラウザでは出なかったりして、
  // 押しても何も起きなくなるため、ボタン自体を「本当に〜？」に変えて2回押しで実行する
  const [confirming, setConfirming] = useState<"restart" | "giveup" | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmThen = (kind: "restart" | "giveup", run: () => void) => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (confirming === kind) {
      setConfirming(null);
      run();
      return;
    }
    setConfirming(kind);
    confirmTimer.current = setTimeout(() => setConfirming(null), CONFIRM_MS);
  };
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);
  const batchRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { regions, adjacency, groups } = data;
    const minSide = Math.min(MIN_SIDE, Math.max(MIN_SIDE_FLOOR, Math.sqrt((FILL_RATIO * BW * BH) / regions.length) * 0.8));
    const groupOf = new Map<number, number>();
    groups.forEach((ids, g) => ids.forEach((id) => groupOf.set(id, g)));

    // ----- ピースの大きさの係数(一辺 = sizeK × 面積^SIZE_EXP)。FILL_RATIO 参照 -----
    const sizeK = Math.sqrt((FILL_RATIO * BW * BH) / regions.reduce((s, r) => s + Math.pow(r.area, 2 * SIZE_EXP), 0));

    // ----- 物理ワールド -----
    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY } });
    const wallOpts = { isStatic: true, friction: 0.5 };
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(W / 2, FLOOR_Y + WALL_T / 2, W + WALL_T * 2, WALL_T, wallOpts),
      Matter.Bodies.rectangle(BOX_L - WALL_T / 2, FLOOR_Y - WALL_H / 2, WALL_T, WALL_H, wallOpts),
      Matter.Bodies.rectangle(BOX_R + WALL_T / 2, FLOOR_Y - WALL_H / 2, WALL_T, WALL_H, wallOpts),
    ]);

    const pieces = new Map<number, Piece>(); // body.id → 箱の中のピース
    let hover: Piece | null = null;
    let hoverInfo: HoverInfo | null = null;
    /** 今落とそうとしているピースとくっつく(隣接する)地域。箱の中で光らせて地名も出す */
    let hoverTargets = new Set<number>();
    /** 今のピースが出てから、プレイヤーが指(マウス)を動かして狙ったか */
    let aimedSinceSpawn = false;
    let aimX = W / 2;
    let nextHoverAt = 0;
    let dropped = 0;
    let startAt: number | null = null;
    let mergePoints = 0;
    let restacks = 0;
    let splits = 0;
    let splitSeq = 0;
    // 再びくっつかないようにしている割り方(直近の1回だけ)と、その期限(積み直しを落とし終えるまでは無期限)
    let blockedSplitTag: number | null = null;
    let splitBlockUntil = Infinity;
    // 一度くっついたことのある地域同士(union-find)。割ってくっつけ直しても点が入らないようにする
    // (入れると、大きいかたまりを割ってくっつけ直すだけで得点を稼げてしまう)
    const joined = Int32Array.from(regions, (_, i) => i);
    const joinedRoot = (x: number) => {
      while (joined[x] !== x) {
        joined[x] = joined[joined[x]];
        x = joined[x];
      }
      return x;
    };
    let bonus = 0;
    const currentScore = () => Math.max(0, mergePoints - restacks * RESTACK_PENALTY - splits * SPLIT_PENALTY) + bonus;
    let ended = false; // 完成またはあきらめた
    const flashes: { x: number; y: number; r: number; at: number }[] = [];
    const popups: { x: number; y: number; text: string; at: number }[] = [];
    let pending: [Matter.Body, Matter.Body][] = [];

    // ----- ピースの構築 -----
    function buildPiece(regionIds: number[], angle: number): Piece {
      const regs = regionIds.map((id) => regions[id]);
      const area = regs.reduce((s, r) => s + r.area, 0);
      const cx = regs.reduce((s, r) => s + r.cx * r.area, 0) / area;
      const cy = regs.reduce((s, r) => s + r.cy * r.area, 0) / area;
      let rMax = 0;
      for (const r of regs) for (const ring of r.rings) for (const [x, y] of ring) rMax = Math.max(rMax, Math.hypot(x - cx, y - cy));
      let scale = sizeK * Math.pow(area, SIZE_EXP - 0.5);
      scale = Math.max(scale, minSide / Math.sqrt(area));
      scale = Math.min(scale, (MERGED_MAX * BW) / (2 * rMax));

      const toLocal = ([x, y]: Point) => ({ x: (x - cx) * scale, y: (y - cy) * scale });
      const parts: Matter.Body[] = [];
      for (const r of regs) {
        for (const poly of regionConvexParts(r, scale, PHYS_TOL)) {
          const verts = poly.map(toLocal);
          if (Matter.Vertices.area(verts, false) < 0.3) continue; // 極小の破片は物理演算を不安定にするので捨てる
          const part: RegionPart = Matter.Body.create({ position: Matter.Vertices.centre(verts), vertices: verts });
          part.regionId = r.id;
          parts.push(part);
        }
      }
      if (!parts.length) {
        // 全パーツが極小で捨てられた場合は外周の凸包1つで代用する
        // 型定義上は Vertex[] を要求するが、実装は x/y しか参照しない
        const verts = Matter.Vertices.hull(regs.flatMap((r) => r.rings.flat().map(toLocal)) as Matter.Vertex[]);
        const part: RegionPart = Matter.Body.create({ position: Matter.Vertices.centre(verts), vertices: verts });
        part.regionId = regs[0].id;
        parts.push(part);
      }
      const side = Math.sqrt(area) * scale;
      const bounciness = Math.min(1, Math.max(0, (BOUNCY_SIDE_MAX - side) / (BOUNCY_SIDE_MAX - minSide)));
      const restitution = RESTITUTION_MIN + (RESTITUTION_MAX - RESTITUTION_MIN) * bounciness;
      const body = Matter.Body.create({ parts, friction: 0.5, frictionStatic: 0.8, restitution, frictionAir: 0.012 });
      const origin = { x: body.position.x, y: body.position.y };

      const paths = regs.map((r) => {
        const path = new Path2D();
        for (const ring of r.rings) {
          simplifyRing(ring, DRAW_TOL / scale).forEach((p, i) => {
            const v = toLocal(p);
            if (i === 0) path.moveTo(v.x - origin.x, v.y - origin.y);
            else path.lineTo(v.x - origin.x, v.y - origin.y);
          });
          path.closePath();
        }
        return path;
      });

      const centers = regs.map((r) => {
        const v = toLocal([r.cx, r.cy]);
        return { x: v.x - origin.x, y: v.y - origin.y };
      });

      // 同じ名前が複数含まれる場合は一番大きい区画にだけラベルを付ける
      const biggestByName = new Map<string, number>();
      regs.forEach((r, i) => {
        const cur = biggestByName.get(r.name);
        if (cur === undefined || r.area > regs[cur].area) biggestByName.set(r.name, i);
      });
      const labels = [...biggestByName.values()]
        .map((i) => ({ i, side: Math.sqrt(regs[i].area) * scale }))
        .filter(({ side }) => regs.length === 1 || side >= LABEL_MIN)
        .map(({ i, side }) => ({
          text: regs[i].name,
          ...centers[i],
          size: regs.length === 1 ? LABEL_FONT[1] : Math.min(LABEL_FONT[1], Math.max(LABEL_FONT[0], side * 0.3)),
        }));

      const groupIds = new Set(regionIds.map((id) => groupOf.get(id)!));
      let fill: string, stroke: string;
      if (groupIds.size === 1) {
        const hue = ([...groupIds][0] * GROUP_HUE_STEP) % 360;
        fill = `hsl(${hue} 60% 80%)`;
        stroke = `hsl(${hue} 35% 45%)`;
      } else {
        // 合体済みは大きくなるほど濃い緑にして、完成に近づいていく様子を見せる
        const t = regionIds.length / regions.length;
        fill = `hsl(${150 - 20 * t} 45% ${78 - 22 * t}%)`;
        stroke = `hsl(${150 - 20 * t} 40% 30%)`;
      }

      Matter.Body.setAngle(body, angle);
      return { body, regionIds, area, cx, cy, scale, origin, paths, centers, labels, bounciness, nextHopAt: 0, splitTag: null, fill, stroke };
    }

    /** ピース上の地理座標(メートル)が今ワールドのどこにあるか */
    function worldOf(piece: Piece, x: number, y: number) {
      const lx = (x - piece.cx) * piece.scale - piece.origin.x;
      const ly = (y - piece.cy) * piece.scale - piece.origin.y;
      const c = Math.cos(piece.body.angle), s = Math.sin(piece.body.angle);
      return { x: piece.body.position.x + lx * c - ly * s, y: piece.body.position.y + lx * s + ly * c };
    }

    function keepInsideBox(body: Matter.Body) {
      const b = body.bounds;
      let dx = 0, dy = 0;
      if (b.min.x < BOX_L) dx = BOX_L - b.min.x + 0.5;
      else if (b.max.x > BOX_R) dx = BOX_R - b.max.x - 0.5;
      if (b.max.y > FLOOR_Y) dy = FLOOR_Y - b.max.y - 0.5;
      if (dx || dy) Matter.Body.translate(body, { x: dx, y: dy });
    }

    // ----- 出題順: 同じ名前は連続で出す。名前の選び方は箱の中に隣接するものを優先する -----
    const remainingGroups = new Set(groups.map((_, g) => g));

    // 地名の系統ごとに、名前のまとまりを名前順(丁目は番号順)に並べておく
    const familyOf: string[] = [];
    const familyGroups = new Map<string, number[]>();
    groups.forEach((ids, g) => {
      const key = splitChome(regions[ids[0]].name)[0].slice(0, FAMILY_PREFIX_LEN);
      familyOf[g] = key;
      if (!familyGroups.has(key)) familyGroups.set(key, []);
      familyGroups.get(key)!.push(g);
    });
    for (const list of familyGroups.values()) {
      list.sort((a, b) => {
        const [na, ca] = splitChome(regions[groups[a][0]].name);
        const [nb, cb] = splitChome(regions[groups[b][0]].name);
        return na === nb ? ca - cb : na < nb ? -1 : 1;
      });
    }
    let currentFamily: string | null = null;

    // 後回しにする名前のまとまり。同じ名前は連続で出すので、まとまり単位で「一番大きい区画の面積」
    // 「一番歪な区画の円形度」を比べる(区画単位で選ぶと、区画の多い町名がまとめて後回しになり、
    // 小田原市では196ピース中93ピースが後回しになってしまった)
    const deferredGroups = (() => {
      const roundness = regions.map((r) => {
        let perimeter = 0;
        for (const ring of r.rings) ring.forEach((p, i) => {
          const q = ring[(i + 1) % ring.length];
          perimeter += Math.hypot(q[0] - p[0], q[1] - p[1]);
        });
        return perimeter ? (4 * Math.PI * r.area) / perimeter ** 2 : 1;
      });
      const maxArea = groups.map((ids) => Math.max(...ids.map((id) => regions[id].area)));
      const minRound = groups.map((ids) => Math.min(...ids.map((id) => roundness[id])));
      const idx = groups.map((_, g) => g);
      const deferred = new Set<number>();
      // 上限はピース数で数える(区画の多い町名は1つ選ぶだけでピースが一気に増えるため)
      const take = (order: number[], ratio: number) => {
        let budget = Math.floor(regions.length * ratio);
        for (const g of order) {
          if (deferred.has(g)) continue;
          if (groups[g].length > budget) break;
          deferred.add(g);
          budget -= groups[g].length;
        }
      };
      take(idx.slice().sort((a, b) => maxArea[b] - maxArea[a]), DEFER_LARGE_RATIO);
      take(idx.slice().sort((a, b) => minRound[a] - minRound[b]), DEFER_IRREGULAR_RATIO);
      return deferred;
    })();
    let queue: number[] = [];
    let queueGroupSize = 0;

    function nextRegion(): { id: number; info: HoverInfo } | null {
      if (!queue.length) {
        if (!remainingGroups.size) return null;
        const placed = new Set<number>();
        for (const p of pieces.values()) p.regionIds.forEach((id) => placed.add(id));
        const normal = [...remainingGroups].filter((g) => !deferredGroups.has(g));
        const rest = normal.length ? normal : [...remainingGroups];
        const restSet = new Set(rest);
        // 今の地名の系統に残りがあれば、名前順で次のものを出す
        let g = currentFamily === null ? undefined : familyGroups.get(currentFamily)!.find((x) => restSet.has(x));
        if (g === undefined) {
          // 新しい系統は、箱の中に隣接するものを優先して選び、その系統の名前順の先頭から出す
          const near = rest.filter((x) => groups[x].some((id) => [...adjacency[id]].some((o) => placed.has(o))));
          const pool = near.length && Math.random() < NEIGHBOR_BIAS ? near : rest;
          currentFamily = familyOf[pool[Math.floor(Math.random() * pool.length)]];
          g = familyGroups.get(currentFamily)!.find((x) => restSet.has(x))!;
        }
        remainingGroups.delete(g);
        queue = shuffle(groups[g].slice());
        queueGroupSize = queue.length;
      }
      const id = queue.shift()!;
      return { id, info: { name: regions[id].name, index: queueGroupSize - queue.length, total: queueGroupSize } };
    }

    // 積み直し待ちのピース(箱から取り出して、まだ落とし直していないもの)
    let restackQueue: Piece[] = [];
    let restackNextAt = 0;

    function largestCount() {
      let m = 0;
      for (const p of pieces.values()) m = Math.max(m, p.regionIds.length);
      for (const p of restackQueue) m = Math.max(m, p.regionIds.length);
      return m;
    }

    function publishHud() {
      setHud({ dropped, total: regions.length, largest: largestCount(), score: currentScore(), hover: hoverInfo });
    }

    function spawnHover(now: number) {
      const next = nextRegion();
      if (!next) { hover = null; hoverInfo = null; publishHud(); return; }
      hover = buildPiece([next.id], 0);
      hoverInfo = next.info;
      hoverTargets = new Set(adjacency[next.id]);
      aimedSinceSpawn = false;
      nextHoverAt = now;
      publishHud();
    }

    /**
     * 箱の中のピースに重ならない出現位置の y を返す。真下(横の範囲が重なる)にあるピースのうち一番高いものより上にする。
     * 山が縁より高いと、決まった高さに出現させたピースが既存のピースの内側に深く重なり、物理エンジンが
     * 引き離せずにかたまりの中に埋まったまま残ることがあったため(積み直しで起きやすい)
     */
    function clearSpawnY(body: Matter.Body, x: number, preferredY: number) {
      const b = body.bounds, pos = body.position;
      const left = x - (pos.x - b.min.x), right = x + (b.max.x - pos.x), bottom = b.max.y - pos.y;
      let y = preferredY;
      for (const p of pieces.values()) {
        if (p.body === body) continue;
        const q = p.body.bounds;
        if (q.max.x < left || q.min.x > right) continue;
        y = Math.min(y, q.min.y - bottom - SPAWN_GAP);
      }
      return y;
    }

    function hoverPosition(piece: Piece) {
      const b = piece.body.bounds, p = piece.body.position;
      const half = { l: p.x - b.min.x, r: b.max.x - p.x, bottom: b.max.y - p.y };
      const x = Math.min(Math.max(aimX, BOX_L + half.l + 1), BOX_R - half.r - 1);
      return { x, y: RIM_Y - half.bottom - 6 };
    }

    /** 落とす位置の線に重なっている、くっつく相手のピースを上に引っ張る(Engine.update の前に毎回呼ぶ) */
    /** 引っ張っているピース(body.id)ごとの「詰まり分」 */
    const liftBoost = new Map<number, number>();

    /** ピースの中のくっつく相手の地域(点線に一番近いもの)が、中心から見て真上に来るよう少しずつ回す */
    function turnTargetUp(p: Piece, lineX: number) {
      const { body } = p;
      const c = Math.cos(body.angle), s = Math.sin(body.angle);
      let best: { rx: number; ry: number; dx: number } | null = null;
      p.regionIds.forEach((id, i) => {
        if (!hoverTargets.has(id)) return;
        const rx = p.centers[i].x * c - p.centers[i].y * s;
        const ry = p.centers[i].x * s + p.centers[i].y * c;
        const dx = Math.abs(body.position.x + rx - lineX);
        if (!best || dx < best.dx) best = { rx, ry, dx };
      });
      if (!best) return;
      const { rx, ry } = best as { rx: number; ry: number };
      if (Math.hypot(rx, ry) < LIFT_ROT_MIN_OFFSET) return;
      // 画面は y が下向きなので、真上は角度 -π/2
      let diff = -Math.PI / 2 - Math.atan2(ry, rx);
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const want = Math.max(-LIFT_ROT_MAX, Math.min(LIFT_ROT_MAX, diff * LIFT_ROT_GAIN));
      const av = body.angularVelocity;
      Matter.Body.setAngularVelocity(body, av + (want - av) * LIFT_ROT_BLEND);
    }

    function liftTargets(now: number) {
      if (!hover || ended || !hoverTargets.size) return;
      // 新しいピースが出てきただけでは引っ張らず、プレイヤーが動かして狙い始めてから効かせる(ユーザー指示)
      if (!aimedSinceSpawn) return;
      // 積み直しの最中(と落とし終えて落ち着くまで)は引っ張らない。並びをばらす邪魔になるため
      if (restackQueue.length || now < restackNextAt + LIFT_PAUSE_AFTER_RESTACK_MS) return;
      if (batchRemaining) return; // まとめて落としている間は相手がめまぐるしく変わるので引っ張らない
      const x = hoverPosition(hover).x;
      const lifting = new Set<number>();
      for (const p of pieces.values()) {
        const b = p.body.bounds;
        if (x < b.min.x || x > b.max.x) continue;
        if (b.min.y < RIM_Y + LIFT_STOP_BELOW_RIM) continue;
        if (!p.regionIds.some((id) => hoverTargets.has(id))) continue;
        const id = p.body.id;
        lifting.add(id);
        const upSpeed = -p.body.velocity.y;
        let boost = liftBoost.get(id) ?? 0;
        boost = upSpeed < LIFT_TARGET_SPEED / 2 ? boost + LIFT_BOOST_STEP : Math.max(0, boost - LIFT_BOOST_STEP * 2);
        liftBoost.set(id, boost);
        const factor = Math.min(LIFT_MAX, Math.max(0, 1 + LIFT_GAIN * (LIFT_TARGET_SPEED - upSpeed) + boost));
        const up = p.body.mass * engine.gravity.y * engine.gravity.scale * factor;
        Matter.Body.applyForce(p.body, p.body.position, { x: 0, y: -up });
        if (p.regionIds.length > 1) turnTargetUp(p, x);
      }
      // 引っ張るのをやめたピースの詰まり分は忘れる
      for (const id of liftBoost.keys()) if (!lifting.has(id)) liftBoost.delete(id);
    }

    /** batchX を渡すと、狙いの位置の代わりにその横位置に落とし、次のピースを待たずにすぐ出す(まとめて落とす用) */
    function drop(now: number, batchX?: number) {
      if (!hover || ended || now < nextHoverAt) return;
      const at = hoverPosition(hover);
      if (batchX !== undefined) {
        const b = hover.body.bounds, pos = hover.body.position;
        at.x = Math.min(Math.max(batchX, BOX_L + (pos.x - b.min.x) + 1), BOX_R - (b.max.x - pos.x) - 1);
      }
      Matter.Body.setPosition(hover.body, { x: at.x, y: clearSpawnY(hover.body, at.x, at.y) });
      Matter.Body.setVelocity(hover.body, { x: 0, y: 0 });
      Matter.Composite.add(engine.world, hover.body);
      pieces.set(hover.body.id, hover);
      hover = null;
      hoverInfo = null;
      dropped++;
      if (startAt === null) startAt = now;
      publishHud();
      if (batchX !== undefined) spawnHover(now);
      else setTimeout(() => { if (!ended) spawnHover(performance.now()); }, DROP_WAIT_MS);
    }

    // まとめて落とす残り個数
    let batchRemaining = 0;
    let batchNextAt = 0;

    batchRef.current = () => {
      if (ended || !hover || batchRemaining) return;
      batchRemaining = batchSizeFor(regions.length);
      batchNextAt = 0;
    };

    function feedBatch(now: number) {
      if (!batchRemaining || now < batchNextAt) return;
      if (!hover || ended) { batchRemaining = 0; return; }
      drop(now, aimX + (Math.random() * 2 - 1) * BW * BATCH_SPREAD);
      batchRemaining--;
      batchNextAt = now + BATCH_INTERVAL_MS;
    }

    // ----- 合体 -----
    // ピースの地域の集合と、ピースの外で隣り合う地域の集合(ピースは作り直すまで変わらないのでキャッシュする)
    const idSetCache = new WeakMap<Piece, Set<number>>();
    const neighborCache = new WeakMap<Piece, Set<number>>();
    function idSetOf(p: Piece) {
      let set = idSetCache.get(p);
      if (!set) { set = new Set(p.regionIds); idSetCache.set(p, set); }
      return set;
    }
    function neighborsOf(p: Piece) {
      let set = neighborCache.get(p);
      if (!set) {
        const mine = idSetOf(p);
        set = new Set<number>();
        for (const id of p.regionIds) for (const o of adjacency[id]) if (!mine.has(o)) set.add(o);
        neighborCache.set(p, set);
      }
      return set;
    }
    /**
     * a の隣の地域が全部 b の中にある = a がくっつける相手は b しかない。この場合は、b のどこに触れてもくっつく。
     * 相手の地域が大きなかたまりの内側に埋もれていたり、周りを1つの地域に囲まれた飛び地だったりすると、
     * 外から触れられずにクリアできなくなっていたため(関市の中断データで確認)
     */
    function canOnlyJoin(a: Piece, b: Piece) {
      const nb = neighborsOf(a);
      if (!nb.size) return false;
      const target = idSetOf(b);
      for (const o of nb) if (!target.has(o)) return false;
      return true;
    }
    /** 直近に割ったかたまり同士は、積み直しを落とし終えてから SPLIT_BLOCK_MS の間は再びくっつかない */
    function blockedBySplit(a: Piece, b: Piece) {
      return (
        blockedSplitTag !== null &&
        a.splitTag === blockedSplitTag &&
        b.splitTag === blockedSplitTag &&
        performance.now() < splitBlockUntil
      );
    }

    function onCollision(e: Matter.IEventCollision<Matter.Engine>) {
      for (const pair of e.pairs) {
        const a = pair.bodyA as RegionPart, b = pair.bodyB as RegionPart;
        if (a.regionId === undefined || b.regionId === undefined || a.parent === b.parent) continue;
        const pa = pieces.get(a.parent.id), pb = pieces.get(b.parent.id);
        if (!pa || !pb) continue;
        // 行き先が1つしかないなら、触れた場所も割った直後かどうかも問わない
        if (canOnlyJoin(pa, pb) || canOnlyJoin(pb, pa)) {
          pending.push([a.parent, b.parent]);
          continue;
        }
        if (!adjacency[a.regionId].has(b.regionId) || blockedBySplit(pa, pb)) continue;
        pending.push([a.parent, b.parent]);
      }
    }
    Matter.Events.on(engine, "collisionStart", onCollision);
    Matter.Events.on(engine, "collisionActive", onCollision);

    function processMerges(now: number) {
      if (!pending.length) return;
      const pairs = pending;
      pending = [];
      let merged = false;
      for (const [ba, bb] of pairs) {
        const a = pieces.get(ba.id), b = pieces.get(bb.id);
        if (!a || !b) continue; // この処理の中で既に別のピースと合体した
        // 大きい方を動かさず、小さい方を地図上の正しい位置に吸い寄せる
        const anchor = a.area >= b.area ? a : b;
        const target = worldOf(anchor, anchor.cx, anchor.cy);
        const piece = buildPiece([...a.regionIds, ...b.regionIds], anchor.body.angle);
        Matter.Body.setPosition(piece.body, { x: 0, y: 0 });
        const off = worldOf(piece, anchor.cx, anchor.cy);
        Matter.Body.setPosition(piece.body, { x: target.x - off.x, y: target.y - off.y });
        keepInsideBox(piece.body);
        Matter.Composite.remove(engine.world, [a.body, b.body]);
        pieces.delete(a.body.id);
        pieces.delete(b.body.id);
        Matter.Composite.add(engine.world, piece.body);
        pieces.set(piece.body.id, piece);
        const b2 = piece.body.bounds;
        flashes.push({ x: target.x, y: target.y, r: Math.max(b2.max.x - b2.min.x, b2.max.y - b2.min.y) / 2, at: now });
        const ra = joinedRoot(a.regionIds[0]), rb = joinedRoot(b.regionIds[0]);
        const gained = ra === rb ? 0 : MERGE_POINT * piece.regionIds.length; // くっつけ直しは0点
        joined[ra] = rb;
        if (!ended && gained) {
          mergePoints += gained;
          popups.push({ x: target.x, y: target.y, text: `+${gained}`, at: now });
        }
        merged = true;
      }
      if (!merged || ended) return;
      publishHud();
      if (!hover && !queue.length && !remainingGroups.size && !restackQueue.length && pieces.size === 1 && startAt !== null) {
        const sec = Math.round((now - startAt) / 1000);
        bonus = CLEAR_BONUS + Math.max(0, TIME_BONUS_SEC - sec) * TIME_BONUS_PER_SEC;
        finish({ kind: "clear", score: currentScore(), bonus, sec, largest: regions.length });
      }
    }

    const rand = ([min, max]: [number, number]) => min + Math.random() * (max - min);

    /** 止まっているピースを時々ポンと跳ねさせる */
    function hopPieces(now: number) {
      if (ended) return; // 終わったあとは、完成した地図が跳ねて動かないようにする
      for (const p of pieces.values()) {
        if (p.body.speed > HOP_REST_SPEED) { p.nextHopAt = 0; continue; }
        if (p.nextHopAt === 0) { p.nextHopAt = now + rand(HOP_INTERVAL_MS) * (2 - p.bounciness); continue; }
        if (now < p.nextHopAt) continue;
        const up = HOP_UP[0] + (HOP_UP[1] - HOP_UP[0]) * p.bounciness;
        Matter.Body.setVelocity(p.body, { x: (Math.random() * 2 - 1) * HOP_SIDE, y: -up });
        Matter.Body.setAngularVelocity(p.body, (Math.random() < 0.5 ? -1 : 1) * rand(HOP_SPIN));
        p.nextHopAt = 0;
      }
    }

    function finish(r: Result) {
      ended = true;
      hover = null;
      hoverInfo = null;
      publishHud();
      setResult(r);
      clearMapPackSessionSaves(area.difficulty, geojsonUrl); // 終わったゲームは再開の対象にしない
      if (!dropped) return; // 1つも落とさずにあきらめた場合は記録しない
      setSubmit({ status: "sending" });
      // 未ログインならゲストプレイとして記録しない
      currentUserId()
        .then((userId) => {
          if (!userId) { setSubmit({ status: "guest" }); return; }
          return submitMapPackChallenge({
            ...area,
            totalPieces: regions.length,
            mergePoints,
            restackCount: restacks,
            splitCount: splits,
            cleared: r.kind === "clear",
            elapsedSeconds: r.sec,
          }).then((res) => setSubmit({ status: "done", isNewBest: res.isNewBest }));
        })
        .catch((e: unknown) => setSubmit({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    }

    /** 箱の中のピース(と extra)を全部取り出し、ランダムな順番で落とし直す。落とし終えるまでの見込み時間(ms)を返す */
    function startRestack(extra: Piece[] = []) {
      const all = [...pieces.values()];
      for (const p of all) {
        Matter.Composite.remove(engine.world, p.body);
        pieces.delete(p.body.id);
      }
      restackQueue = shuffle([...all, ...extra]);
      pending = [];
      restackNextAt = 0;
      return restackQueue.length * RESTACK_INTERVAL_MS;
    }

    restackRef.current = () => {
      if (ended || restackQueue.length || !pieces.size) return 0;
      restacks++;
      popups.push({ x: W / 2, y: RIM_Y - 30, text: `積み直し -${RESTACK_PENALTY}`, at: performance.now() });
      const ms = startRestack();
      publishHud();
      return ms;
    };

    /**
     * かたまりを2つに割る地域の分け方。重心を通り、かたまりの長い方向に直角な線で切る(輪なら重心は
     * だいたい穴のあたりに来るので、2つのC字に分かれて輪が開く)。切った片側が地続きでなければ、
     * つながっている部分ごとに分かれるので、2つより多くなることもある
     */
    function splitRegions(ids: number[]): number[][] {
      const regs = ids.map((id) => regions[id]);
      const total = regs.reduce((sum, r) => sum + r.area, 0);
      const mx = regs.reduce((sum, r) => sum + r.cx * r.area, 0) / total;
      const my = regs.reduce((sum, r) => sum + r.cy * r.area, 0) / total;
      let sxx = 0, sxy = 0, syy = 0;
      for (const r of regs) {
        const dx = r.cx - mx, dy = r.cy - my;
        sxx += r.area * dx * dx; sxy += r.area * dx * dy; syy += r.area * dy * dy;
      }
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // 長い方向(主軸)
      const proj = new Map(regs.map((r) => [r.id, (r.cx - mx) * Math.cos(theta) + (r.cy - my) * Math.sin(theta)]));
      let sideA = ids.filter((id) => proj.get(id)! < 0);
      if (!sideA.length || sideA.length === ids.length) {
        // 偏っていて片側が空になる場合は、真ん中の順位で分ける
        const sorted = ids.slice().sort((a, b) => proj.get(a)! - proj.get(b)!);
        sideA = sorted.slice(0, Math.floor(sorted.length / 2));
      }
      const inA = new Set(sideA);
      const sides = [sideA, ids.filter((id) => !inA.has(id))];
      const parts: number[][] = [];
      for (const side of sides) {
        const left = new Set(side);
        for (const start of side) {
          if (!left.has(start)) continue;
          const comp: number[] = [];
          const stack = [start];
          left.delete(start);
          while (stack.length) {
            const x = stack.pop()!;
            comp.push(x);
            for (const o of adjacency[x]) if (left.has(o)) { left.delete(o); stack.push(o); }
          }
          parts.push(comp);
        }
      }
      // 細かい部分は、隣り合う部分のうち接している地域が一番多いものにくっつける(2つは残す)
      const minPart = Math.max(SPLIT_MIN_PART, Math.ceil(ids.length * SPLIT_MIN_PART_RATIO));
      while (parts.length > 2) {
        parts.sort((a, b) => a.length - b.length);
        const small = parts[0];
        if (small.length >= minPart) break;
        const smallSet = new Set(small);
        let best = -1, bestLinks = 0;
        for (let k = 1; k < parts.length; k++) {
          const links = parts[k].filter((id) => [...adjacency[id]].some((o) => smallSet.has(o))).length;
          if (links > bestLinks) { best = k; bestLinks = links; }
        }
        if (best < 0) break;
        parts[best] = parts[best].concat(small);
        parts.shift();
      }
      return parts;
    }

    splitRef.current = () => {
      if (ended || restackQueue.length) return 0;
      let biggest: Piece | null = null;
      for (const p of pieces.values()) if (!biggest || p.regionIds.length > biggest.regionIds.length) biggest = p;
      if (!biggest || biggest.regionIds.length < 2) return 0;
      Matter.Composite.remove(engine.world, biggest.body);
      pieces.delete(biggest.body.id);
      const tag = ++splitSeq;
      const parts = splitRegions(biggest.regionIds).map((ids) => {
        const part = buildPiece(ids, Math.random() * Math.PI * 2);
        part.splitTag = tag;
        blockedSplitTag = tag;
        splitBlockUntil = Infinity; // 積み直しを落とし終えたら期限を決める(feedRestack)
        return part;
      });
      splits++;
      popups.push({ x: W / 2, y: RIM_Y - 30, text: `割って積み直し -${SPLIT_PENALTY}`, at: performance.now() });
      const ms = startRestack(parts);
      publishHud();
      return ms;
    };

    /** 積み直し待ちのピースを1つずつ落とし直す */
    function feedRestack(now: number) {
      if (!restackQueue.length || now < restackNextAt) return;
      const p = restackQueue.shift()!;
      Matter.Body.setAngle(p.body, Math.random() * Math.PI * 2);
      const b = p.body.bounds, pos = p.body.position;
      const left = pos.x - b.min.x, right = b.max.x - pos.x;
      const minX = BOX_L + left + 1, maxX = Math.max(minX, BOX_R - right - 1);
      const nb = neighborsOf(p);
      const near = [...pieces.values()].filter((q) => q.regionIds.some((o) => nb.has(o)));
      const x = near.length && Math.random() < RESTACK_AIM
        ? near[Math.floor(Math.random() * near.length)].body.position.x
        : minX + Math.random() * (maxX - minX);
      const sx = Math.min(Math.max(x, minX), maxX);
      Matter.Body.setPosition(p.body, { x: sx, y: clearSpawnY(p.body, sx, RIM_Y - (b.max.y - pos.y) - 6) });
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(p.body, 0);
      p.nextHopAt = 0;
      Matter.Composite.add(engine.world, p.body);
      pieces.set(p.body.id, p);
      restackNextAt = now + RESTACK_INTERVAL_MS;
      if (!restackQueue.length && splitBlockUntil === Infinity) splitBlockUntil = now + SPLIT_BLOCK_MS;
    }

    giveUpRef.current = () => {
      if (ended) return;
      const sec = startAt === null ? 0 : Math.round((performance.now() - startAt) / 1000);
      finish({ kind: "giveup", score: currentScore(), bonus: 0, sec, largest: largestCount() });
    };

    // ----- 描画 -----
    let viewScale = 1;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    function resize() {
      const cssW = Math.max(200, Math.min(wrap.clientWidth, ((window.innerHeight - RESERVED_HEIGHT_PX) * W) / H));
      viewScale = cssW / W;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssW * (H / W)}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssW * (H / W) * dpr);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);

    function drawPiece(piece: Piece, alpha = 1, targets?: Set<number>, pulse = 0) {
      const { body } = piece;
      const hit = targets ? piece.regionIds.map((id) => targets.has(id)) : null;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.fillStyle = piece.fill;
      ctx.strokeStyle = piece.stroke;
      ctx.lineWidth = 0.8;
      ctx.lineJoin = "round";
      for (const path of piece.paths) { ctx.fill(path); ctx.stroke(path); }
      if (hit?.some(Boolean)) {
        ctx.fillStyle = `rgba(245,158,11,${0.3 + 0.25 * pulse})`;
        ctx.strokeStyle = "#d97706";
        ctx.lineWidth = 2;
        piece.paths.forEach((path, i) => { if (hit[i]) { ctx.fill(path); ctx.stroke(path); } });
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      const c = Math.cos(body.angle), s = Math.sin(body.angle);
      const put = (text: string, lx: number, ly: number) => {
        const x = body.position.x + lx * c - ly * s;
        const y = body.position.y + lx * s + ly * c;
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      };
      // くっつく相手の地域は大きさにかかわらず地名を出すので、通常のラベルからは外す
      const hitNames = new Set(hit ? piece.regionIds.filter((_, i) => hit[i]).map((id) => regions[id].name) : []);
      ctx.fillStyle = "#3c2a14";
      for (const l of piece.labels) {
        if (hitNames.has(l.text)) continue;
        ctx.font = `bold ${l.size}px sans-serif`;
        put(l.text, l.x, l.y);
      }
      if (hit) {
        ctx.font = "bold 10px sans-serif";
        ctx.fillStyle = "#b45309";
        const done = new Set<string>();
        piece.regionIds.forEach((id, i) => {
          const name = regions[id].name;
          if (!hit[i] || done.has(name)) return;
          done.add(name);
          put(name, piece.centers[i].x, piece.centers[i].y);
        });
      }
      ctx.restore();
    }

    function draw(now: number) {
      ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 箱
      ctx.fillStyle = "#fffaf2";
      ctx.fillRect(BOX_L, RIM_Y, BW, BH);
      ctx.strokeStyle = "#c8b8a0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(BOX_L - 1.5, RIM_Y);
      ctx.lineTo(BOX_L - 1.5, FLOOR_Y + 1.5);
      ctx.lineTo(BOX_R + 1.5, FLOOR_Y + 1.5);
      ctx.lineTo(BOX_R + 1.5, RIM_Y);
      ctx.stroke();

      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      for (const p of pieces.values()) drawPiece(p, 1, hover && !ended ? hoverTargets : undefined, pulse);

      if (hover && !ended) {
        const pos = hoverPosition(hover);
        Matter.Body.setPosition(hover.body, pos);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(120,90,40,0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pos.x, hover.body.bounds.max.y);
        ctx.lineTo(pos.x, FLOOR_Y);
        ctx.stroke();
        ctx.restore();
        drawPiece(hover, now < nextHoverAt + 150 ? 0.5 : 1);
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const t = (now - f.at) / FLASH_MS;
        if (t >= 1) { flashes.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (0.6 + 0.6 * t), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        const t = (now - p.at) / POPUP_MS;
        if (t >= 1) { popups.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - t * t;
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        ctx.fillStyle = "#d97706";
        const y = p.y - 24 * t;
        ctx.strokeText(p.text, p.x, y);
        ctx.fillText(p.text, p.x, y);
        ctx.restore();
      }
    }

    // ----- ループ -----
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    function frame(now: number) {
      acc += Math.min(now - last, 100);
      last = now;
      while (acc >= STEP_MS) {
        for (let i = 0; i < SUBSTEPS; i++) {
          liftTargets(now); // 力は Engine.update のたびにリセットされるので、毎回かけ直す
          Matter.Engine.update(engine, STEP_MS / SUBSTEPS);
        }
        processMerges(now);
        hopPieces(now);
        feedRestack(now);
        feedBatch(now);
        acc -= STEP_MS;
      }
      draw(now);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    // ----- 中断・再開 -----
    function takeSnapshot(): MapPackSnapshot | null {
      if (!dropped) return null;
      const round2 = (v: number) => Math.round(v * 100) / 100;
      return {
        version: 1,
        pieces: [
          ...[...pieces.values()].map((p) => ({
            ids: p.regionIds,
            x: round2(p.body.position.x),
            y: round2(p.body.position.y),
            angle: round2(p.body.angle),
            ...(p.splitTag !== null && { tag: p.splitTag }),
          })),
          ...restackQueue.map((p) => ({
            ids: p.regionIds,
            angle: round2(p.body.angle),
            ...(p.splitTag !== null && { tag: p.splitTag }),
          })),
        ],
        // 構えていたピースは出題順の先頭に戻す
        queue: hover ? [hover.regionIds[0], ...queue] : queue.slice(),
        queueGroupSize,
        remainingGroups: [...remainingGroups],
        dropped,
        mergePoints,
        restacks,
        splits,
        joined: Array.from(joined),
        elapsedSec: startAt === null ? 0 : Math.floor((performance.now() - startAt) / 1000),
      };
    }
    snapshotRef.current = () => (ended ? null : takeSnapshot());

    function restore(snap: MapPackSnapshot) {
      const valid = (ids: number[]) => ids.every((id) => Number.isInteger(id) && id >= 0 && id < regions.length);
      // 地図データが変わっていて合わない保存は使わない
      if (!snap.pieces.every((p) => valid(p.ids)) || !valid(snap.queue)) return;
      remainingGroups.clear();
      for (const g of snap.remainingGroups) if (g >= 0 && g < groups.length) remainingGroups.add(g);
      queue = snap.queue.slice();
      queueGroupSize = snap.queueGroupSize;
      dropped = snap.dropped;
      mergePoints = snap.mergePoints;
      restacks = snap.restacks;
      splits = snap.splits ?? 0;
      if (snap.joined?.length === regions.length && valid(snap.joined)) joined.set(snap.joined);
      else for (const sp of snap.pieces) for (const id of sp.ids) joined[joinedRoot(id)] = joinedRoot(sp.ids[0]);
      for (const sp of snap.pieces) {
        const piece = buildPiece(sp.ids, sp.angle);
        if (sp.tag !== undefined) {
          piece.splitTag = sp.tag;
          splitSeq = Math.max(splitSeq, sp.tag);
        }
        if (sp.x === undefined || sp.y === undefined) {
          restackQueue.push(piece); // 積み直し待ちだったピースは落とし直す
          continue;
        }
        Matter.Body.setPosition(piece.body, { x: sp.x, y: sp.y });
        Matter.Composite.add(engine.world, piece.body);
        pieces.set(piece.body.id, piece);
      }
      if (dropped) startAt = performance.now() - snap.elapsedSec * 1000;
    }
    if (initialSnapshot) restore(initialSnapshot);

    const sessionKey = mapPackSessionKey(area.difficulty, geojsonUrl);
    function saveToSession() {
      const snapshot = ended ? null : takeSnapshot();
      if (!snapshot) return;
      const save: MapPackSessionSave = { snapshot, geojsonUrl, areaLabel, area, updatedAt: Date.now() };
      try {
        window.sessionStorage.setItem(sessionKey, JSON.stringify(save));
      } catch {
        // 保存領域が使えない環境は無視
      }
    }
    const autoSave = setInterval(saveToSession, AUTO_SAVE_MS);
    window.addEventListener("pagehide", saveToSession);

    spawnHover(performance.now());

    const timer = setInterval(() => {
      if (startAt !== null && !ended) setElapsed(Math.floor((performance.now() - startAt) / 1000));
    }, 250);

    // ----- 操作: 指(マウス)の横位置で狙い、離したら落とす -----
    const toWorldX = (e: PointerEvent) => (e.clientX - canvas.getBoundingClientRect().left) / viewScale;
    let pressing = false;
    const aimAt = (e: PointerEvent) => {
      const x = toWorldX(e);
      if (x !== aimX) aimedSinceSpawn = true;
      aimX = x;
    };
    const onDown = (e: PointerEvent) => { pressing = true; aimAt(e); canvas.setPointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => { aimAt(e); };
    const onUp = (e: PointerEvent) => {
      if (!pressing) return;
      pressing = false;
      aimX = toWorldX(e);
      drop(performance.now());
    };
    const onCancel = () => { pressing = false; };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      Matter.Events.off(engine, "collisionStart", onCollision);
      Matter.Events.off(engine, "collisionActive", onCollision);
      Matter.Engine.clear(engine);
      clearInterval(autoSave);
      window.removeEventListener("pagehide", saveToSession);
      ended = true; // 保留中の setTimeout から次のピースを出さない
    };
  }, [data, area, geojsonUrl, areaLabel, initialSnapshot]);

  /** やり直すときは中断の保存も消す(残っているとページを開き直したときに古い続きが出てくる) */
  const restart = () => {
    clearMapPackSessionSaves(area.difficulty, geojsonUrl);
    discardMapPackProgress(area).catch(() => {});
    onRestart();
  };

  /** 中断: ログインしていればサーバーに保存(別の端末からも再開できる)、していなければ同じタブにだけ残す */
  const saveAndExit = async () => {
    if (saving === "saving") return;
    const snapshot = snapshotRef.current();
    if (!snapshot) {
      onSaveAndExit?.();
      return;
    }
    setSaving("saving");
    try {
      if (await currentUserId()) {
        await saveMapPackProgress(area, snapshot);
        clearMapPackSessionSaves(area.difficulty, geojsonUrl);
      } else {
        const save: MapPackSessionSave = { snapshot, geojsonUrl, areaLabel, area, updatedAt: Date.now() };
        window.sessionStorage.setItem(mapPackSessionKey(area.difficulty, geojsonUrl), JSON.stringify(save));
      }
      onSaveAndExit?.();
    } catch {
      setSaving("error");
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="w-full max-w-[420px] flex items-end justify-between px-1 mb-2 text-[#3c2a14]">
        <div>
          <p className="text-xs text-[#a8937a]">いま落とす{unitLabel}</p>
          <p className="font-bold text-lg leading-tight min-h-[1.75rem]">
            {hud.hover ? hud.hover.name : "…"}
            {hud.hover && hud.hover.total > 1 && (
              <span className="ml-1 text-xs font-normal text-[#78716c]">
                （{hud.hover.index}/{hud.hover.total}）
              </span>
            )}
          </p>
        </div>
        <div className="text-right text-xs text-[#78716c] leading-relaxed">
          <p className="font-bold text-base text-[#d97706]">{hud.score.toLocaleString()} 点</p>
          <p>落とした {hud.dropped} / {hud.total}・最大 {hud.largest} {unitLabel}</p>
          <p>⏱ {formatTime(result ? result.sec : elapsed)}</p>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full max-w-[420px]">
        <canvas ref={canvasRef} className="block mx-auto touch-none select-none" />
        {result && !resultHidden && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#fdf8f0]/70">
            <div className="relative bg-white rounded-2xl shadow-[0_4px_20px_rgba(120,90,40,0.15)] px-6 py-5 text-center min-w-[220px]">
              <button
                type="button"
                onClick={() => setResultHidden(true)}
                className="absolute top-2 right-3 text-xl leading-none text-[#a8937a] hover:text-[#3c2a14]"
                title="閉じて地図を見る"
                aria-label="閉じて地図を見る"
              >
                ×
              </button>
              <p className="text-3xl mb-1">{result.kind === "clear" ? "🎉" : "🏳️"}</p>
              <p className="font-bold text-[#3c2a14]">
                {result.kind === "clear" ? `${areaLabel} 完成！` : "ここまで"}
              </p>
              <p className="text-2xl font-bold text-[#d97706] mt-2">{result.score.toLocaleString()} 点</p>
              <div className="text-xs text-[#78716c] mt-2 leading-relaxed">
                {result.bonus > 0 && <p>（完成ボーナス {result.bonus.toLocaleString()} 点を含む）</p>}
                <p>タイム {formatTime(result.sec)}・最大のかたまり {result.largest} / {hud.total} {unitLabel}</p>
              </div>
              <div className="text-xs mt-2 min-h-[1rem]">
                {submit?.status === "sending" && <p className="text-[#a8937a]">記録しています…</p>}
                {submit?.status === "done" && (
                  <p className="text-teal-700 font-semibold">{submit.isNewBest ? "🏆 自己ベスト更新！" : "記録しました"}</p>
                )}
                {submit?.status === "guest" && (
                  <p className="text-[#78716c]">
                    <Link href="/login" className="underline underline-offset-2 text-teal-700">ログイン</Link>
                    するとランキングに参加できます
                  </p>
                )}
                {submit?.status === "error" && <p className="text-red-600">記録できませんでした（{submit.message}）</p>}
              </div>
              <button
                type="button"
                onClick={onRestart}
                className="mt-4 px-5 py-2 rounded-full bg-teal-600 text-white text-sm font-bold active:scale-[0.97]"
              >
                もう一回
              </button>
              <a
                href={xShareUrl(
                  result.kind === "clear"
                    ? `地図ポットンで「${areaLabel}」の${hud.total}${unitLabel}をくっつけて完成！ ${result.score.toLocaleString()}点（タイム ${formatTime(result.sec)}）`
                    : `地図ポットンで「${areaLabel}」に挑戦！ ${result.score.toLocaleString()}点（最大のかたまり ${result.largest}/${hud.total}${unitLabel}）`,
                  absoluteUrl(mapPackPlayHref(area)),
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block px-5 py-2 rounded-full bg-black text-white text-sm font-bold active:scale-[0.97]"
              >
                𝕏 でシェア
              </a>
              <p className="mt-3">
                <Link href={mapPackAreaRankingHref(area)} className="text-xs text-[#78716c] underline underline-offset-2">
                  🏆 このエリアのランキング
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
        {result && resultHidden && (
          <button
            type="button"
            onClick={() => setResultHidden(false)}
            className="px-4 py-1.5 rounded-full bg-teal-600 text-white text-sm font-bold active:scale-[0.97]"
          >
            🏆 結果を見る
          </button>
        )}
        {batchSizeFor(hud.total) > 0 && (
          <button
            type="button"
            disabled={result !== null || !hud.hover}
            onClick={() => batchRef.current()}
            className="px-4 py-1.5 rounded-full border border-amber-300 text-sm text-amber-700 bg-white active:scale-[0.97] disabled:opacity-40"
          >
            ⏬ {batchSizeFor(hud.total)}個まとめて落とす
          </button>
        )}
        <button
          type="button"
          disabled={result !== null || restacking}
          onClick={() => {
            const ms = restackRef.current();
            if (!ms) return;
            setRestacking(true);
            setTimeout(() => setRestacking(false), ms + 500);
          }}
          className="px-4 py-1.5 rounded-full border border-teal-300 text-sm text-teal-700 bg-white active:scale-[0.97] disabled:opacity-40"
        >
          🧱 積み直す<span className="ml-1 text-[10px]">-{RESTACK_PENALTY}点</span>
        </button>
        <button
          type="button"
          disabled={result !== null || restacking || hud.largest < 2}
          onClick={() => {
            const ms = splitRef.current();
            if (!ms) return;
            setRestacking(true);
            setTimeout(() => setRestacking(false), ms + 500);
          }}
          className="px-4 py-1.5 rounded-full border border-rose-300 text-sm text-rose-700 bg-white active:scale-[0.97] disabled:opacity-40"
        >
          ✂️ 割って積み直す<span className="ml-1 text-[10px]">-{SPLIT_PENALTY}点</span>
        </button>
        <button
          type="button"
          disabled={result !== null || saving === "saving"}
          onClick={saveAndExit}
          className="px-4 py-1.5 rounded-full border border-sky-300 text-sm text-sky-700 bg-white active:scale-[0.97] disabled:opacity-40"
        >
          {saving === "saving" ? "保存中…" : "💾 中断"}
        </button>
        <button
          type="button"
          onClick={() => (hud.dropped === 0 || result ? restart() : confirmThen("restart", restart))}
          className={`px-4 py-1.5 rounded-full border text-sm active:scale-[0.97] ${
            confirming === "restart" ? "border-red-400 bg-red-50 text-red-700 font-bold" : "border-[#c8b8a0] bg-white text-[#78716c]"
          }`}
        >
          {confirming === "restart" ? "本当にやり直す？" : "↺ やり直す"}
        </button>
        <button
          type="button"
          disabled={result !== null}
          onClick={() => confirmThen("giveup", () => giveUpRef.current())}
          className={`px-4 py-1.5 rounded-full border text-sm active:scale-[0.97] disabled:opacity-40 ${
            confirming === "giveup" ? "border-red-400 bg-red-50 text-red-700 font-bold" : "border-[#c8b8a0] bg-white text-[#78716c]"
          }`}
        >
          {confirming === "giveup" ? "本当にあきらめる？" : "🏳️ あきらめる"}
        </button>
      </div>

      {saving === "error" && (
        <p className="text-xs text-red-600 mt-2">保存できませんでした。通信環境を確かめて、もう一度お試しください</p>
      )}

      <p className="text-xs text-[#a8937a] mt-3">左右に動かして狙い、指を離す（クリックする）と落ちます</p>
    </div>
  );
}
