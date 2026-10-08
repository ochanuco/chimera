import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, createGeneration, postJson, req } from './helpers';
import { appJs } from '../src/ui/static';

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
  it('lists raw Generations newest first and links each to its workbench, leaving out refined ones', async () => {
    const { generation: older } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima' } });
    const { generation: newer } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima-bust' } });
    const refined = await derive(older, 'redraw', { method: 'hires' });
    const html = await (await req('/work')).text();
    expect(html).toContain('<h1>元絵を選ぶ</h1>');
    expect(html).toContain(`href="/work/${older.short_id}"`);
    expect(html.indexOf(`/work/${newer.short_id}"`)).toBeLessThan(html.indexOf(`/work/${older.short_id}"`));
    expect(html).not.toContain(`/work/${refined.short_id}"`);
    expect(html).toContain(`src="/g/${older.short_id}/preview"`);
    expect(html).toContain('ワークベンチ');
  });

  it('filters by rating and by recipe', async () => {
    const { generation: good } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima' } });
    const { generation: plain } = await createGeneration({ requestOverrides: { recipe: 'yukari-anima-bust' } });
    expect((await postJson(`/api/v1/generations/${good.id}/rating`, { rating: 'good' }, 'PUT')).status).toBe(200);

    const goodOnly = await (await req('/work?rating=good')).text();
    expect(goodOnly).toContain(`/work/${good.short_id}"`);
    expect(goodOnly).not.toContain(`/work/${plain.short_id}"`);

    const bust = await (await req('/work?recipe=yukari-anima-bust')).text();
    expect(bust).toContain(`/work/${plain.short_id}"`);
    expect(bust).not.toContain(`/work/${good.short_id}"`);
    expect(bust).toContain('href="/work?recipe=yukari-anima"');
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

  it('renders the five-phase stepper, every phase form, and the tree and picks for the client', async () => {
    const { generation: root } = await createGeneration();
    const hires = await derive(root, 'redraw', { method: 'hires' });
    expect((await postJson(`/api/v1/workbenches/${root.id}`, { picks: { '1': { generation_id: hires.id } } }, 'PUT')).status).toBe(200);

    const html = await (await req(`/work/${root.short_id}?at=${hires.short_id}`)).text();
    expect(html).toContain('data-workbench=');
    for (const label of ['元絵', '1. 描き直し', '2. 光', '3. 部分', '4. 納品', '5. ボケ']) expect(html).toContain(label);
    for (const phase of [1, 2, 3, 4, 5]) expect(html).toContain(`data-wb-form="${phase}"`);
    expect(html).toContain('href="/work"');
    expect(html).not.toContain('既定');

    const initial = /data-initial="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"') ?? '';
    const data = JSON.parse(initial) as { tree: { nodes: { short_id: string; phase: number | null }[] }; picks: Record<string, { generation_id: string }>; at: string };
    expect(data.tree.nodes.map((n) => n.short_id)).toContain(hires.short_id);
    expect(data.picks['1']?.generation_id).toBe(hires.id);
    expect(data.at).toBe(hires.short_id);
  });

  it('phase 1 offers hires first and canvas with their options', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="1"'), html.indexOf('data-wb-form="2"'));
    expect(form.indexOf('data-wb-method="hires"')).toBeLessThan(form.indexOf('data-wb-method="canvas"'));
    expect(form).toContain('name="wb_hires"');
    expect(form).toContain('name="wb_hires_denoise"');
    expect(form).toContain('name="wb_denoise"');
    expect(form).toContain('name="wb_size"');
  });

  it('phase 2 lists the catalog light scenes with an eight-direction compass', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="2"'), html.indexOf('data-wb-form="3"'));
    expect(form).toContain('data-wb-scene="sunset"');
    expect(form).toContain('data-wb-scene="moon"');
    for (const dir of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) expect(form).toContain(`data-compass-dir="${dir}"`);
  });

  it('phase 3 offers automatic and rectangle modes, and part chips from the recipe catalog', async () => {
    const recipe = `wb-parts-${crypto.randomUUID()}`;
    const catalog = {
      schema_version: 1,
      recipes: [
        {
          name: recipe,
          poses: [{ name: 'seated', prompt: 'sitting', parts: [{ name: 'costume', text: 'red hoodie, ' }, { name: 'pose', text: 'sitting' }] }],
          parts: ['costume', 'pose', 'scene'],
        },
      ],
      patches: {},
    };
    expect((await postJson('/api/v1/catalogs/production', catalog, 'PUT')).status).toBe(200);
    const { generation: root } = await createGeneration({ requestOverrides: { recipe } });
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="3"'), html.indexOf('data-wb-form="4"'));
    expect(form).toContain('手足を自動で探す');
    expect(form).toContain('矩形を引く');
    expect(form).toContain('data-wb-rect-clear');
    expect(form).toContain('name="wb_patch"');
    expect(form).toMatch(/data-wb-part-chip="costume"[^>]*data-part-text=/);
    expect(form).toContain('data-wb-part-chip="scene"');
  });

  it('phase 4 has background and size, the outline editor open, and a closed 詳細 with the finishing controls', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="4"'), html.indexOf('data-wb-form="5"'));
    expect(form).toContain('data-wb-bg="transparent"');
    expect(form).toContain('data-wb-bg="backdrop"');
    expect(form).toContain('name="wb_deliver_size"');
    expect(form).toMatch(/<details class="wb-acc" open="">\s*<summary>\s*フチ/);
    expect(form).toContain('data-outline-editor');
    expect(form).toContain('+ 外側に足す');
    expect(form).toContain('白・紫に戻す');
    expect(form).toContain('一番外の陰影');
    expect(form).toContain('prompt で描いた白フチは、この内側に残ります。');
    expect(form).toMatch(/<details class="wb-acc">\s*<summary>詳細<\/summary>/);
    for (const name of ['repin', 'recolor', 'skin', 'keep_legwear', 'keep_scene']) expect(form).toContain(`name="${name}"`);
    expect(form).toContain('data-wb-backdrop-patterns');
    expect(form).toContain('切り抜きは初回に作って保存し');
  });

  it('phase 5 has the F-number slider over the catalog stops, the three scope boxes and the viewfinder choices', async () => {
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
    const form = html.slice(html.indexOf('data-wb-form="5"'));
    expect(form).toContain('data-dof-stops="[2.8,4,5.6,8]"');
    expect(form).toMatch(/name="dof_f_stop" min="0" max="3" step="1" value="1"/);
    for (const layer of ['figure', 'outline', 'backdrop']) expect(form).toMatch(new RegExp(`name="dof_scope_${layer}"[^>]*checked`));
    expect(form).toMatch(/name="dof_viewfinder" value="off" checked/);
    expect(form).toContain('ピント: 左の絵をクリック');
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
  it('posts workbench requests with a gui:workbench key and the five phase kinds', () => {
    expect(appJs).toContain("'gui:workbench:' + built.kind + ':' + input.short_id + ':' + crypto.randomUUID()");
    expect(appJs).toContain("kind: 'masked_redraw'");
    expect(appJs).toContain("kind: 'repair'");
    expect(appJs).toContain("kind: 'dof'");
    expect(appJs).toContain("kind: 'deliver'");
    expect(appJs).toContain("method: 'light'");
  });

  it('saves picks as the whole map through the workbench endpoint, truncating by lineage', () => {
    expect(appJs).toContain("api('/api/v1/workbenches/' + rootId, 'PUT', { picks: next })");
    expect(appJs).toContain('function chainPicks(nodeId, upto)');
    expect(appJs).toContain("next[String(k)] = { skip: true };");
  });

  it('keeps the crosshair and the rectangles relative to the rendered image box', () => {
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

  it('detects overlapping rectangles but not touching ones', () => {
    const overlap = extract<(a: number[], b: number[]) => boolean>('wbRectsOverlap');
    expect(overlap([0, 0, 0.5, 0.5], [0.4, 0.4, 0.9, 0.9])).toBe(true);
    expect(overlap([0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5])).toBe(false);
  });
});
