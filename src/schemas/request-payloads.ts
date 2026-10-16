import { z } from 'zod';
import { DIAL_WORD_RE, HEX_COLOR_RE, MAX_FRAME_STROKES, MAX_FRAME_STROKE_POINTS, MAX_OUTLINES, MASKED_REDRAW_MAX_DENOISE, dofScopeIssues, lensOptionsIssues, maskedRedrawOptionsIssues, stageOptionsIssues } from '../lib/request-rules';
import { addIssues } from './issues';

/** worker に渡す payload の語彙 (docs/worker-protocol.md)。kind ごとの封筒の検証は lib/request-payload.ts が引く。 */
export const jsonObject = z.record(z.string(), z.unknown());

const dialWord = z.string().regex(DIAL_WORD_RE);

/** repair region は width/height に対する分数の矩形 [x0,y0,x1,y1] (x0<x1, y0<y1)。 */
const repairRegionSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1, {
    message: 'region must have x0 < x1 and y0 < y1',
  });

/** Same coordinate convention as repair, but deliberately a separate schema: masked redraw requires
 * >=1 rectangle and rejects overlaps so the worker gets an unambiguous mask union. */
export const maskedRedrawRegionSchema = repairRegionSchema;

/** redraw / deliver の options は worker の引数に 1 対 1 で写す (docs/worker-protocol.md「redraw」「deliver」)。
 * 組み合わせの妥当性は worker が判定して failed にする — chimera は型だけ見る。 */
const denoiseField = z.union([z.number(), dialWord]).nullable().optional();
const keepLegwearField = z.union([z.literal(true), z.number(), dialWord]).nullable().optional();
const routeField = z.enum(['latent', 'pixel']).nullable().optional();
const finalizerField = z.string().nullable().optional();
const sizeField = z.number().int().nullable().optional();
const upscaleField = z.enum(['bicubic', 'nearest-exact', 'bilinear', 'lanczos']).nullable().optional();
// worker は keep_regions / keep_strength の null を型エラーにするので、他の option と違い nullable にしない。
const keepRegionsField = z.array(repairRegionSchema).optional();
const keepStrengthField = z.number().gt(0).lt(1).optional();
const hiresField = z.number().int().min(64).nullable().optional();
const hiresDenoiseField = z.number().gt(0).lte(1).nullable().optional();
const repinField = z.boolean().optional();
const recolorField = z.boolean().optional();
const skinField = z.boolean().optional();
const keepSceneField = z.boolean().optional();
const transparentField = z.boolean().nullable().optional();
const backdropField = z.string().nullable().optional();
const strokeLightField = z.enum(['even', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']).nullable().optional();
const deliverSizeField = z.number().int().nullable().optional();
const seeThroughField = z.number().min(1).max(5).nullable().optional();
const outlineSchema = z
  .object({ color: z.string().regex(/^#[0-9a-f]{6}$/i), width: z.number().gt(0).lte(5) })
  .strict();
const outlinesField = z.array(outlineSchema).max(MAX_OUTLINES).nullable().optional();
const cutField = z.boolean().optional();
const lightSceneField = z.enum(['sunset', 'moon']);
const lightFromField = z.enum(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']).optional();
const lightField = z
  .object({ scene: lightSceneField, from: lightFromField })
  .strict()
  .nullable()
  .optional();

/** redraw の options は絵を変える 1 つの method だけを選ぶ (docs/worker-protocol.md「redraw」)。 */
export const redrawOptionsSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('canvas'),
      denoise: denoiseField,
      size: sizeField,
      route: routeField,
      finalizer: finalizerField,
      upscale: upscaleField,
      keep_regions: keepRegionsField,
      keep_strength: keepStrengthField,
      cut: cutField,
    })
    .strict(),
  z.object({ method: z.literal('hires'), hires: hiresField, denoise: hiresDenoiseField, cut: cutField }).strict(),
  z.object({ method: z.literal('light'), scene: lightSceneField.optional(), from: lightFromField, cut: cutField }).strict(),
]);

/** deliver の options は切り抜き後の飾りだけ (docs/worker-protocol.md「deliver」)。 */
export const deliverOptionsSchema = z
  .object({
    repin: repinField,
    recolor: recolorField,
    skin: skinField,
    keep_legwear: keepLegwearField,
    keep_scene: keepSceneField,
    transparent: transparentField,
    backdrop: backdropField,
    stroke_light: strokeLightField,
    outlines: outlinesField,
    deliver_size: deliverSizeField,
    light: lightField,
    see_through: seeThroughField,
  })
  .strict();

/** deliver payload の `profile` — a deliver preset の参照 (docs/worker-protocol.md「deliver profile」)。version 省略は最新 active 版。 */
export const deliverProfileRefSchema = z
  .object({
    name: z.string().min(1),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const redrawPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: redrawOptionsSchema,
  })
  .strict();

export const deliverPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: deliverOptionsSchema.optional(),
    profile: deliverProfileRefSchema.optional(),
  })
  .strict();

