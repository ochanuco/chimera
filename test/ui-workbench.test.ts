import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, createGeneration, postJson, req } from './helpers';
import { appJs } from '../src/ui/static';
import { formatImageMetaText } from '../src/lib/image-meta';
import trailPlanFixture from './fixtures/trail_plan.json';

beforeEach(async () => {
  await clearGenerationData();
});

type Kind = 'redraw' | 'repair' | 'masked_redraw' | 'deliver' | 'dof';

async function derive(source: { id: string; short_id: string }, kind: Kind, options?: Record<string, unknown>) {
  const { generation } = await createGeneration({
    requestOverrides: { kind, status: 'done', payload: { generation_id: source.short_id, ...(options ? { options } : {}) } },
    jobOverrides: { source_generation_id: source.id },
  });
  return generation as { id: string; short_id: string };
}

describe('GET /work', () => {
  it('lists only worked-on raw Generations, newest activity first, with their state', async () => {
    const { generation: untouched } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima' } });
    const { generation: wip } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima' } });
    const { generation: done } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima-bust' } });
    const refined = await derive(wip, 'redraw', { method: 'hires' });
    const delivered = await derive(done, 'deliver');
    const html = await (await req('/work')).text();
    expect(html).toContain('<h1>ワークベンチ</h1>');
    expect(html).not.toContain(`/work/${untouched.short_id}"`);
    expect(html).not.toContain(`/work/${refined.short_id}"`);
    expect(html).not.toContain(`/work/${delivered.short_id}"`);
    expect(html).toContain(`href="/work/${wip.short_id}"`);
    expect(html).toContain(`src="/g/${wip.short_id}/preview"`);
    expect(html.indexOf(`/work/${done.short_id}"`)).toBeLessThan(html.indexOf(`/work/${wip.short_id}"`));
    expect(html).toContain('work-state-wip');
    expect(html).toContain('work-state-done');
    // 共通カード: サムネイルはワークベンチへ、rating / bookmark はその場で付けられる。
    expect(html).toContain(`<a class="thumb-link" href="/work/${wip.short_id}" data-short-id="${wip.short_id}">`);
    expect(html).toContain(`class="rating-group" data-generation-id="${wip.id}"`);
    expect(html).toContain(`data-kind="generations" data-id="${wip.id}" data-bookmarked="false"`);
  });

  it('carries the card template that the candidate strip clones', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    expect(html).toContain('<template data-generation-card-template="true">');
    expect(html).toContain('data-card-link="reroll"');
  });

  it('filters by state and by recipe', async () => {
    const { generation: wip } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima' } });
    const { generation: done } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima-bust' } });
    await derive(wip, 'redraw');
    await derive(done, 'deliver');

    const wipOnly = await (await req('/work?state=wip')).text();
    expect(wipOnly).toContain(`/work/${wip.short_id}"`);
    expect(wipOnly).not.toContain(`/work/${done.short_id}"`);

    const doneOnly = await (await req('/work?state=done')).text();
    expect(doneOnly).toContain(`/work/${done.short_id}"`);
    expect(doneOnly).not.toContain(`/work/${wip.short_id}"`);

    const bust = await (await req('/work?recipe=yukari-anima-bust')).text();
    expect(bust).toContain(`/work/${done.short_id}"`);
    expect(bust).not.toContain(`/work/${wip.short_id}"`);
    expect(bust).toContain('href="/work?recipe=yukari-anima"');
  });

  it('offers recipe filters only for recipes the production catalog carries', async () => {
    const catalog = { schema_version: 1, recipes: [{ name: 'yukari', poses: [] }], patches: {} };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
    const { generation: current } = await createGeneration({ requestOverrides: { recipe: 'yukari' } });
    const { generation: retired } = await createGeneration({ requestOverrides: { recipe: 'yukari-il' } });
    await derive(current, 'redraw');
    await derive(retired, 'redraw');

    const all = await (await req('/work')).text();
    expect(all).toContain('href="/work?recipe=yukari"');
    expect(all).not.toContain('href="/work?recipe=yukari-il"');
    expect(all).toContain(`/work/${retired.short_id}"`);

    const old = await (await req('/work?recipe=yukari-il')).text();
    expect(old).toContain(`/work/${retired.short_id}"`);
    expect(old).not.toContain(`/work/${current.short_id}"`);
    expect(old).toContain('href="/work?recipe=yukari-il"');
  });

  it('counts a saved workbench as worked on and shows the empty state otherwise', async () => {
    expect(await (await req('/work')).text()).toContain('作業中の絵がありません');
    const { generation: root } = await createGeneration();
    expect((await postJson(`/api/v1/workbenches/${root.id}`, { picks: { '1': { skip: true } } }, 'PUT')).status).toBe(200);
    expect(await (await req('/work')).text()).toContain(`/work/${root.short_id}"`);
  });
});

