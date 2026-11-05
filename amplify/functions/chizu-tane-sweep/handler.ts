import type { ScheduledHandler } from "aws-lambda";
import { env } from "$amplify/env/chizu-tane-sweep";
import { dataClient, unwrap, type DataClient } from "../shared/dataClient";
import { markEndingNotice, removeEndedBase } from "../shared/chizuTane";
import { notifyUsers } from "../shared/push";
import { TANE_BASE_TYPE_BY_ID } from "../../../src/lib/game/chizuTane/courses";
import { fieldEnding, fieldNotice, rotAt } from "../../../src/lib/game/chizuTane/growth";
import { isLocalBaseTypeId } from "../../../src/lib/game/chizuTane/localItems";

type Base = NonNullable<Awaited<ReturnType<DataClient["models"]["GameTaneBase"]["get"]>>["data"]>;

/**
 * うさぽ農園の畑の終わり方(src/lib/game/chizuTane/growth.ts)を、定期実行(resource.ts の schedule)で行う。全部の畑を読んで、
 * - 期限を過ぎた畑(タネ待ちのまま1週間・腐り落ちた・枯れた)は行を消して空き地に戻し、持ち主に知らせる
 * - 期限が近い畑(宅急便で回収できるようになった・もうすぐ腐る・もうすぐ枯れる)の持ち主に、1回だけ知らせる(GameTaneBase.endingNotice)
 * 試作の規模なので毎回全件を読む。畑が増えたら、期限の日時で引ける索引を持つなどに変える
 */
export const handler: ScheduledHandler = async () => {
  const c = await dataClient(env);
  const now = new Date();
  const bases: Base[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await c.models.GameTaneBase.list({ limit: 1000, nextToken });
    bases.push(...unwrap(page));
    nextToken = page.nextToken;
  } while (nextToken);

  let ended = 0;
  let noticed = 0;
  for (const base of bases) {
    try {
      if (await endIfDue(c, base, now)) ended++;
      else if (await noticeIfDue(c, base, now)) noticed++;
    } catch (err) {
      // 1つの畑で失敗しても、ほかの畑は続ける(次の定期実行でまた試す)
      console.error("畑の終わりを処理できませんでした", base.areaKey, err);
    }
  }
  console.log(`畑 ${bases.length}か所: 空き地に戻した ${ended}・知らせた ${noticed}`);
};

function placeOf(base: Base): string {
  return `${base.townName}の${TANE_BASE_TYPE_BY_ID.get(base.baseTypeId)?.name ?? "畑"}`;
}

/** 日時を「11月2日 14:30」の形に(日本時間) */
function jstLabel(d: Date): string {
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** いまの持ち主(手放していない人) */
async function ownersOf(c: DataClient, areaKey: string): Promise<string[]> {
  return unwrap(await c.models.GameTaneOwnership.listTaneOwnershipByArea({ areaKey }))
    .filter((r) => !r.releasedAt)
    .map((r) => r.ownerId);
}

/** 期限を過ぎていれば、行を消して持ち主に知らせる。消したら true */
async function endIfDue(c: DataClient, base: Base, now: Date): Promise<boolean> {
  const ending = fieldEnding(base, now);
  if (!ending) return false;
  // 消す前に持ち主を引いておく(消すと「手放した」になる)
  const owners = await ownersOf(c, base.areaKey);
  if (!(await removeEndedBase(c, base.areaKey, base.updatedAt))) return false;
  const place = placeOf(base);
  const message = {
    abandoned: { title: "畑が空き地に戻りました", body: `タネ待ちのまま1週間まき直さなかった${place}は、空き地に戻りました` },
    rotten: { title: "実が腐り落ちました", body: `${place}の実（のこり${base.fruits ?? 0}個）が腐り落ちて、畑は空き地に戻りました` },
    withered: { title: "畑が枯れました", body: `1か月水が入らなかった${place}は、枯れて空き地に戻りました` },
  }[ending];
  await notifyUsers(c, owners, { ...message, url: "/game/chizu-tane", tag: `tane-end-${base.areaKey}` });
  return true;
}

/** 期限が近ければ、まだ知らせていないときだけ持ち主に知らせる。知らせたら true */
async function noticeIfDue(c: DataClient, base: Base, now: Date): Promise<boolean> {
  const local = isLocalBaseTypeId(base.baseTypeId);
  const notice = fieldNotice(base, now, local);
  if (!notice || base.endingNotice === notice.key) return false;
  if (!(await markEndingNotice(base.areaKey, notice.key))) return false;
  const place = placeOf(base);
  const fruits = base.fruits ?? 0;
  const rot = rotAt(base);
  const message = {
    deliverable: {
      title: "宅急便で実を回収できます",
      body: `${place}は実ってから1週間たちました。ホームの「あなたの畑」から、残りの実${fruits}個を宅急便で回収できます${
        rot ? `（${jstLabel(rot)}ごろに腐り落ちます）` : ""
      }`,
    },
    rotSoon: {
      title: "実がもうすぐ腐ります",
      body: `${place}の実（のこり${fruits}個）は、${jstLabel(notice.at)}ごろに腐り落ちて、畑は空き地に戻ります${
        local ? "" : "。ホームの「あなたの畑」から宅急便で回収できます"
      }`,
    },
    witherSoon: {
      title: "畑が枯れそうです",
      body: `${place}は、${jstLabel(notice.at)}ごろまでに水が入らないと、枯れて空き地に戻ります`,
    },
  }[notice.kind];
  await notifyUsers(c, await ownersOf(c, base.areaKey), { ...message, url: "/game/chizu-tane", tag: `tane-ending-${base.areaKey}` });
  return true;
}
