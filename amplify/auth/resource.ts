import { defineAuth, secret } from "@aws-amplify/backend";

// Amplify のビルドでは AWS_BRANCH / AWS_APP_ID が入る。sandbox(手元)では入らない
export const branch = (process.env.AWS_BRANCH ?? "sandbox").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const appId = process.env.AWS_APP_ID;
// Amplify でブランチに付けた独自ドメイン
const CUSTOM_DOMAINS: Record<string, string> = {
  develop: "https://devgame.usapo.net",
};
const origins = [
  ...(CUSTOM_DOMAINS[branch] ? [CUSTOM_DOMAINS[branch]] : []),
  ...(appId ? [`https://${branch}.${appId}.amplifyapp.com`] : []),
  "http://localhost:3000",
];

/**
 * ログインは Google のみ(Supabase 版と同じ)。
 * Gen2 の defineAuth は email か phone の指定が必須なので email を入れているが、
 * メール・パスワードでの自己登録は backend.ts で止めている
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      google: {
        clientId: secret("GOOGLE_CLIENT_ID"),
        clientSecret: secret("GOOGLE_CLIENT_SECRET"),
        scopes: ["openid", "email", "profile"],
        attributeMapping: { email: "email" },
      },
      // ログインはブラウザ側(signInWithRedirect)で行う。戻り先のログイン画面が、ログイン前の画面に転送する
      callbackUrls: origins.map((o) => `${o}/login`),
      logoutUrls: origins.map((o) => `${o}/`),
    },
  },
});
