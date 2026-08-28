import type { FC, PropsWithChildren } from 'hono/jsx';
import { assetVersion } from './static';

// Graph (/graph) is intentionally not linked here — see docs/ui.md "Graph View": it's reached via
// the "Graph" link on Batch/Generation detail pages (root-scoped) or a direct URL, not the global nav.
const NAV_ITEMS = [
  { href: '/gallery', label: 'Gallery' },
  { href: '/batches', label: 'Batches' },
  { href: '/stories', label: 'Stories' },
  { href: '/bookmarks', label: 'Bookmarks' },
];

export const Layout: FC<PropsWithChildren<{ title?: string; fullBleed?: boolean }>> = ({
  title,
  fullBleed,
  children,
}) => {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} - Chimera` : 'Chimera'}</title>
        <link rel="stylesheet" href={`/assets/style.css?v=${assetVersion}`} />
      </head>
      <body>
        <nav class="nav">
          <a class="brand" href="/gallery">
            Chimera
          </a>
          {NAV_ITEMS.map((item) => (
            <a href={item.href}>{item.label}</a>
          ))}
        </nav>
        <main class={fullBleed ? 'container container-full' : 'container'}>{children}</main>
        <script src={`/assets/app.js?v=${assetVersion}`}></script>
      </body>
    </html>
  );
};
