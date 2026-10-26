import "server-only";

// 図鑑クイズの出題生成(zukanQuizGenerator.ts)を Next.js のサーバーから使う入口。
// 正答を組み立てる処理なので、server-only でクライアントからの誤った import を防ぐ
export * from "./zukanQuizGenerator";
