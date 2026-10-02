// Generation Detail の親 / 子 / 兄弟カード (docs/ui.md「Generation Detail」)。素材参照 (request_references) と
// 仕上げ元 (generations.refines_generation_id) は別の関係として扱い、混ぜない。Experiment Run 由来の関係は表示専用。

import { resolveGenerationShortIds, resolveRequestThumbnails } from './db';
import type { ExperimentRunFamily } from './experiments';
import type { FamilyCardData } from '../ui/components/FamilyCard';
import type { GenerationRow } from '../types';

export interface GenerationFamily {
  parents: FamilyCardData[];
  children: FamilyCardData[];
  siblings: FamilyCardData[];
}

interface ReferenceRow {
  other_id: string;
  purpose: string | null;
  aspect: string | null;
}

function previewUrl(shortId: string): string {
  return `/g/${shortId}/preview`;
}

function referenceDetail(r: { purpose: string | null; aspect: string | null }): string {
  return `purpose: ${r.purpose ?? '-'} / aspect: ${r.aspect ?? '-'}`;
}

async function listRefinedChildren(db: D1Database, generationId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT short_id FROM generations WHERE refines_generation_id = ? ORDER BY created_at ASC, id ASC')
    .bind(generationId)
    .all<{ short_id: string }>();
  return (results ?? []).map((r) => r.short_id);
}

export async function getGenerationFamily(
  db: D1Database,
  generation: GenerationRow,
  experimentRun: ExperimentRunFamily | null,
): Promise<GenerationFamily> {
  const [parentRefs, childRefs, refinedChildShortIds] = await Promise.all([
    generation.request_id
      ? db
          .prepare(
            'SELECT source_generation_id AS other_id, purpose, aspect FROM request_references WHERE target_request_id = ? ORDER BY created_at ASC, id ASC',
          )
          .bind(generation.request_id)
          .all<ReferenceRow>()
      : Promise.resolve({ results: [] as ReferenceRow[] }),
    db
      .prepare(
        'SELECT target_request_id AS other_id, purpose, aspect FROM request_references WHERE source_generation_id = ? ORDER BY created_at ASC, id ASC',
      )
      .bind(generation.id)
      .all<ReferenceRow>(),
    listRefinedChildren(db, generation.id),
  ]);

  const experimentMembers = [
    ...(experimentRun?.parent ? [experimentRun.parent] : []),
    ...(experimentRun?.children ?? []),
    ...(experimentRun?.siblings ?? []),
  ];
  const parentRefRows = parentRefs.results ?? [];
  const childRefRows = (childRefs.results ?? []).filter((r) => r.other_id !== generation.request_id);

  const [generationShortIds, requestThumbnails] = await Promise.all([
    resolveGenerationShortIds(
      db,
      [...parentRefRows.map((r) => r.other_id), ...(generation.refines_generation_id ? [generation.refines_generation_id] : [])],
    ),
    resolveRequestThumbnails(db, [...childRefRows.map((r) => r.other_id), ...experimentMembers.map((m) => m.request_id)]),
  ]);

  const requestCard = (kind: FamilyCardData['kind'], requestId: string, detail: string): FamilyCardData[] => {
    const shortId = requestThumbnails.get(requestId);
    if (!shortId) return [];
    return [{ kind, href: `/g/${shortId}`, shortId, imageUrl: previewUrl(shortId), caption: 'via request', detail }];
  };

  const parents: FamilyCardData[] = [
    ...parentRefRows.map((r): FamilyCardData => {
      const shortId = generationShortIds.get(r.other_id) ?? r.other_id;
      return { kind: 'reference', href: `/g/${shortId}`, shortId, imageUrl: previewUrl(shortId), detail: referenceDetail(r) };
    }),
    ...(generation.refines_generation_id
      ? [
          (() => {
            const shortId = generationShortIds.get(generation.refines_generation_id!) ?? generation.refines_generation_id!;
            return { kind: 'refinement', href: `/g/${shortId}`, shortId, imageUrl: previewUrl(shortId), detail: '仕上げ元' } as FamilyCardData;
          })(),
        ]
      : []),
    ...(experimentRun?.parent
      ? requestCard('experiment', experimentRun.parent.request_id, `run #${experimentRun.parent.run_index} → run #${experimentRun.run.run_index}`)
      : []),
  ];

  const children: FamilyCardData[] = [
    ...childRefRows.flatMap((r) => requestCard('reference', r.other_id, referenceDetail(r))),
    ...refinedChildShortIds.map(
      (shortId): FamilyCardData => ({ kind: 'refinement', href: `/g/${shortId}`, shortId, imageUrl: previewUrl(shortId), detail: '仕上げ先' }),
    ),
    ...(experimentRun?.children ?? []).flatMap((ch) =>
      requestCard('experiment', ch.request_id, `run #${experimentRun!.run.run_index} → run #${ch.run_index}`),
    ),
  ];

  const siblings: FamilyCardData[] = (experimentRun?.siblings ?? []).flatMap((s) =>
    requestCard('experiment', s.request_id, `run #${s.run_index} of ${experimentRun!.experiment.short_id}`),
  );

  return { parents, children, siblings };
}
