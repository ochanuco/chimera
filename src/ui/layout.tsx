import type { FC, PropsWithChildren } from 'hono/jsx';
import { assetVersion } from './static';

const NAV_ITEMS = [
  { href: '/gallery', label: 'Gallery' },
  { href: '/batches', label: 'Batches' },
  { href: '/stories', label: 'Stories' },
  { href: '/bookmarks', label: 'Bookmarks' },
  { href: '/graph', label: 'Graph' },
];

export const Layout: FC<PropsWithChildren<{ title?: string }>> = ({ title, children }) => {
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
        <main class="container">{children}</main>
        <script src={`/assets/app.js?v=${assetVersion}`}></script>
      </body>
    </html>
  );
};