/** dof の options (docs/worker-protocol.md「dof」)。入力は deliver の出力だけで、worker が判定する。 */
const unitPoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

/** dof の options。stand_at / nearer / tilt / bokeh / focal_length は写真に置いた絵（stage の photo）だけが受け、ほかの絵では worker が拒む。 */
export const dofOptionsSchema = z
  .object({
    focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    f_number: z.number().min(1.4).max(22).optional(),
    scope: z
      .object({ figure: z.boolean().optional(), outline: z.boolean().optional(), backdrop: z.boolean().optional() })
      .strict()
      .superRefine((scope, ctx) => addIssues(ctx, dofScopeIssues(scope)))
      .optional(),
    viewfinder: z.enum(['off', 'on', 'both']).optional(),
    stand_at: unitPoint.nullable().optional(),
    nearer: z.number().min(0).max(1).optional(),
    tilt: z.number().min(-1).max(1).optional(),
    bokeh: z.number().min(0).max(1).optional(),
    // A lens name from the catalog's photo.focal_length values; the worker checks it, so a lens added there needs no change here.
    focal_length: z.string().min(1).optional(),
  })
  .strict();

export const dofPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: dofOptionsSchema,
  })
  .strict();

/** lens の options (docs/worker-protocol.md「lens」)。入力は納品された絵で、worker が判定する。strength は正で魚眼 / 膨らみ、負で逆魚眼 / すぼまり、0 は不可。
 * radius は shape = sphere のときだけ受ける。 */
export const lensOptionsSchema = z
  .object({
    center: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
    strength: z
      .number()
      .min(-1)
      .max(1)
      .refine((strength) => strength !== 0, { message: 'strength must not be 0' })
      .optional(),
    shape: z.enum(['fisheye', 'sphere']).optional(),
    radius: z.number().min(0.05).max(1).optional(),
  })
  .strict()
  .superRefine((options, ctx) => addIssues(ctx, lensOptionsIssues(options)));

export const lensPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: lensOptionsSchema.optional(),
  })
  .strict();

/** photo の options (docs/worker-protocol.md「photo」)。入力は層 asset を持つ deliver の出力で、photo は背景にする写真の Generation。worker が判定する。 */
export const photoOptionsSchema = z
  .object({
    photo: z.string().min(1),
    // y may go below the frame (up to 1.5) to crop the card's feet.
    place: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1.5)]).optional(),
    height: z.number().min(0.05).max(1.5).optional(),
    stand_at: unitPoint.nullable().optional(),
    nearer: z.number().min(0).max(1).optional(),
    focus: z.union([z.literal('subject'), unitPoint]).optional(),
    f_number: z.number().min(1.4).max(22).optional(),
    tilt: z.number().min(-1).max(1).optional(),
    bokeh: z.number().min(0).max(1).optional(),
    // A lens name from the catalog's photo.focal_length values; the worker checks it, so a lens added there needs no change here.
    focal_length: z.string().min(1).optional(),
  })
  .strict();

export const photoPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: photoOptionsSchema,
  })
  .strict();

/** repair の options は masked local redraw (hands/feet) の worker 側引数に写す (docs/worker-protocol.md「repair」)。chimera は型だけ見る。 */
export const repairOptionsSchema = z
  .object({
    parts: z.array(z.enum(['hands', 'feet'])).optional(),
    regions: z.array(repairRegionSchema).optional(),
    denoise: z.union([z.number().gt(0).lte(1), dialWord]).nullable().optional(),
    seeds: z.array(z.number().int().nonnegative()).min(1).max(16).optional(),
    size: z.number().int().min(256).multipleOf(8).nullable().optional(),
    pad: z.number().min(0.5).max(3).nullable().optional(),
    lora: z.union([z.literal(true), z.number(), dialWord]).nullable().optional(),
  })
  .strict();

export const repairPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: repairOptionsSchema.optional(),
  })
  .strict();

/** Generic masked-img2img/inpaint options. `mask_padding`/`mask_feather` are pixel distances the worker
 * applies after resolving image dimensions. `pad`/`feather` are compatibility aliases (shorter repair
 * vocabulary), canonicalized before a request is persisted. */
