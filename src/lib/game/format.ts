import type { Difficulty } from "@/components/game/map-puzzle/MapPuzzleGame";

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "初級",
  intermediate: "中級",
  advanced: "上級",
};

export const DIFFICULTY_BADGE_CLASS: Record<Difficulty, string> = {
  beginner: "bg-amber-100 text-amber-700 border border-amber-200",
  intermediate: "bg-violet-100 text-violet-700 border border-violet-200",
  advanced: "bg-teal-100 text-teal-700 border border-teal-200",
};

export const DIFFICULTY_THEME_COLOR: Record<Difficulty, string> = {
  beginner: "#2563eb",
  intermediate: "#7c3aed",
  advanced: "#0f766e",
};

export function areaLabelOf(area: { prefName: string; cityName?: string }): string {
  return area.cityName ? `${area.prefName} ${area.cityName}` : area.prefName;
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "たった今";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}日前`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}ヶ月前`;
  return `${Math.floor(diffDay / 365)}年前`;
}

export function formatDuration(sec: number): string {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
