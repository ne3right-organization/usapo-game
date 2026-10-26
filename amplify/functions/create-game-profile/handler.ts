import type { PostConfirmationTriggerHandler } from "aws-lambda";
import { env } from "$amplify/env/create-game-profile";
import { dataClient, ensureProfile } from "../shared/dataClient";

// Google で初めてログインしたときに呼ばれる。ニックネームは空(=未設定)で作る
export const handler: PostConfirmationTriggerHandler = async (event) => {
  const userId = event.request.userAttributes.sub;
  if (userId) await ensureProfile(await dataClient(env), userId);
  return event;
};