describe('GET /work/:shortId', () => {
  it('redirects a refined Generation to its root workbench with ?at=', async () => {
    const { generation: root } = await createGeneration();
    const hires = await derive(root, 'redraw', { method: 'hires' });
    const deliver = await derive(hires, 'deliver', { backdrop: null });
    const res = await req(`/work/${deliver.short_id}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/work/${root.short_id}?at=${deliver.short_id}`);
  });

  it('404s an unknown Generation', async () => {
    expect((await req('/work/nope00')).status).toBe(404);
  });

  it('renders the seven-phase stepper, every phase form, and the tree and picks for the client', async () => {
    const { generation: root } = await createGeneration();
    const hires = await derive(root, 'redraw', { method: 'hires' });
    expect((await postJson(`/api/v1/workbenches/${root.id}`, { picks: { '1': { generation_id: hires.id } } }, 'PUT')).status).toBe(200);

    const html = await (await req(`/work/${root.short_id}?at=${hires.short_id}`)).text();
    expect(html).toContain('data-workbench=');
    for (const label of ['元絵', '1. 描き直し', '2. 彩度', '3. フチ', '4. 背景', '5. 軌跡', '6. 光', '7. ボケ']) expect(html).toContain(label);
    expect(html.indexOf('4. 背景')).toBeLessThan(html.indexOf('5. 軌跡'));
    expect(html.indexOf('5. 軌跡')).toBeLessThan(html.indexOf('6. 光'));
    expect(html.indexOf('2. 彩度')).toBeLessThan(html.indexOf('3. フチ'));
    expect(html.indexOf('data-wb-form="2"')).toBeLessThan(html.indexOf('data-wb-form="3"'));
    for (const phase of [1, 2, 3, 4, 5, 6, 7]) expect(html).toContain(`data-wb-form="${phase}"`);
    expect(html).not.toContain('data-wb-form="8"');
    expect(html).toContain('/ 7</p>');
    expect(html).not.toContain('2. 部分');
    expect(html).toContain('href="/work"');
    expect(html).not.toContain('既定');

    const initial = /data-initial="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"') ?? '';
    const data = JSON.parse(initial) as { tree: { nodes: { short_id: string; phase: number | null }[] }; picks: Record<string, { generation_id: string }>; at: string };
    expect(data.tree.nodes.map((n) => n.short_id)).toContain(hires.short_id);
    expect(data.picks['1']?.generation_id).toBe(hires.id);
    expect(data.at).toBe(hires.short_id);
  });

  it('phase 1 offers only hires, with a long side of 2048 by default', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="1"'), html.indexOf('data-wb-form="2"'));
    expect(form).toContain('name="wb_hires"');
    expect(form).toContain('<option value="2048" selected="">');
    expect(form).toContain('name="wb_hires_denoise"');
    for (const gone of ['data-wb-method', 'name="wb_denoise"', 'name="wb_size"', 'data-wb-scene', 'data-wb-light-input']) {
      expect(form).not.toContain(gone);
    }
    expect(html).not.toContain('light（夕日・月明かり）');
  });

  it('phase 1 offers a no-cut checkbox and sends cut: true unless it is checked', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="1"'), html.indexOf('data-wb-form="2"'));
    expect(form).toContain('name="wb_redraw_no_cut"');
    expect(form).toContain('切り抜かない');
    expect(appJs).toContain("if (!qs('input[name=\"wb_redraw_no_cut\"]', form).checked) redrawOptions.cut = true;");
    expect(appJs).not.toContain('titleInput');
    expect(appJs).not.toContain('先に 2 でフチを付けてください');
    expect(appJs).not.toContain('先に切り抜いてください');
    expect(appJs).toContain("node.cutout ? '/g/' + node.short_id + '/assets/cutout'");
  });

  it('lets phases 4, 6 and 7 take a cut redraw and offers a cut-out without outlines or compression otherwise', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    for (const phase of ['4', '6', '7']) {
      const start = html.indexOf(`data-wb-form="${phase}"`);
      expect(html.slice(start, start + 600)).toContain('data-wb-cut-out');
    }
    for (const phase of ['2', '3', '5']) {
      const start = html.indexOf(`data-wb-form="${phase}"`);
      const end = html.indexOf(`data-wb-form="${Number(phase) + 1}"`);
      expect(html.slice(start, Math.min(start + 600, end))).not.toContain('data-wb-cut-out');
    }
    expect(html).toContain('フチなしで切り抜く');
    expect(appJs).toContain("return node.kind === 'redraw' && !!node.cutout;");
    expect(appJs).toContain("if (needsCutOut()) return '切り抜かれていません';");
    expect(appJs).toContain("[4, 6, 7].indexOf(wb.active) >= 0 && !isCutOut(input) && ['stage', 'trail', 'lighting'].indexOf(input.kind) < 0");
    expect(appJs).toContain("var options = { transparent: true, outlines: [], saturation: 0 };");
    expect(appJs).toContain('goStep(3);');
    expect(appJs).toContain("'gui:workbench:deliver:' + input.short_id + ':' + crypto.randomUUID()");
  });

  it('requires a direction or a scene to light a picture without a backdrop', () => {
    expect(appJs).toContain("return '背景が無いので、向きかシーンを選んでください';");
    expect(appJs).toContain('!hasBackdrop(activeInputNode()) && !wb.lightingDir && !wb.lightingScene');
  });

  it('marks cutout on tree nodes only when the cutout asset exists', async () => {
    const { generation: root } = await createGeneration();
    const cut = await derive(root, 'redraw', { method: 'hires', cut: true });
    const plain = await derive(root, 'redraw', { method: 'canvas' });
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO generation_assets (id, generation_id, role, region, r2_object_key, content_type, size, created_at, updated_at)
       VALUES (?, ?, 'cutout', '', 'k', 'image/png', 1, ?, ?)`,
    )
      .bind(crypto.randomUUID(), cut.id, now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO generation_assets (id, generation_id, role, region, r2_object_key, content_type, size, created_at, updated_at)
       VALUES (?, ?, 'alpha', '', 'k2', 'image/png', 1, ?, ?)`,
    )
      .bind(crypto.randomUUID(), plain.id, now, now)
      .run();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const initial = /data-initial="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"') ?? '';
    const data = JSON.parse(initial) as { tree: { nodes: { short_id: string; cutout: boolean }[] } };
    const byId = new Map(data.tree.nodes.map((n) => [n.short_id, n.cutout]));
    expect(byId.get(cut.short_id)).toBe(true);
    expect(byId.get(plain.short_id)).toBe(false);
    expect(byId.get(root.short_id)).toBe(false);
  });

  it('phase 3 cuts out transparent with the outline editor open and finishing controls in closed details', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="3"'), html.indexOf('data-wb-form="4"'));
    expect(form).not.toContain('data-wb-bg=');
    expect(form).toMatch(/<input type="radio" name="backdrop" value="transparent" checked/);
    expect(form).toMatch(/<details class="wb-acc" open="">\s*<summary>\s*フチ/);
    expect(form).toContain('data-outline-editor');
    expect(form).toContain('一番外の陰影');
    expect(form).not.toContain('name="repin"');
    for (const name of ['recolor', 'skin', 'keep_legwear', 'wb_deliver_size']) expect(form).not.toContain(`name="${name}"`);
    expect(appJs).not.toMatch(/recolor|keep_legwear|deliver_size|name="skin"/);
    expect(form).toContain('切り抜きは 2 回目から使い回します');
  });

  it('phase 2 compresses saturation with a strength slider defaulting to the catalog value', async () => {
    const recipe = `wb-sat-${crypto.randomUUID()}`;
    const catalog = { schema_version: 3, recipes: [{ name: recipe, poses: [] }], patches: {}, saturation: { strength: { min: 0, max: 1, default: 0.6 } } };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
    const { generation: root } = await createGeneration({ requestOverrides: { recipe } });
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="2"'), html.indexOf('data-wb-form="3"'));
    expect(form).toMatch(/name="wb_saturation_strength" min="0" max="1" step="0.05" value="0.6"/);
    expect(form).toContain('data-wb-saturation-readout');
    expect(appJs).toContain("return { kind: 'saturation', options: { strength: rangeValue('wb_saturation_strength') } };");
  });

  it('phase 3 outlines a phase-2 saturation as it is and a skipped 2 without compression', () => {
    expect(appJs).toContain("if (wb.active === 3 && input.delivered && input.phase !== 2) return '納品済み';");
    expect(appJs).toContain("if (activeInputNode().kind !== 'saturation') options.saturation = 0;");
    expect(appJs).not.toContain('納品で彩度を圧縮済み');
  });

  it('phase 4 offers patterns with a shadow toggle, or a photo with upload, placement and height', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="4"'), html.indexOf('data-wb-form="5"'));
    expect(form).toContain('data-wb-stage-mode="pattern"');
    expect(form).toContain('data-wb-stage-mode="photo"');
    expect(form).toMatch(/<input type="radio" name="backdrop" value="random" checked[^>]*>\s*<span class="backdrop-option-label">ランダム/);
    expect(form).toMatch(/class="wb-pill wb-pill-on" data-wb-shadow="on"/);
    expect(form).toContain('data-wb-shadow="off"');
    expect(form).toMatch(/class="wb-pill wb-pill-on" data-wb-framed="on"/);
    expect(form).toContain('data-wb-framed="off"');
    expect(form).toMatch(/data-wb-stage-scene[^>]*hidden/);
    expect(form).toContain('name="wb_stage_scene" checked');
    expect(form).not.toContain('data-compass="shadow"');
    expect(form).toContain('data-wb-photos');
    expect(form).toContain('data-wb-photo-file');
    expect(form).toContain('name="wb_stage_height"');
  });

  it('phase 4 lists the uploaded photos to choose from', async () => {
    const { generation: photo } = await createGeneration({ requestOverrides: { kind: 'import', parameters: { kind: 'photo' } } });
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    expect(html).toContain(`data-wb-photo="${photo.short_id}"`);
  });

  it('phase 6 lights with a strength slider and an optional direction', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="6"'), html.indexOf('data-wb-form="7"'));
    expect(form).toContain('name="wb_lighting_strength"');
    expect(form).toContain('data-wb-lighting-none');
    expect(form).toContain('data-compass="lighting"');
    for (const scene of ['sunset', 'moon']) expect(form).toContain(`data-wb-lighting-scene="${scene}"`);
  });

  it('phase 5 draws a trail: template thumbnails from the catalog, front / back per point, path, rule, width, colour and head', async () => {
    const recipe = `wb-trail-${crypto.randomUUID()}`;
    const catalog = {
      schema_version: 3,
      recipes: [{ name: recipe, poses: [], trail: { color: '#6f5c78' } }],
      patches: {},
      trail: {
        templates: [
          { name: 'tsu', label: 'つ', points: [[0.2, 0.2], [0.8, 0.3], [0.7, 0.8], [0.3, 0.9]], front: [false, false, true, true] },
          { name: 'z', label: 'Z', points: [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]], front: [true, false, false, true] },
        ],
        default_template: 'tsu',
        paths: ['curve', 'line'],
        rules: ['both', 'split', 'start'],
        heads: ['light', 'sparkle'],
        width: { min: 1, max: 15, default: 5 },
        point_range: [-1, 2],
      },
    };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
    const { generation: root } = await createGeneration({ requestOverrides: { recipe } });
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="5"'), html.indexOf('data-wb-form="6"'));
    for (const name of ['tsu', 'z']) {
      expect(form).toContain(`data-wb-trail-template="${name}"`);
      expect(form).toContain(`<canvas width="40" height="60" data-wb-trail-thumb="${name}">`);
    }
    for (const i of [0, 1, 2, 3]) expect(form).toContain(`data-wb-trail-front="${i}"`);
    for (const path of ['curve', 'line']) expect(form).toContain(`data-wb-trail-path="${path}"`);
    for (const rule of ['both', 'split', 'start']) expect(form).toContain(`data-wb-trail-rule="${rule}"`);
    for (const head of ['light', 'sparkle']) expect(form).toContain(`data-wb-trail-head="${head}"`);
    expect(form).toContain('name="wb_trail_width" min="1" max="15" step="0.5" value="5"');
    expect(form).toContain('name="wb_trail_color" value="#6f5c78" data-wb-trail-color-default="#6f5c78"');
    expect(form).toContain('name="wb_trail_head_at_end" checked');
    expect(form).toContain('name="wb_trail_in_frame" checked');
    const initial = /data-initial="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"') ?? '';
    const data = JSON.parse(initial) as { trail: { defaultTemplate: string; templates: { name: string }[]; pointRange: number[] } };
    expect(data.trail.defaultTemplate).toBe('tsu');
    expect(data.trail.templates.map((t) => t.name)).toEqual(['tsu', 'z']);
    expect(data.trail.pointRange).toEqual([-1, 2]);
    expect(appJs).toContain("if (wb.active === 5 && input.kind !== 'stage') return '先に 4 背景 を付けてください';");
    expect(appJs).toContain("track('trail.template_select', { template: trailName });");
  });

  it('phase 5 has no controls without a catalog trail', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="5"'), html.indexOf('data-wb-form="6"'));
    expect(form).toContain('data-wb-unavailable');
    expect(form).not.toContain('data-wb-trail-template');
    expect(appJs).toContain("if (wb.active === 5 && !trailCatalog) return 'カタログに軌跡がありません';");
  });

  it('samples the trail guide with the worker centripetal Catmull-Rom and colours stretches by the rule', () => {
    const start = appJs.indexOf('function wbCatmull(');
    const end = appJs.indexOf('var WB_TRAIL_FRONT');
    const pieces = new Function(`${appJs.slice(start, end)}; return wbTrailPieces;`)() as (
      points: number[][],
      front: boolean[],
      rule: string,
      curve: boolean,
      w: number,
      h: number,
    ) => { front: boolean; pts: number[][] }[];
    const points = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const front = [true, false, false, true];
    expect(pieces(points, front, 'both', true, 100, 200).map((p) => p.front)).toEqual([false, false, false]);
    expect(pieces(points, front, 'start', true, 100, 200).map((p) => p.front)).toEqual([true, false, false]);
    expect(pieces(points, front, 'split', true, 100, 200).map((p) => p.front)).toEqual([true, false, false, false, true]);
    const curve = pieces(points, front, 'both', true, 100, 200);
    expect(curve[0]!.pts[0]).toEqual([0, 0]);
    expect(curve[2]!.pts.at(-1)![0]).toBeCloseTo(0);
    expect(curve[2]!.pts.at(-1)![1]).toBeCloseTo(200);
    const line = pieces(points, front, 'both', false, 100, 200);
    expect(line[1]!.pts[8]).toEqual([100, 100]);
  });

  // test/fixtures/trail_plan.json is a copy of chagama's tests/fixtures/trail_plan.json, which the worker's own plan() is checked against.
  it('builds the same trail plan as the worker for the shared fixture', () => {
    const start = appJs.indexOf('function wbCatmull(');
    const end = appJs.indexOf('var WB_TRAIL_FRONT');
    const lib = new Function(`${appJs.slice(start, end)}; return { plan: wbTrailPlan, rng: wbTrailRng };`)() as {
      plan: (trail: unknown, height: number, width: number, lightGround: boolean) => { body: unknown[][]; head: unknown[]; front: unknown[]; head_in_front: boolean };
      rng: (seed: number) => { random: () => number };
    };
    const rng = lib.rng(7);
    expect([0, 1, 2, 3, 4].map(() => rng.random())).toEqual(trailPlanFixture.rng_seed_7);

    function close(got: unknown, want: unknown, at: string): void {
      if (typeof want === 'number') {
        expect(typeof got, at).toBe('number');
        expect(Math.abs((got as number) - want), at).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(want)));
      } else if (Array.isArray(want)) {
        expect(Array.isArray(got) && got.length, at).toBe(want.length);
        want.forEach((w, i) => close((got as unknown[])[i], w, `${at}.${i}`));
      } else {
        expect(got, at).toBe(want);
      }
    }
    expect(trailPlanFixture.cases.length).toBeGreaterThan(0);
    for (const c of trailPlanFixture.cases) {
      const drawn = lib.plan(c.trail, c.height, c.width, c.light_ground);
      const counts: Record<string, number> = {};
      for (const prim of drawn.body) counts[prim[0] as string] = (counts[prim[0] as string] ?? 0) + 1;
      expect(counts, c.name).toEqual(c.counts);
      expect(drawn.head_in_front, c.name).toBe(c.head_in_front);
      close(drawn.body.slice(0, 60), c.body_head, `${c.name} body head`);
      close(drawn.body.slice(-60), c.body_tail, `${c.name} body tail`);
      close(drawn.head, c.head, `${c.name} head`);
      close(drawn.front, c.front, `${c.name} front`);
    }
  });

  it('converts the stage frame to the back box the worker clips the back of the trail to', () => {
    const start = appJs.indexOf('function wbTrailBackBox(');
    const backBox = new Function(`${appJs.slice(start, appJs.indexOf('var WB_TRAIL_FRONT'))}; return wbTrailBackBox;`)() as (p: unknown) => number[] | null;
    expect(backBox({})).toBeNull();
    expect(backBox({ frame: { box: [0.05, 0.05, 0.95, 0.95] } })).toEqual([0.05, 0.05, 0.95, 0.95]);
    const box = backBox({ frame: { box: [0.1, 0.2, 0.9, 0.8], canvas: [0, 0.1, 1, 0.9] } })!;
    [0.1, 0.125, 0.9, 0.875].forEach((v, i) => expect(box[i]).toBeCloseTo(v, 12));
  });

  it('phase 5 previews the trail live and sends the seed it previewed', async () => {
    const recipe = `wb-trail-seed-${crypto.randomUUID()}`;
    const catalog = {
      schema_version: 3,
      recipes: [{ name: recipe, poses: [], trail: { color: '#6f5c78' } }],
      patches: {},
      trail: {
        templates: [{ name: 'tsu', label: 'つ', points: [[0.02, 0.34], [0.72, 0.2], [1, 0.52], [0.22, 0.94]], front: [false, false, true, true] }],
        default_template: 'tsu',
        paths: ['curve', 'line'],
        rules: ['both', 'split', 'start'],
        heads: ['light', 'sparkle'],
        width: { min: 1, max: 15, default: 5 },
        point_range: [-1, 2],
      },
    };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
    const { generation: root } = await createGeneration({ requestOverrides: { recipe } });
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="5"'), html.indexOf('data-wb-form="6"'));
    expect(form).toContain('data-wb-trail-reseed');
    expect(form).toContain('散らし直す');
    expect(appJs).toContain('trailSeed: Math.floor(Math.random() * 2147483648)');
    expect(appJs).toContain('seed: wb.trailSeed,');
    expect(appJs).toContain("if (k === 5) return { kind: 'trail', options: trailOptions() };");
    for (const role of ['layer-backdrop', 'layer-outline', 'layer-figure']) expect(appJs).toContain(`image('${role}')`);
    expect(appJs).toContain("'/api/v1/generations/' + encodeURIComponent(node.id) + '/context'");
  });

  it('picks the random backdrop among the non-night patterns only', async () => {
    const recipe = `wb-night-${crypto.randomUUID()}`;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const catalog = {
      schema_version: 3,
      recipes: [
        {
          name: recipe,
          poses: [],
          deliver: {
            backdrops: [
              { name: 'stickers', label: 'ステッカー', thumbnail: png, night: false },
              { name: 'stickers-night', label: 'ステッカー（夜）', thumbnail: png, night: true },
            ],
          },
        },
      ],
      patches: {},
    };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
    const { generation: root } = await createGeneration({ requestOverrides: { recipe } });
    const html = await (await req(`/work/${root.short_id}`)).text();
    expect(html).toContain('value="stickers" data-backdrop-pattern="true"/>');
    expect(html).toContain('value="stickers-night" data-backdrop-pattern="true" data-backdrop-night=""/>');
    expect(appJs).toContain('input[name="backdrop"][data-backdrop-pattern]:not([data-backdrop-night])');
  });

  it('keeps the run button and its error in a footer outside the scrolling panel body', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const body = html.indexOf('class="wb-panel-body"');
    const foot = html.indexOf('class="wb-panel-foot"');
    expect(body).toBeGreaterThan(0);
    expect(foot).toBeGreaterThan(body);
    expect(html.indexOf('data-wb-run')).toBeGreaterThan(foot);
    expect(html.indexOf('data-wb-error')).toBeGreaterThan(foot);
    expect(html.indexOf('data-wb-form="7"')).toBeLessThan(foot);
  });

  it('captions both panes with the same resolution and size text as the Generation page', () => {
    const start = appJs.indexOf('function imageMetaText(node) {');
    const source = appJs.slice(start, appJs.indexOf('\n  }\n', start) + 4);
    const imageMetaText = new Function(`${source}; return imageMetaText;`)() as (node: unknown) => string;
    for (const [width, height, size] of [[1536, 1536, 3_040_870], [768, 1024, 800], [null, null, 5_000_000], [2048, 2560, 3 * 1024 ** 3]] as const) {
      expect(imageMetaText({ image_width: width, image_height: height, image_size: size })).toBe(formatImageMetaText({ width, height, size }));
    }
    expect(imageMetaText({ image_width: 10, image_height: 10, image_size: null })).toBe('');
    expect(imageMetaText(null)).toBe('');
    expect(appJs).toContain("qs('[data-wb-input-meta]', root).textContent = imageMetaText(input);");
    expect(appJs).toContain("qs('[data-wb-cmp-meta]', root).textContent = imageMetaText(cmp.node);");
    expect(appJs).toContain("captionWithMeta(itemKind(item) + (isAdopted ? ' · 採用中' : ''), item.node)");
  });

  it('puts the image size on each tree node', async () => {
    const { generation: root } = await createGeneration();
    await env.DB.prepare('UPDATE generations SET image_width = 1536, image_height = 1024, image_size = 2048 WHERE id = ?').bind(root.id).run();
    const body = (await (await req(`/api/v1/generations/${root.id}/tree`)).json()) as { nodes: { id: string; image_width: number; image_height: number; image_size: number }[] };
    expect(body.nodes.find((n) => n.id === root.id)).toMatchObject({ image_width: 1536, image_height: 1024, image_size: 2048 });
  });

  it('puts the bookmark on each tree node and the ID, /g/ link, rating and bookmark on both pane captions', async () => {
    const { generation: root } = await createGeneration();
    await req(`/api/v1/generations/${root.id}/bookmark`, { method: 'PUT' });
    const body = (await (await req(`/api/v1/generations/${root.id}/tree`)).json()) as { nodes: { id: string; bookmark: boolean }[] };
    expect(body.nodes.find((n) => n.id === root.id)?.bookmark).toBe(true);
    const html = await (await req(`/work/${root.short_id}`)).text();
    for (const side of ['input', 'cmp']) {
      expect(html).toMatch(new RegExp(`data-wb-cap-actions="${side}"[\\s\\S]*?data-wb-cap-id[\\s\\S]*?data-wb-cap-link[\\s\\S]*?class="rating-group wb-rating"[\\s\\S]*?class="bookmark-btn" data-wb-bookmark="true"`));
    }
  });

  it('summarises the outline list in the フチ summary', () => {
    expect(appJs).toContain('function outlineSummaryText(editor)');
    expect(appJs).toContain("OUTLINE_COLOR_NAMES = { '#ffffff': '白', '#885b80': '紫' }");
  });

  it('phase 7 has the F-number slider over the catalog stops, the three scope boxes, the viewfinder choices and the photo dials', async () => {
    const recipe = `wb-dof-${crypto.randomUUID()}`;
    const catalog = {
      schema_version: 3,
      recipes: [{ name: recipe, poses: [] }],
      patches: {},
      dof: { f_number: { min: 2.8, max: 22, default: 4, stops: [2.8, 4, 5.6, 8] }, viewfinder: { values: ['off', 'on', 'both'], default: 'off' } },
    };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
    const { generation: root } = await createGeneration({ requestOverrides: { recipe } });
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="7"'));
    expect(form).toContain('data-dof-stops="[2.8,4,5.6,8]"');
    for (const name of ['wb_dof_tilt', 'wb_dof_nearer', 'wb_dof_bokeh', 'wb_dof_focal_length']) expect(form).toContain(`name="${name}"`);
    expect(form).toMatch(/<option value="85mm" selected/);
    expect(form).toMatch(/name="dof_f_stop" min="0" max="3" step="1" value="1"/);
    for (const layer of ['figure', 'outline', 'backdrop']) expect(form).toMatch(new RegExp(`name="dof_scope_${layer}"[^>]*checked`));
    expect(form).toMatch(/name="dof_viewfinder" value="off" checked/);
  });

  it('the nav links to the workbench', async () => {
    const html = await (await req('/gallery')).text();
    expect(html).toContain('<a href="/work">ワークベンチ</a>');
    const work = await (await req('/work')).text();
    expect(work).toContain('<a href="/work" aria-current="page">ワークベンチ</a>');
  });
});

