import "server-only";

// 市区町村図鑑クイズの出題生成ロジック(サーバー専用)。
//
// 3つの外部データソースを合成して出題する:
// - CloudFront配信のgeojson(既存の地図パズルと同じ): ポリゴン形状 + prefCode/cityCode/cityName
// - stat.usapo.net(国勢調査統計API): 人口・世帯数(市区町村単位は hyosyo===1 の要素)
// - CloudFront配信のトリビアJSON(本体側 team-kokuusa-platform-frontend の管理画面で登録・
//   公開されたもの。/municipality-trivia/{prefCode}.json。詳細は本体側の
//   docs/municipality-trivia-management-design.md 参照)。出題対象はこのトリビアが
//   1項目以上登録されている自治体のみに限定する
//
// 正答(対象自治体そのもの)はここで組み立てるが、クライアントには絶対に渡さない
// (Route Handler側でDBのgame_zukan_quiz_sessionsに保存し、選択肢としてのみ名前を渡す)。

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";
const STAT_API_URL = "https://stat.usapo.net";

// 国勢調査データは年度単位でほぼ更新されないため、外部APIへの負荷軽減のため長めにキャッシュする
const REVALIDATE_SECONDS = 60 * 60 * 24 * 7;

// トリビアは本体側の管理画面から随時追加・編集される運用中のデータのため、
// 統計データより大幅に短いキャッシュ期間にする
const TRIVIA_REVALIDATE_SECONDS = 60 * 5;

// 難易度は地図パズルと同じスラッグ(beginner/intermediate/advanced)を使う
export type ZukanQuizDifficulty = "beginner" | "intermediate" | "advanced";

export interface MunicipalityRef {
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
}

export interface MunicipalityStats {
  population: number;
  households: number;
}

export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

interface CloudFrontMunicipalityFeature {
  type: "Feature";
  properties: {
    prefCode: string;
    prefName: string;
    cityCode: string;
    cityName: string;
  };
  geometry: GeoJsonGeometry;
}

export const ALL_PREF_CODES = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, "0"));

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── 外部データ取得(キャッシュ付き) ────────────────────────────────────────────

const municipalityCache = new Map<string, Promise<{ features: CloudFrontMunicipalityFeature[] }>>();

function fetchPrefectureGeojson(prefCode: string): Promise<{ features: CloudFrontMunicipalityFeature[] }> {
  let promise = municipalityCache.get(prefCode);
  if (!promise) {
    promise = fetch(`${CLOUDFRONT_URL}/geojson/municipality/2020/${prefCode}.geojson`, {
      next: { revalidate: REVALIDATE_SECONDS },
    }).then((res) => {
      if (!res.ok) throw new Error(`municipality geojson fetch failed: ${prefCode} (${res.status})`);
      return res.json();
    });
    municipalityCache.set(prefCode, promise);
  }
  return promise;
}

export async function fetchMunicipalities(prefCode: string): Promise<MunicipalityRef[]> {
  const data = await fetchPrefectureGeojson(prefCode);
  return data.features.map((f) => ({ ...f.properties }));
}

export async function fetchMunicipalityGeometry(prefCode: string, cityCode: string): Promise<GeoJsonGeometry | null> {
  const data = await fetchPrefectureGeojson(prefCode);
  const feature = data.features.find((f) => f.properties.cityCode === cityCode);
  return feature?.geometry ?? null;
}

interface CensusPopulationResponse {
  areas: Array<{ hyosyo: number; 人口総数?: number; 世帯総数?: number }>;
}

