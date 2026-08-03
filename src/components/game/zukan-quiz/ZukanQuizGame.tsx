"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import MunicipalitySilhouette from "@/components/game/zukan-quiz/MunicipalitySilhouette";
import {
  startZukanQuiz,
  submitZukanQuizAnswer,
  type ZukanQuizChoice,
  type ZukanQuizQuestion,
  type ZukanQuizAnswerResult,
  type ZukanQuizDifficulty,
} from "@/lib/game/zukanQuizClient";
import { ZUKAN_DIFFICULTY_META } from "@/lib/game/zukanQuizDifficulty";
import { TRIVIA_FIELD_LABELS } from "@/lib/game/zukanQuizTrivia";

const QUESTIONS_PER_SESSION = 5;

interface RoundRecord {
  isCorrect: boolean;
  prefName: string;
  cityName: string;
}

type Status = "loading" | "answering" | "revealed" | "finished" | "error";

function choiceKey(c: { prefCode: string; cityCode: string }): string {
  return `${c.prefCode}-${c.cityCode}`;
}

interface Props {
  difficulty: ZukanQuizDifficulty;
}

export default function ZukanQuizGame({ difficulty }: Props) {
  const difficultyMeta = ZUKAN_DIFFICULTY_META[difficulty];
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState<Status>("loading");
  const [question, setQuestion] = useState<ZukanQuizQuestion | null>(null);
  const [selected, setSelected] = useState<ZukanQuizChoice | null>(null);
  const [result, setResult] = useState<ZukanQuizAnswerResult | null>(null);
  const [history, setHistory] = useState<RoundRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  // 同一セッション内で同じ自治体が再出題されないよう、出題済みの自治体を覚えておく
  const [usedCityKeys, setUsedCityKeys] = useState<string[]>([]);

  const loadQuestion = useCallback(() => {
    setStatus("loading");
    setSelected(null);
    setResult(null);
    startZukanQuiz(difficulty, usedCityKeys)
      .then((q) => {
        setQuestion(q);
        setStatus("answering");
      })
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : "問題の取得に失敗しました");
        setStatus("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, difficulty]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQuestion();
  }, [loadQuestion, round]);

  const handleSelect = async (choice: ZukanQuizChoice) => {
    if (status !== "answering" || !question) return;
    setSelected(choice);
    try {
      const res = await submitZukanQuizAnswer(question.sessionId, choice.prefCode, choice.cityCode);
      setResult(res);
      setHistory((h) => [...h, { isCorrect: res.isCorrect, prefName: res.prefName, cityName: res.cityName }]);
      setUsedCityKeys((keys) => [...keys, `${res.prefCode}:${res.cityCode}`]);
      setStatus("revealed");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "回答の送信に失敗しました");
      setStatus("error");
    }
  };

  const handleNext = () => {
    if (round >= QUESTIONS_PER_SESSION) {
      setStatus("finished");
    } else {
      setRound((r) => r + 1);
    }
  };

  const handleRestart = () => {
    setHistory([]);
    setUsedCityKeys([]);
    setRound(1);
  };

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
        <p className="text-sm text-red-600">{errorMessage}</p>
        <button
          type="button"
          onClick={loadQuestion}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 transition-colors"
        >
          もう一度試す
        </button>
      </div>
    );
  }

  if (status === "finished") {
    const correctCount = history.filter((h) => h.isCorrect).length;
    return (
      <div className="max-w-md mx-auto px-4 py-10 flex flex-col gap-6">
        <div className="text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h2 className="text-xl font-bold text-[#3c2a14]">セッション結果</h2>
          <p className="text-3xl font-extrabold text-orange-600 mt-2">
            {correctCount} <span className="text-base font-normal text-[#78716c]">/ {QUESTIONS_PER_SESSION} 問正解</span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {history.map((h, i) => (
            <div
              key={i}
              className={`rounded-xl px-4 py-3 flex items-center gap-3 ${
                h.isCorrect ? "bg-orange-50 border border-orange-200" : "bg-gray-50 border border-gray-200"
              }`}
            >
              <span className="text-lg shrink-0">{h.isCorrect ? "✅" : "❌"}</span>
              <span className="text-sm text-[#3c2a14]">
                {h.prefName} {h.cityName}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleRestart}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 transition-colors"
          >
            もう一度挑戦する
          </button>
          <Link
            href="/game/zukan-quiz/collection"
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-center text-[#78716c] border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
          >
            図鑑を見る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[#a8937a] tracking-widest">
          第{round}問 / {QUESTIONS_PER_SESSION}問
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${difficultyMeta.badgeClass}`}>
          {difficultyMeta.label}
        </span>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 flex flex-col items-center justify-center aspect-square">
        {status === "loading" || !question ? (
          <div className="w-8 h-8 rounded-full border-4 border-gray-200 border-t-orange-500 animate-spin" />
        ) : (
          <MunicipalitySilhouette geometry={question.silhouette} className="w-full h-full" terrainLayer="hillshademap" />
        )}
      </div>
      {question && status !== "loading" && (
        <p className="text-[10px] text-[#a8937a] text-right -mt-3">
          地形:{" "}
          <a
            href="https://maps.gsi.go.jp/development/ichiran.html"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            国土地理院
          </a>
        </p>
      )}

      {question && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#f8f4ea] rounded-xl px-3 py-2">
            <div className="text-[11px] text-[#a8937a]">人口</div>
            <div className="text-base font-bold text-[#3c2a14]">{question.population.toLocaleString()}人</div>
          </div>
          <div className="bg-[#f8f4ea] rounded-xl px-3 py-2">
            <div className="text-[11px] text-[#a8937a]">世帯数</div>
            <div className="text-base font-bold text-[#3c2a14]">{question.households.toLocaleString()}世帯</div>
          </div>
        </div>
      )}

      {question && TRIVIA_FIELD_LABELS.some(({ key }) => question.trivia[key]) && (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 flex flex-col gap-2">
          {TRIVIA_FIELD_LABELS.map(({ key, label }) => {
            const value = question.trivia[key];
            if (!value) return null;
            return (
              <div key={key}>
                <span className="text-[11px] text-[#a8937a]">{label}</span>
                <p className="text-sm text-[#3c2a14]">{value}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2.5">
        {question?.choices.map((choice) => {
          const isSelected = selected && choiceKey(selected) === choiceKey(choice);
          const isAnswerCorrect =
            status === "revealed" && result && result.prefCode === choice.prefCode && result.cityCode === choice.cityCode;
          const isWrongPick = status === "revealed" && isSelected && !result?.isCorrect;

          let styleClass = "border-gray-200 bg-white hover:border-orange-300";
          if (isAnswerCorrect) styleClass = "border-orange-500 bg-orange-50";
          else if (isWrongPick) styleClass = "border-red-400 bg-red-50";

          return (
            <button
              key={choiceKey(choice)}
              type="button"
              disabled={status !== "answering"}
              onClick={() => handleSelect(choice)}
              className={`text-left px-4 py-3.5 rounded-xl border-2 text-sm font-semibold text-[#3c2a14] transition-colors duration-150 ${styleClass} disabled:cursor-default`}
            >
              {choice.prefName} {choice.cityName}
              {isAnswerCorrect && <span className="ml-2 text-orange-600">正解</span>}
            </button>
          );
        })}
      </div>

      {status === "revealed" && result && (
        <div className="bg-white rounded-2xl shadow-[0_2px_12px_rgba(120,90,40,0.08)] p-4 flex flex-col gap-2">
          <p className={`text-sm font-bold ${result.isCorrect ? "text-orange-600" : "text-red-500"}`}>
            {result.isCorrect ? `正解！「${difficultyMeta.label}」クリア` : "不正解"}
          </p>
          <p className="text-sm text-[#3c2a14]">
            正解は「{result.prefName} {result.cityName}」でした
          </p>
          {result.attemptCount > 0 && (
            <p className="text-xs text-[#a8937a]">
              みんなの正答率: {Math.round((result.correctCount / result.attemptCount) * 100)}%
              <span className="ml-1">({result.correctCount} / {result.attemptCount}人)</span>
            </p>
          )}
          <button
            type="button"
            onClick={handleNext}
            className="mt-2 w-full py-3 rounded-xl text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 transition-colors"
          >
            {round >= QUESTIONS_PER_SESSION ? "結果を見る" : "次の問題へ"}
          </button>
        </div>
      )}
    </div>
  );
}