describe('/g links to the workbench', () => {
  it('shows ワークベンチで開く on every Generation page', async () => {
    const { generation } = await createGeneration();
    const html = await (await req(`/g/${generation.short_id}`)).text();
    expect(html).toContain(`href="/work/${generation.short_id}"`);
    expect(html).toContain('ワークベンチで開く');
  });
});

describe('workbench client script', () => {
  it('posts workbench requests with a gui:workbench key and every phase kind', () => {
    expect(appJs).toContain("'gui:workbench:' + built.kind + ':' + input.short_id + ':' + crypto.randomUUID()");
    expect(appJs).not.toContain("kind: 'masked_redraw'");
    expect(appJs).not.toContain("kind: 'repair'");
    expect(appJs).toContain("kind: 'dof'");
    expect(appJs).toContain("kind: 'deliver'");
    expect(appJs).toContain("var redrawOptions = { method: 'hires', hires: Number(");
    expect(appJs).toContain("kind: 'stage'");
    expect(appJs).toContain("kind: 'trail'");
    expect(appJs).toContain("kind: 'lighting'");
    expect(appJs).toContain("kind: 'saturation'");
    expect(appJs).toContain('function sceneOf(node)');
    expect(appJs).toContain('stageOptions.light = null');
    expect(appJs).toContain('var WB_DEFAULT_FRAME = {"box":[0.05,0.05,0.95,0.95],"sides":{"top":"out","right":"out","bottom":"out","left":"out"}};');
    expect(appJs).toContain('stageOptions.frame = JSON.parse(JSON.stringify(WB_DEFAULT_FRAME))');
  });

  it('saves picks as the whole map through the workbench endpoint, truncating by lineage', () => {
    expect(appJs).toContain("api('/api/v1/workbenches/' + rootId, 'PUT', { picks: next })");
    expect(appJs).toContain('function chainPicks(nodeId, upto)');
    expect(appJs).toContain("next[String(k)] = { skip: true };");
  });

  it('keeps the crosshair relative to the rendered image box', () => {
    expect(appJs).toContain('function wbContainBox(paneWidth, paneHeight, imageWidth, imageHeight)');
    expect(appJs).toContain("var overlay = qs('.wb-overlay', pane);");
    expect(appJs).toContain('var r = overlay.getBoundingClientRect();');
  });

  it('follows request progress over the viewer socket and refetches the tree', () => {
    expect(appJs).toContain("viewerSocketOn('status', function (m) {");
    expect(appJs).toContain("api('/api/v1/generations/' + rootId + '/tree')");
  });

  function extract<T>(name: string): T {
    const start = appJs.indexOf(`function ${name}(`);
    const end = appJs.indexOf('\n  }\n', start) + 4;
    return new Function(`return (${appJs.slice(start, end).trim()})`)() as T;
  }

  it('computes the contain box of an image inside its pane', () => {
    const box = extract<(pw: number, ph: number, iw: number, ih: number) => number[]>('wbContainBox');
    expect(box(800, 600, 400, 600)).toEqual([200, 0, 400, 600]);
    expect(box(800, 600, 800, 300)).toEqual([0, 150, 800, 300]);
    expect(box(400, 400, 800, 800)).toEqual([0, 0, 400, 400]);
  });

  describe('loupe', () => {
    type Layout = { left: number; top: number; size: number; bgW: number; bgH: number; bgX: number; bgY: number; flipX: boolean; flipY: boolean };
    const layout = () =>
      new Function(
        'WB_LOUPE_OFFSET',
        `return (${appJs.slice(appJs.indexOf('function wbLoupeLayout('), appJs.indexOf('\n  }\n', appJs.indexOf('function wbLoupeLayout(')) + 4).trim()})`,
      )(24) as (c: { x: number; y: number }, b: { width: number; height: number }, zoom: number, side: number) => Layout;

    it('centres the zoomed image on the cursor without flipping in the middle', () => {
      const l = layout()({ x: 0.5, y: 0.5 }, { width: 800, height: 750 }, 3, 280);
      expect(l.size).toBe(280);
      expect([l.bgW, l.bgH]).toEqual([2400, 2250]);
      expect([l.bgX, l.bgY]).toEqual([140 - 1200, 140 - 1125]);
      expect([l.flipX, l.flipY]).toEqual([false, false]);
      expect([l.left, l.top]).toEqual([400 + 24, 375 - 24 - 280]);
    });

    it('flips towards the inside near the right and top edges and stays within the box', () => {
      const l = layout()({ x: 0.95, y: 0.05 }, { width: 600, height: 750 }, 3, 280);
      expect([l.flipX, l.flipY]).toEqual([true, true]);
      expect(l.left).toBe(570 - 24 - 280);
      expect(l.top).toBe(37.5 + 24);
      const corner = layout()({ x: 1, y: 0 }, { width: 600, height: 750 }, 3, 280);
      expect(corner.left + corner.size).toBeLessThanOrEqual(600);
      expect(corner.top).toBeGreaterThanOrEqual(0);
    });

    it('shrinks to half of the shorter side in a small box', () => {
      const l = layout()({ x: 0.5, y: 0.5 }, { width: 300, height: 200 }, 2, 280);
      expect(l.size).toBe(100);
      expect(l.bgX).toBe(50 - 300);
    });

    it('puts the same fraction of the image under the loupe centre for boxes of different sizes', () => {
      const fn = layout();
      const cursor = { x: 0.3, y: 0.8 };
      const a = fn(cursor, { width: 400, height: 500 }, 5, 280);
      const b = fn(cursor, { width: 600, height: 750 }, 5, 280);
      const fraction = (l: Layout) => [(l.size / 2 - l.bgX) / l.bgW, (l.size / 2 - l.bgY) / l.bgH];
      expect(fraction(a)).toEqual([0.3, 0.8]);
      expect(fraction(b)).toEqual([0.3, 0.8]);
      expect([a.flipX, a.flipY]).toEqual([b.flipX, b.flipY]);
    });

    it('wires the toggle, zoom buttons and keys, persisting the choice', () => {
      expect(appJs).toContain("t.closest('[data-wb-loupe-toggle]')");
      expect(appJs).toContain("t.closest('[data-wb-loupe-zoom]')");
      expect(appJs).toContain("ev.key === 'z' || ev.key === 'Z'");
      expect(appJs).toContain("ev.key === '['");
      expect(appJs).toContain("ev.key === ']'");
      expect(appJs).toContain("localStorage.setItem('wb.loupe'");
      expect(appJs).toContain('requestAnimationFrame(function () {');
      expect(appJs).toContain('img.currentSrc || img.src');
    });
  });
});
