export type GalleryView = 'raw' | 'refined' | 'all';

const VIEW_OPTIONS: { value: GalleryView; label: string }[] = [
  { value: 'raw', label: 'finalize 以外' },
  { value: 'refined', label: 'finalize' },
  { value: 'all', label: 'すべて' },
];

/**
 * 3-way segmented view switch (Gallery / Bookmarks Generations). `params` carries every other
 * currently-active query param so switching view doesn't drop the rest of the filter.
 */
export function ViewSwitch({ basePath, current, params }: { basePath: string; current: GalleryView; params: URLSearchParams }) {
  return (
    <div class="view-switch" role="group" aria-label="表示範囲">
      {VIEW_OPTIONS.map((opt) => {
        const linkParams = new URLSearchParams(params);
        linkParams.set('view', opt.value);
        const active = current === opt.value;
        return (
          <a class="view-switch-item" href={`${basePath}?${linkParams.toString()}`} aria-current={active ? 'true' : undefined} data-view={opt.value}>
            {opt.label}
          </a>
        );
      })}
    </div>
  );
}
