import type { Context } from 'hono';
import { app } from '../app';
import type { AppEnv } from '../types';

// SSR ページからの内部 API 呼び出し用。app.request にパスだけを渡すと
// リクエスト origin が http://localhost になり、API が組み立てる絶対 URL
// (image_url / canonical_url) が実ホストとずれるため、受信リクエストの
// origin を引き継いだ完全な URL で呼ぶ。
// app.ts との circular import は、参照がハンドラ実行時のみなので安全
// (routes/pages.tsx が既に同じ構造を取っている)。
export async function internalApiRequest(c: Context<AppEnv>, path: string): Promise<Response> {
  const origin = new URL(c.req.url).origin;
  return await app.request(new URL(path, origin).toString(), {}, c.env);
}
