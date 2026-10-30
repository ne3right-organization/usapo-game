"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { isPushEnabled, pushAvailability } from "@/lib/push/client";

const noopSubscribe = () => () => {};

/** ホーム画面のアプリで開いているか・iPhone(iPad)か。サーバーでの描画では分からないので null */
function readEnv(): string {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return `${standalone ? "app" : "browser"}:${ios ? "ios" : "other"}`;
}

/**
 * ホーム画面への追加と、通知をオンにすることの案内(うさぽ農園のトップの「あそびかた」の下に出す)。状態ごとに出し分ける:
 * - ブラウザで開いている → ホーム画面への追加をすすめる。iPhone はアプリでしか通知を受け取れないので、通知は追加したあとに。
 *   iPhone 以外は、通知がまだオフならブラウザのままでもオンにできることも添える
 * - アプリで開いていて通知がオフ → 通知をオンにするよう案内する
 * - アプリで開いていて通知もオン → 何も出さない
 */
export default function InstallHint() {
  const env = useSyncExternalStore(noopSubscribe, readEnv, () => null);
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const canPushHere = env !== null && pushAvailability() === "ok";

  useEffect(() => {
    if (!canPushHere) return;
    let cancelled = false;
    isPushEnabled()
      .then((enabled) => !cancelled && setPushEnabled(enabled))
      .catch(() => !cancelled && setPushEnabled(false));
    return () => {
      cancelled = true;
    };
  }, [canPushHere]);

  if (env === null) return null;
  const inApp = env.startsWith("app");
  const ios = env.endsWith("ios");
  const showInstall = !inApp;
  // 通知の案内は、この画面で通知を受け取れて、まだオフのとき(iPhone のブラウザでは受け取れないので出さない)
  const showNotify = canPushHere && pushEnabled === false;
  if (!showInstall && !showNotify) return null;

  const what = "タネが実った・誰かが来た・実が全部収穫された（タネのまき直しは1週間以内）などを、通知で知らせます。";

  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold text-[#3c2a14] mb-1">快適に遊ぶために</h2>
      <p className="text-xs text-[#78716c] mb-3">
        はじめは1人でも楽しめますが、遊ぶ人が増えてくると、知らない誰かがあなたの畑に来て水をやってくれたり、あなたが誰かの畑を育てたりと、人とのつながりが生まれます。誰かが来てくれたことを見逃さないように、ホーム画面に追加し、通知を有効にしておきましょう。
      </p>
      <div className="flex flex-col gap-3">
      {showInstall && (
        <div className="bg-white border border-emerald-100 rounded-2xl p-4 text-xs text-[#78716c] leading-relaxed">
          <h3 className="text-sm font-bold text-[#3c2a14] mb-1">📲 ホーム画面に追加して、アプリにしよう</h3>
          <p>
            アプリのように、ホーム画面からすぐ開けます。{what}
            {ios ? "iPhone では、通知はホーム画面に追加したアプリでだけ受け取れます。" : ""}
          </p>
          {ios ? (
            <ol className="list-decimal pl-5 mt-2 space-y-0.5">
              <li>Safari で開き、下の共有ボタン（□に↑）を押す</li>
              <li>「ホーム画面に追加」を選ぶ</li>
              <li>ホーム画面にできた「うさぽゲーム」から開き、
                <Link href="/nickname" className="text-emerald-700 underline underline-offset-2 mx-0.5">
                  設定
                </Link>
                で通知をオンにする
              </li>
            </ol>
          ) : (
            <ol className="list-decimal pl-5 mt-2 space-y-0.5">
              <li>Chrome の右上のメニュー（︙）を押す</li>
              <li>「ホーム画面に追加」または「アプリをインストール」を選ぶ</li>
            </ol>
          )}
        </div>
      )}
      {showNotify && (
        <div className="bg-white border border-amber-100 rounded-2xl p-4 text-xs text-[#78716c] leading-relaxed">
          <h3 className="text-sm font-bold text-[#3c2a14] mb-1">🔔 通知をオンにしよう</h3>
          <p>
            {what}
            {inApp ? "" : "ブラウザのままでも受け取れます。"}
          </p>
          <Link
            href="/nickname"
            className="inline-block mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700"
          >
            設定で通知をオンにする →
          </Link>
        </div>
      )}
      </div>
    </section>
  );
}