export async function fetchPopulationStats(prefCode: string, cityCode: string): Promise<MunicipalityStats | null> {
  try {
    const res = await fetch(`${STAT_API_URL}/statistics/census/2020/population/${prefCode}/${cityCode}.json`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const data: CensusPopulationResponse = await res.json();
    const total = data.areas.find((a) => a.hyosyo === 1);
    if (!total || total["人口総数"] == null || total["世帯総数"] == null) return null;
    return { population: total["人口総数"], households: total["世帯総数"] };
  } catch {
    return null;
  }
}

// ─── トリビア取得(CloudFront配信、本体側管理画面で公開されたもの) ──────────────────

interface CloudFrontTriviaMunicipality {
  cityCode: string;
  cityName: string;
  industry: string | null;
  specialty: string | null;
  historicalEvent: string | null;
  touristSpot: string | null;
  notablePerson: string | null;
  festival: string | null;
  natureFeature: string | null;
  localCuisine: string | null;
}

interface CloudFrontTriviaFile {
  prefCode: string;
  prefName: string;
  updatedAt: string;
  municipalities: CloudFrontTriviaMunicipality[];
}

async function fetchPrefectureTrivia(prefCode: string): Promise<CloudFrontTriviaMunicipality[]> {
  try {
    const res = await fetch(`${CLOUDFRONT_URL}/municipality-trivia/${prefCode}.json`, {
      next: { revalidate: TRIVIA_REVALIDATE_SECONDS },
    });
    // トリビアが1件も公開されていない都道府県は404になる(まだ登録が無いだけで正常)
    if (!res.ok) return [];
    const data: CloudFrontTriviaFile = await res.json();
    return data.municipalities ?? [];
  } catch {
    return [];
  }
}

// 47都道府県分のトリビアJSONを取得し、出題候補の一覧にする。
// 未公開の都道府県は単に候補に含まれないだけなので、追加公開されれば自動的に出題対象が広がる
export async function fetchTriviaCandidates(): Promise<QuizTargetCandidate[]> {
  const perPrefecture = await Promise.all(
    ALL_PREF_CODES.map(async (prefCode) => ({
      prefCode,
      municipalities: await fetchPrefectureTrivia(prefCode),
    }))
  );

  return perPrefecture.flatMap(({ prefCode, municipalities }) =>
    municipalities.map((m) => ({
      prefCode,
      cityCode: m.cityCode,
      industry: m.industry,
      specialty: m.specialty,
      historicalEvent: m.historicalEvent,
      touristSpot: m.touristSpot,
      notablePerson: m.notablePerson,
      festival: m.festival,
      natureFeature: m.natureFeature,
      localCuisine: m.localCuisine,
    }))
  );
}

// ─── ダミー選択肢の生成 ────────────────────────────────────────────────────────
//
// 決定した基準(ふつう=intermediateの場合):
// 1. 同一都道府県内から、人口が対象の概ね1/3〜3倍のレンジに収まるものを優先候補にする
// 2. 候補が3件に満たない場合は、レンジを1/10〜10倍→無制限、の順に広げる
// 3. それでも3件集まらない場合(同一都道府県内の統計データが薄い場合)は、
//    別の都道府県からも候補を補充する
// (地理的近さは「同一都道府県」を代理指標として使い、重心間の距離計算などは行わない)
//
// 難易度による違い: かんたんは人口の近さを問わず選ぶ(結果的に見分けやすくなる)、
// むずかしいはより近い人口を優先するレンジから試す(見分けにくくする)。
//
// むずかしいのダミー選択肢を全国(同一都道府県を除外)から選ぶ方式を一時試したが、
// ダミー3件がたまたま同じ他都道府県に偏り、「他の3件と明らかに毛色が違う1件」が
// 正答として一目で分かってしまう問題が発生した(ユーザーからのフィードバック、2026-08-02)。
// そのため選択肢の選び方自体は他の難易度と同じ「同一都道府県優先」に戻した
// (むずかしい固有の変更である「ヒント無し・トリビア登録の有無を問わず全自治体が出題対象」
// は維持。詳細はCLAUDE.mdの該当セクション参照)

const POPULATION_BAND_RATIOS_BY_DIFFICULTY: Record<ZukanQuizDifficulty, number[]> = {
  beginner: [Infinity],
  intermediate: [3, 10, Infinity],
  advanced: [1.5, 3, 10, Infinity],
};
const PROBE_SAMPLE_SIZE = 40;

interface CandidateWithStats extends MunicipalityRef {
  stats: MunicipalityStats;
}

async function probeCandidateStats(candidates: MunicipalityRef[]): Promise<CandidateWithStats[]> {
  const probe = candidates.length > PROBE_SAMPLE_SIZE ? shuffle(candidates).slice(0, PROBE_SAMPLE_SIZE) : candidates;
  const results = await Promise.all(
    probe.map(async (ref) => {
      const stats = await fetchPopulationStats(ref.prefCode, ref.cityCode);
      return stats ? { ...ref, stats } : null;
    })
  );
  return results.filter((r): r is CandidateWithStats => r !== null);
}

function pickWithinBand(pool: CandidateWithStats[], targetPopulation: number, ratio: number): CandidateWithStats[] {
  if (ratio === Infinity) return pool;
  const lower = targetPopulation / ratio;
  const upper = targetPopulation * ratio;
  return pool.filter((c) => c.stats.population >= lower && c.stats.population <= upper);
}

async function pickDummyChoices(
  target: MunicipalityRef & { stats: MunicipalityStats },
  samePrefCandidates: MunicipalityRef[],
  difficulty: ZukanQuizDifficulty
): Promise<MunicipalityRef[]> {
  const pool = await probeCandidateStats(samePrefCandidates);

  for (const ratio of POPULATION_BAND_RATIOS_BY_DIFFICULTY[difficulty]) {
    const matched = pickWithinBand(pool, target.stats.population, ratio);
    if (matched.length >= 3) {
      return shuffle(matched).slice(0, 3);
    }
  }

  // 同一都道府県内だけでは3件集まらない(統計データが薄い)場合、別の都道府県から補充する
  const supplement: CandidateWithStats[] = [...pool];
  let guard = 0;
  while (supplement.length < 3 && guard < 5) {
    guard++;
    const otherPrefCode = pickRandom(ALL_PREF_CODES.filter((c) => c !== target.prefCode));
    const others = (await fetchMunicipalities(otherPrefCode)).filter((m) => m.cityCode !== target.cityCode);
    const otherPool = await probeCandidateStats(others);
    for (const c of otherPool) {
      if (supplement.length >= 3) break;
      if (!supplement.some((s) => s.prefCode === c.prefCode && s.cityCode === c.cityCode)) {
        supplement.push(c);
      }
    }
  }

  if (supplement.length < 3) {
    throw new Error("ダミー選択肢の生成に失敗しました(統計データが不足しています)");
  }
  return shuffle(supplement).slice(0, 3);
}

// ─── 出題生成 ──────────────────────────────────────────────────────────────────

export interface ZukanQuizChoice {
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
}

export interface ZukanQuizTrivia {
  industry: string | null;
  specialty: string | null;
  historicalEvent: string | null;
  touristSpot: string | null;
  notablePerson: string | null;
  festival: string | null;
  natureFeature: string | null;
  localCuisine: string | null;
}

export interface ZukanQuizAnswer {
  prefCode: string;
  prefName: string;
  cityCode: string;
  cityName: string;
  population: number;
  households: number;
}

export interface ZukanQuizQuestion {
  silhouette: GeoJsonGeometry;
  choices: ZukanQuizChoice[];
  trivia: ZukanQuizTrivia;
  population: number;
  households: number;
}

export interface GeneratedZukanQuiz {
  question: ZukanQuizQuestion;
  answer: ZukanQuizAnswer;
}

// 出題対象の候補(トリビア登録済みの自治体)。シルエットのみでは出題が難しすぎるという
// フィードバックを受け、正答前のヒントとして8種類のトリビアを出せる自治体に限定して
// 出題する(トリビアデータが無い自治体は出題しない)。
// ただしむずかしいだけは例外で、ヒントを出さない代わりにトリビア登録の有無を問わず
// 全自治体を出題対象にする(fetchMunicipalityCandidatesForPrefecture参照)
export interface QuizTargetCandidate {
  prefCode: string;
  cityCode: string;
  industry: string | null;
  specialty: string | null;
  historicalEvent: string | null;
  touristSpot: string | null;
  notablePerson: string | null;
  festival: string | null;
  natureFeature: string | null;
  localCuisine: string | null;
}

// むずかしい用: トリビア登録の有無を問わず、都道府県を1つランダムに選んでその中の
// 全自治体を出題候補にする(trivia系フィールドは使わないため全てnullで埋める)。
// 47都道府県ぶんを毎回まとめて取得する実装を最初に試したが、東京都・熊本県など
// geojsonが2MBを超える都道府県はNext.jsのData Cacheに乗らずリクエストのたびに
// 再取得することになり、実機検証でdev serverをクラッシュさせる負荷になることが
// 判明したため、1リクエストあたり1都道府県分のみ取得する方式に変更した
export async function fetchMunicipalityCandidatesForPrefecture(prefCode: string): Promise<QuizTargetCandidate[]> {
  const municipalities = await fetchMunicipalities(prefCode);
  return municipalities.map((m) => ({
    prefCode: m.prefCode,
    cityCode: m.cityCode,
    industry: null,
    specialty: null,
    historicalEvent: null,
    touristSpot: null,
    notablePerson: null,
    festival: null,
    natureFeature: null,
    localCuisine: null,
  }));
}

// ヒントを全部出すと簡単すぎるため、登録済みトリビアのうち難易度別の件数だけランダムに見せる。
// むずかしいはトリビア登録の有無を問わず全自治体から出題するため、そもそもヒントを一切出さない
const MAX_TRIVIA_HINTS_BY_DIFFICULTY: Record<ZukanQuizDifficulty, number> = {
  beginner: 5,
  intermediate: 3,
  advanced: 0,
};

function pickTriviaSubset(trivia: ZukanQuizTrivia, max: number): ZukanQuizTrivia {
  const entries = Object.entries(trivia) as [keyof ZukanQuizTrivia, string | null][];
  const filledKeys = entries.filter(([, value]) => value != null).map(([key]) => key);
  const chosenKeys = new Set(shuffle(filledKeys).slice(0, max));

  const result = {} as ZukanQuizTrivia;
  for (const [key, value] of entries) {
    result[key] = chosenKeys.has(key) ? value : null;
  }
  return result;
}

async function buildZukanQuizQuestion(
  candidate: QuizTargetCandidate,
  difficulty: ZukanQuizDifficulty
): Promise<GeneratedZukanQuiz | null> {
  const municipalities = await fetchMunicipalities(candidate.prefCode);
  const target = municipalities.find((m) => m.cityCode === candidate.cityCode);
  if (!target) return null;

  const stats = await fetchPopulationStats(candidate.prefCode, candidate.cityCode);
  if (!stats) return null;

  const geometry = await fetchMunicipalityGeometry(candidate.prefCode, candidate.cityCode);
  if (!geometry) return null;

  const samePrefCandidates = municipalities.filter((m) => m.cityCode !== target.cityCode);

  let dummies: MunicipalityRef[];
  try {
    dummies = await pickDummyChoices({ ...target, stats }, samePrefCandidates, difficulty);
  } catch {
    return null;
  }

  const choices = shuffle([
    { prefCode: target.prefCode, prefName: target.prefName, cityCode: target.cityCode, cityName: target.cityName },
    ...dummies.map((d) => ({ prefCode: d.prefCode, prefName: d.prefName, cityCode: d.cityCode, cityName: d.cityName })),
  ]);

  const fullTrivia: ZukanQuizTrivia = {
    industry: candidate.industry,
    specialty: candidate.specialty,
    historicalEvent: candidate.historicalEvent,
    touristSpot: candidate.touristSpot,
    notablePerson: candidate.notablePerson,
    festival: candidate.festival,
    natureFeature: candidate.natureFeature,
    localCuisine: candidate.localCuisine,
  };

  return {
    question: {
      silhouette: geometry,
      choices,
      trivia: pickTriviaSubset(fullTrivia, MAX_TRIVIA_HINTS_BY_DIFFICULTY[difficulty]),
      population: stats.population,
      households: stats.households,
    },
    answer: {
      prefCode: target.prefCode,
      prefName: target.prefName,
      cityCode: target.cityCode,
      cityName: target.cityName,
      population: stats.population,
      households: stats.households,
    },
  };
}

// candidatesはトリビア登録済み自治体の一覧(呼び出し側=Route Handlerが既にセッション内で
// 使用済みの自治体を除外してから渡す想定)。ジオメトリ・統計データの取得に失敗した候補は
// スキップして次の候補を試す
export async function generateZukanQuizQuestion(
  candidates: QuizTargetCandidate[],
  difficulty: ZukanQuizDifficulty
): Promise<GeneratedZukanQuiz> {
  const shuffled = shuffle(candidates);
  for (const candidate of shuffled) {
    const result = await buildZukanQuizQuestion(candidate, difficulty);
    if (result) return result;
  }

  throw new Error("問題の生成に失敗しました。もう一度お試しください");
}
