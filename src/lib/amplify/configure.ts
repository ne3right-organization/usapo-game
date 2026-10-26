"use client";

import { Amplify } from "aws-amplify";
// Google から戻ってきたとき(?code=...)にトークンへ交換する処理を有効にする
import "aws-amplify/auth/enable-oauth-listener";
// Amplify のビルド(ampx pipeline-deploy)が作る。手元では `npx ampx generate outputs --app-id <id> --branch develop` で作る
import outputs from "../../../amplify_outputs.json";

// ssr: true でトークンを Cookie に置く(ブラウザの Amplify API からも読める形)
Amplify.configure(outputs, { ssr: true });
