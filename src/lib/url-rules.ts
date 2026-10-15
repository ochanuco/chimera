// URL 入力の述語。スキーマ宣言から呼ばれるので schemas にも検証ライブラリにも依存しない。

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isParsableUrl(value: string): boolean {
  return parseUrl(value) !== null;
}

/** `javascript:` などの実行可能スキームを弾くため、http(s) だけを通す。 */
export function isHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}
