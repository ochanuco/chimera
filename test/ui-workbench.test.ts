import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearGenerationData, createGeneration, postJson, req } from './helpers';
import { appJs } from '../src/ui/static';
import { formatImageMetaText } from '../src/lib/image-meta';

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

  it('phase 4 shows background and size, with the outline editor, backdrop pattern and finishing controls in closed details', async () => {
    const { generation: root } = await createGeneration();
    const html = await (await req(`/work/${root.short_id}`)).text();
    const form = html.slice(html.indexOf('data-wb-form="4"'), html.indexOf('data-wb-form="5"'));
    expect(form).toContain('data-wb-bg="transparent"');
    expect(form).toContain('class="wb-pill wb-pill-on" data-wb-bg="backdrop"');
    expect(form).toContain('name="wb_deliver_size"');
    expect(form).toMatch(/<details class="wb-acc">\s*<summary>\s*フチ/);
    expect(form).toContain('data-wb-outline-summary');
    expect(form).toContain('data-outline-editor');
    expect(form).toContain('+ 外側に足す');
    expect(form).toContain('白・紫に戻す');
    expect(form).toContain('一番外の陰影');
    expect(form).toContain('prompt で描いた白フチは、この内側に残ります。');
    expect(form).toMatch(/<details class="wb-acc">\s*<summary>詳細<\/summary>/);
    for (const name of ['repin', 'recolor', 'skin', 'keep_legwear', 'keep_scene']) expect(form).toContain(`name="${name}"`);
    expect(form).toMatch(/<details class="wb-acc" data-wb-backdrop-patterns(?![^>]* hidden="")[^>]*>\s*<summary>\s*背景柄/);
    expect(form).toContain('切り抜きは初回に作って保存し');
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
    expect(html.indexOf('data-wb-form="5"')).toBeLessThan(foot);
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

  it('detects overlapping rectangles but not touching ones', () => {
    const overlap = extract<(a: number[], b: number[]) => boolean>('wbRectsOverlap');
    expect(overlap([0, 0, 0.5, 0.5], [0.4, 0.4, 0.9, 0.9])).toBe(true);
    expect(overlap([0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5])).toBe(false);
  });
});
