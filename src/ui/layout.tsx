import type { FC, PropsWithChildren } from 'hono/jsx';
import { assetVersion } from './static';

/** True when `path` is exactly `base` or a sub-path of it (`base` + `/...`). */
function isActiveSection(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

export const Layout: FC<PropsWithChildren<{ title?: string; fullBleed?: boolean; path?: string }>> = ({
  title,
  fullBleed,
  path = '',
  children,
}) => {
  // /compare is entered from the Gallery's 選んで比べる mode (and Detail's direct links, docs/ui.md
  // 「Compare entry」), so it keeps Gallery marked current rather than leaving nav without an active item.
  const galleryActive = path === '/gallery' || path === '/compare';
  const bookmarksActive = path === '/bookmarks';
  const workbenchActive = isActiveSection(path, '/work');
  const moreActive = isActiveSection(path, '/experiments') || path === '/check' || path === '/stats' || path === '/photos' || path === '/references';

  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} - Chimera` : 'Chimera'}</title>
        <script src="/assets/telemetry.js"></script>
        <link rel="stylesheet" href={`/assets/style.css?v=${assetVersion}`} />
      </head>
      <body>
        <nav class="nav">
          <a class="brand" href="/gallery">
            Chimera
          </a>
          <a href="/gallery" aria-current={galleryActive ? 'page' : undefined}>
            ギャラリー
          </a>
          <a href="/bookmarks" aria-current={bookmarksActive ? 'page' : undefined}>
            ブックマーク
          </a>
          <a href="/work" aria-current={workbenchActive ? 'page' : undefined}>
            ワークベンチ
          </a>
          <details class="nav-more">
            <summary aria-current={moreActive ? 'page' : undefined}>その他</summary>
            <div class="nav-more-panel">
              <a href="/experiments">実験</a>
              <a href="/check">絵柄チェック</a>
              <a href="/photos">写真</a>
              <a href="/references">参考画像</a>
              <a href="/stats">統計</a>
            </div>
          </details>
          <details class="nav-queue" id="nav-queue">
            <summary class="nav-queue-pill nav-queue-empty" aria-label="キュー状態">
              <span class="nav-queue-dot"></span>
              <span class="nav-queue-text"></span>
            </summary>
            <div class="nav-queue-panel"></div>
          </details>
        </nav>
        <main class={fullBleed ? 'container container-full' : 'container'}>{children}</main>
        <div id="compare-bar" class="compare-bar hidden">
          <span id="compare-count" class="compare-count" role="status" aria-live="polite"></span>
          <button type="button" id="compare-clear" class="compare-clear">
            解除
          </button>
          <a id="compare-link" class="compare-go" aria-disabled="true">
            比べる
          </a>
        </div>
        <script src={`/assets/app.js?v=${assetVersion}`}></script>
      </body>
    </html>
  );
};
