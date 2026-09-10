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
  const galleryActive = path === '/gallery';
  const bookmarksActive = path === '/bookmarks';
  const moreActive = isActiveSection(path, '/batches') || isActiveSection(path, '/b') || isActiveSection(path, '/experiments');

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
            Gallery
          </a>
          <a href="/bookmarks" aria-current={bookmarksActive ? 'page' : undefined}>
            Bookmarks
          </a>
          <details class="nav-more">
            <summary aria-current={moreActive ? 'page' : undefined}>More</summary>
            <div class="nav-more-panel">
              <a href="/batches">Batches</a>
              <a href="/experiments">Experiments</a>
            </div>
          </details>
        </nav>
        <main class={fullBleed ? 'container container-full' : 'container'}>{children}</main>
        <script src={`/assets/app.js?v=${assetVersion}`}></script>
      </body>
    </html>
  );
};