export const maskedRedrawOptionsSchema = z
  .object({
    regions: z.array(maskedRedrawRegionSchema).min(1, 'at least one region is required'),
    prompt_patch: z.string().trim().min(1, 'prompt_patch must not be empty').max(4096),
    denoise: z.union([z.number().gt(0).lte(MASKED_REDRAW_MAX_DENOISE), dialWord]).optional(),
    mask_padding: z.number().min(0).max(512).optional(),
    mask_feather: z.number().min(0).max(256).optional(),
    pad: z.number().min(0).max(512).optional(),
    feather: z.number().min(0).max(256).optional(),
    size: z.number().int().min(256).multipleOf(8).nullable().optional(),
    seeds: z.array(z.number().int().nonnegative()).min(1).max(16).optional(),
  })
  .strict()
  .superRefine((value, ctx) => addIssues(ctx, maskedRedrawOptionsIssues(value)));

export const maskedRedrawPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: maskedRedrawOptionsSchema,
  })
  .strict();

const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

const frameCoord = z.number().min(-1).max(2);
const frameRect = z.tuple([frameCoord, frameCoord, frameCoord, frameCoord]);
const frameColor = z.string().regex(HEX_COLOR_RE);
const frameSide = z.enum(['cut', 'out', 'behind']);

/** stage の frame (docs/worker-protocol.md「stage」)。座標は納品画像のキャンバスに対する分数。x0<x1 などの組み合わせは stageOptionsIssues が見る。 */
const frameSchema = z
  .object({
    box: frameRect,
    sides: z
      .object({ top: frameSide.optional(), right: frameSide.optional(), bottom: frameSide.optional(), left: frameSide.optional() })
      .strict()
      .optional(),
    line: z
      .object({ color: frameColor.optional(), width: z.number().min(0).max(5).optional(), pattern: z.enum(['solid', 'slash']).optional() })
      .strict()
      .nullable()
      .optional(),
    rim: z
      .object({ color: frameColor.optional(), width: z.number().min(0).max(5).optional() })
      .strict()
      .nullable()
      .optional(),
    paper: frameColor.optional(),
    canvas: z.tuple([frameCoord.nullable(), frameCoord.nullable(), frameCoord.nullable(), frameCoord.nullable()]).optional(),
    expand: z
      .union([
        z.boolean(),
        z.object({ top: z.boolean().optional(), right: z.boolean().optional(), bottom: z.boolean().optional(), left: z.boolean().optional() }).strict(),
      ])
      .optional(),
    strokes: z
      .array(
        z
          .object({
            mode: z.enum(['erase', 'restore']),
            width: z.number().gt(0).max(20),
            points: z.array(z.tuple([frameCoord, frameCoord])).min(1).max(MAX_FRAME_STROKE_POINTS),
          })
          .strict(),
      )
      .max(MAX_FRAME_STROKES)
      .optional(),
  })
  .strict();

/** stage（背景）の options (docs/worker-protocol.md「stage」)。photo があれば写真に place / height で置き、無ければ backdrop（柄名か #RRGGBB）に
 * shadow_from の影で置く（frame は柄の組で、人物を枠に入れる）。二組は混ぜない。入力は層 asset を持つ deliver の出力で、worker が判定する。 */
export const stageOptionsSchema = z
  .object({
    photo: z.string().min(1).optional(),
    place: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1.5)]).optional(),
    height: z.number().min(0.05).max(1.5).optional(),
    backdrop: z.string().min(1).optional(),
    shadow_from: z.enum(COMPASS).nullable().optional(),
    frame: frameSchema.optional(),
    // 背景を染めるシーン。省略は系譜の light redraw を引き継ぎ、null はなし。
    light: z
      .object({ scene: z.enum(['sunset', 'moon']), from: z.enum(COMPASS).optional() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((options, ctx) => addIssues(ctx, stageOptionsIssues(options)));

export const stagePayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: stageOptionsSchema.optional(),
  })
  .strict();

/** lighting（光）の options (docs/worker-protocol.md「lighting」)。入力は stage の出力か背景ありの納品で、worker が判定する。 */
export const lightingOptionsSchema = z
  .object({
    direction: z.enum(COMPASS).nullable().optional(),
    strength: z.number().min(0).max(1).optional(),
    // 夕日・月明かりのシーンで照らす。柄の背景もそのシーンに染め、写真の背景は変えない。
    scene: z.enum(['sunset', 'moon']).nullable().optional(),
  })
  .strict();

export const lightingPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: lightingOptionsSchema.optional(),
  })
  .strict();

/** generate の payload は request.json v1 をそのまま包む (generation-request.md)。この schema が検証するのは封筒の形だけで、中身の語彙は見ない (`generation.patches` の文法だけは作成時に lib/patch-grammar.ts が見る)。 */
export const generatePayloadSchema = z
  .object({
    schema_version: z.literal(1),
    request: jsonObject,
    generation: jsonObject,
  })
  .passthrough();
