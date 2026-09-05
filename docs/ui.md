# UI Design

## Core Principle

> 画像が主役。メタデータと系譜は必要になったときだけ見せる。

Progressive disclosure
を基本とし、Git、prompt、semantic、provenance、Story等を一覧画面へ詰め込みません。

人間の通常フローは以下です。

``` text
見る → 選ぶ → Claudeに渡す
```

Web GUI は ComfyUI へ到達しません。GUI が積んでよいのは semantic 判断を伴わない
再実行（finalize）だけで、GUI が触るのは自分の D1 の requests 行のみです
（[worker-protocol.md](worker-protocol.md)）。ComfyUI workflow の構築・実行は
comfyui-recipes（worker）が担います。

## Navigation

MVPのトップレベル導線:

``` text
Gallery
Batches
Stories
Experiments
Bookmarks
```

Graph View（`/graph`）はグローバルナビに含めません。Batch Detail / Generation
Detailの見出し横にある「Graph」リンク（`/graph?root=<short_id>&depth=3`、そのBatch起点のスコープ付き）または直接URLからのみ到達します。

## Gallery

目的:

-   良い画像を探す
-   過去Generationを再利用する
-   Bookmark / Rating / Tagを確認する

主要フィルタ:

``` text
Character
Tags
Date range
Rating
Bookmark
```

カード表示例:

``` text
[ IMAGE ]

abc123
good  🔖
#pose-good #outfit-good
```

表示しないもの:

-   commit hash
-   prompt全文
-   git diff
-   semantic全文
-   Story graph
-   ComfyUI workflow

## Batch Detail

1回の生成要求をまとめて確認する画面です。

幅1100px以上（MBP 16インチのフルスクリーン運用を想定）では、左（Generation
サムネイルグリッド）: 右（情報）= 2:1 の2ペインをビューポート1画面に収め、
各ペインが独立してスクロールします。それ未満の幅では従来どおり縦一列です。

例（2ペイン時）:

``` text
[img][img][img] | Batch B001
[img][img][img] | "結月ゆかりをseed違いで9枚"
[img][img][img] | 親 2 · 子 1 · 兄弟 0 · Story: yk-line
                | Tags / 親 / 子 / 兄弟 / Prompt / ...
```

Relation は BatchReference（生成材料） / BatchRelation（再試行） / StoryRelation（作品上の続き）の3種に分離されたまま
（CLAUDE.md の不変条件）ですが、画面上は用途別セクションではなく「親・子・兄弟」の3セクションにまとめ、各関係を
FamilyCard（サムネイル + タイプバッジ + short_id + 補足テキストの横並びカード、`family-strip`）で表示します。
サムネイルは相手Batchの代表Generation（Graph Viewの`representativeGeneration()`と同じ選定順）、または相手
GenerationそのものをFamilyCardリンク先にします。

-   親: このBatchの材料になったGeneration（バッジ `Reference`、purpose/aspect
    を表示）、このBatchをrefinementした元Batch（バッジ `Refinement`、reason
    を表示）、StoryRelationで前段にあたるBatch（バッジ `Story`、Story名/labelを表示）
-   子: このBatchのGenerationを材料に使ったBatch（バッジ `Reference`、どの
    Generation経由かを表示）、このBatchをrefinement元とするBatch（バッジ
    `Refinement`）、StoryRelationで後続にあたるBatch（バッジ `Story`）
-   兄弟: 親を共有する他のBatch。BatchRelationで同じ親からrefinementされた
    Batch、またはBatchReferenceで同じGenerationを材料に使ったBatch。共有の
    親（Batch短縮IDまたはGeneration短縮ID）をカード補足テキストに表示

各カードのリンク先・short_idはshort_id優先（Generation/Story RelationページのGraph凡例と同じ配色: Reference=青、
Refinement=橙、Story=緑）。

親セクションの直前には系譜ミニマップ（Mapセクション）を表示します。画像なし・short_idのみで、このBatch
自身のBatchReference系譜（行ラベル `References`。材料として遡れる祖先と、このBatchのGenerationを材料に
した子孫の有向到達集合をBatch単位に集約したもの。無関係な分岐は含まない）、BatchRelation連結成分（行ラベル
`Retries`、無向）、このBatchが属するStoryごとの全Batch（行ラベルはStory名）を、いずれもcreated_at昇順の
1行ずつとして、`b_abc -- b_def -- [b_ghi] -- b_jkl`のように`--`区切りの一列で
並べます。現在地（このBatch自身）は角括弧付きで強調しリンクなし、それ以外はBatch Detailへのリンクです。要素
が2件未満の行は表示せず、全行が該当する場合はMapセクション自体を表示しません。Generation Detailの
Mapと仕様は共通です。

Promptセクションはprompt / negative_promptをカンマ区切りのトークンチップで表示します（重み記法
`(foo:1.3)` `((foo))` `[foo]`、`<lora:name:0.8>`、`BREAK`をそれぞれ解釈し、weight!=1のトークンには
数値バッジ、loraは専用の色、BREAKは区切り表示にします）。カンマを含まない80文字超の自然文はチップ化せず
生テキストのまま表示します。このBatchがBatchRelationで再試行(retry)された側（incoming）を持つ場合、その
retry元Batchのprompt / negative_promptを基準にトークン単位でdiffし、追加されたトークンを緑枠、weightが
変化したトークンを黄枠（`0.8→1.3`のように基準値→現在値のバッジ）、削除されたトークンを取り消し線付きの
別行で表示します。基準にしたBatchのshort_idはセクション内に`diff base: <short_id>`として明示します。

主な操作:

-   Generation rating
-   Bookmark
-   Tag
-   複数Generation選択
-   Compare
-   provenance確認

## Compare

複数GenerationのSemantic Metadataをdiff表示します。

2〜9枚を想定します（10件以上の選択は先頭9件のみ表示し警告を出す）。

Generationごとに縦カラムで並べ、上から画像・short_idリンク・rating・character名を表示します。

``` text
[IMAGE]        [IMAGE]
abc123         xyz987
good           neutral
ゆかり         ゆかり
```

その下にsemantic比較テーブルを表示します。行はsummary、core 5項目（pose /
expression / outfit / style / composition）、strengths、defects、そして全
Generationのattributesキーの和集合。列は各Generationです。

``` text
              abc123          xyz987
summary       a girl on...    a girl on...
pose          standing        sitting
expression    smiling         —
outfit        school uniform  school uniform
style         —               —
composition   —               —
strengths     —               —
defects       —               —
lighting      backlit         —
```

同じ行で全カラムの値が一致しない場合、その行を黄系ハイライトで軽く強調表示（diff）します。
semantic未解析（semantic_jsonがNULL）のGenerationは列全体が `(not analyzed)`
になります。値がnullの項目は `—` と表示し、attributes行はすべてのGeneration
で値なしの場合は行ごと表示しません（summary / core / strengths / defects の
固定行は常に表示）。

summary・core 5項目・strengths・defects・attributesの各セマンティック行では、
基準列という概念を置かず、各セルは自分自身の値だけを表示したうえで全レーン
（行内の実値セル全体）とのコンセンサスでトークンごとに3段階のハイライトを行い
ます（他列のテキストを埋め込むことはしません）。あるトークンが同じ行の他の全レ
ーンとも一致する場合はプレーン表示、一部のレーンとだけ一致する場合は黄、どのレ
ーンとも一致しない（そのレーン固有の）場合は緑でハイライトします。strengths /
defects / 配列形式のattributesは項目単位で同じ3段階の扱いをし、1行1項目で表示
します。`(not analyzed)`、`—` のセル、行内の実値が1個以下の場合、および差分が
無いセルはdiff装飾なしのプレーン表示です。テーブル上部にはこの3段階ハイライト
を説明する凡例を表示します。

テーブルは横スクロール可能なコンテナに収め、列数が多くても崩れないようにします。

`created` 行の直後・`summary` 行の直前には、各GenerationのComfyJobから抽出した
render_facts（[domain-model.md](domain-model.md#comfyjob)参照）を `render.checkpoint` /
`render.sampler` / `render.steps` / `render.cfg` / `render.denoise` / `render.canvas` /
`render.lora` / `render.controlnet` の行として並べます。値の表現はsemantic行と同じ
コンセンサス方式のトークンハイライトを使い、行内の値が全カラムで一致しない場合は
その行を黄系ハイライト（diff）します。ComfyJobにgraphが無いGenerationはそのカラムに
`(no graph)` を表示し、全カラムが値なしの列（render_facts行）はその行ごと表示しません。

続けて `render.positive` / `render.negative` 行（各Generationのpass 1の
positive/negativeプロンプト、値の表現はsemantic行と同じコンセンサス方式の
トークンハイライト）を並べます。いずれかのGenerationが2pass以上を持つ場合は、
存在するpass indexごとに `render.positive (pass 2)` / `render.negative (pass 2)`
のように追加します（全カラムが値なしの行は表示しません）。

Compareは比較表示のみで、ComfyUIへの生成要求も指示テキストの生成も行いません。

## Generation Detail

幅1100px以上では左ペインに画像をペイン全体で表示し、右ペイン（幅比 2:1）に
情報を縦に並べます。それ未満の幅では画像を最上部に大きく表示する縦一列です。

``` text
[ IMAGE ] | abc123
[ IMAGE ] | 結月ゆかり
[ IMAGE ] | good  🔖
[ IMAGE ] | #pose-good #outfit-good
```

情報セクションは折りたたみ可能（`<details>`）ですが、既定ですべて展開して
表示します（展開クリックを不要にするため）。生JSON（Semantic の Raw JSON、
Batch Detail の Parameters）のみ既定で畳みます。

``` text
Summary
Semantic
Map
親
子
Story
Workflow
ComfyUI Job
Git
Note
```

親・子はBatch Detailと同じFamilyCard表示です（兄弟は同Batch内の他Generationに相当し表示不要）。Batch
Detailと異なり、このGenerationが属するBatch自体のRefinement/Story関係も合わせて表示するため、
それらのカードには「via batch」という補足を添えて、Generation自身の材料関係（Reference）と区別します。

-   親: ①このGenerationが属するBatch自身の材料（BatchReference、バッジ `Reference`、Generationカード。
    purpose/aspectを表示） ②そのBatchをrefinementした元Batch（バッジ `Refinement`、Batchカード＝代表
    サムネイル、reasonを表示） ③StoryRelationで前段にあたるBatch（バッジ `Story`、Batchカード）
-   子: ①このGenerationを材料に使ったBatch一覧（バッジ `Reference`、Batchカード。purpose/aspectを表示）
    ②このGenerationが属するBatchをrefinement元とするBatch（バッジ `Refinement`、Batchカード）
    ③StoryRelationで後続にあたるBatch（バッジ `Story`、Batchカード）

Mapセクションは「Map」の直下、親の直前に表示する系譜ミニマップです。画像なし・short_idのみで、このGenerationが
属するBatchのBatchReference系譜（行ラベル `References`。材料の祖先と子孫の有向到達集合をBatch単位に集約）、
BatchRelation連結成分（行ラベル `Retries`、無向）、そのBatchが属するStoryごとの全Batch（行ラベルはStory名）を、
いずれもcreated_at昇順の1行ずつとして、`b_abc -- b_def -- [b_ghi] -- b_jkl`のように`--`区切りの
一列で並べます。現在地（このGenerationが属するBatch）は角括弧付きで強調しリンクなし、それ以外はBatch
Detailへのリンクです。要素が2件未満の行（関連Batchなしの行）は表示せず、全行が該当する場合はMapセクション
自体を表示しません。

Workflowセクションは、以前の Prompt / Seed / Render facts
の3セクションを統合したもので、「Story」の直後にあります。このGenerationの
ComfyJobから抽出したrender_facts（[domain-model.md](domain-model.md#comfyjob)参照）
を使い、`/g/{short_id}` だけを見て（ほぼ）同じワークフローを再現できるだけの
情報を読みやすいレイアウトで並べます:

``` text
Model       hassaku-il-v22
LoRA        sketch-worthyhuman.safetensors @0.8 (clip 0.6)
ControlNet  openpose.safetensors @0.7 · 0–0.8
Pass 1 · node 3
  832×1664 · empty latent
  dpmpp_2m / karras · 30 steps · cfg 5 · denoise 1 · seed 1234
  positive   [chip chip chip]
  negative   [chip chip]
Pass 2 · node 12 · continues pass 1
  image upscale lanczos → 1248×1824
  dpmpp_2m / karras · 20 steps · cfg 4 · denoise 0.45 · seed 1234
  positive   same as pass 1 (または差分チップ)
  negative   同上
Output      filename_prefix
Raw graph   （折りたたみ、生JSON）
```

`Model`行はcheckpointを`  +  `区切りで結合したもの（chain_passのように複数
checkpointを経由するグラフでは複数件）に続けて、clip/vaeがあればdimな行
（`clip: … · vae: …`）を添えます。`LoRA` / `ControlNet`行はrender_facts
の各要素を1行ずつ（無ければ表示しない）。

`Pass n`は`render_facts.samplers`の並び順（node id順）で、見出しに`node
<id>`を添えます。あるpassのlatentの`from_node_id`が別のpassのsamplerの
node idと一致する場合、「continues pass k」を見出しに追加します。latentの
行はkindに応じて「WxH · empty latent」「image upscale <method> → WxH」
「latent upscale <method> → WxH」「×<scale_by> (<method>)」のいずれかです。
positive/negativeはBatch DetailのPromptセクションと同じ`PromptChips`
コンポーネントで表示します。pass 2以降の行は直前のpassのプロンプトに対する
トークン差分（追加=緑枠、weight変化=黄枠バッジ、削除=取り消し線の別行）を表示し、
trim後に完全に同じ場合は「same as pass N」とだけ表示します。

graphが無い（未抽出）場合は `(no graph)` とだけ表示したうえで、Batchの
`prompt` / `negative_prompt` をpositive/negativeのチップとして、seedは
ComfyJobの`seed`列を表示するフォールバックにします。graphがあり、かつ
Batchの`prompt`（trim後）がpass 1のpositiveと異なる場合は、dimな
「request prompt differs」行と、折りたたみ`Request prompt`（Batchの
promptをpass 1のpositiveに対して差分表示したチップ）を追加します。

`Output`行は最初の（node id順）`SaveImage`の`filename_prefix`です。
末尾の折りたたみ`Raw graph`にはComfyJobの`graph`をそのままJSON整形して表示します。

## Provenance View

全Generationを一度に描画しません。

選択Generation / Batchの周辺1 hop程度を初期表示します。

``` text
G123 -- pose ----\
                  > B200
G456 -- outfit --/
```

必要に応じて:

``` text
Show ancestors
Show descendants
```

で展開します。

## Story View

Storyは生成provenanceとは別表示にします。

各Batchは代表画像を1枚程度表示します。

``` text
B010
├─ "海へ行く" → B020
└─ "帰宅する" → B021
```

StoryRelationのlabel /
descriptionはClaude生成ですが、人間が編集できます。

Graph全体を常時表示せず、Storyを閲覧するときのみ使用します。

## Experiment View

検証テーマ単位で「何を試し、どう変え、何が良かったか」を追う画面です。

`/experiments` は一覧です。表示する軸:

``` text
name
character
status
run count
latest run
latest result
updated_at
```

status で絞り込めます。

`/experiments/{short_id}` は詳細です。Experiment概要（Base Recipe /
Character / Tag / 各時刻）、Runの一覧、Promotionの順に並べます。

Runsセクションの一覧の直前には、少なくとも1つのRunがrender_factsまたはvariablesを
持つときだけ facts テーブル（`exp-facts`）を表示します。列は
`run | checkpoint | sampler | steps | cfg | denoise | canvas | lora | controlnet`
に続けて、全Runの`variables`キーの和集合（アルファベット順）を1キー1列で追加した
ものです。値は各Runのrender_factsサマリと`variables`から取り、値なしは `—`。
baseline（`run_index`が最小のRun）以外の行では、baselineと異なる値のセルを
黄系ハイライト（`exp-facts-diff`）し、表の下に「Highlighted cells differ from
#<baseline run_index>」という凡例を出します。テーブルの2番目のtbodyには、
`overrides.patches`を持つRunごとにpatch単位の行（`#<run_index>` /
`<target> <op> <value>`、replaceは`<old> → <value>`）を並べます。

3番目のtbody（`exp-facts-prompts`）には、各Runのpass 1のpositive/negative
プロンプトをBatch DetailのPromptセクションと同じ`PromptChips`で表示します。
baseline runは値があるものだけ（`#<run_index> positive` / `#<run_index>
negative`の行、値がnullなら行ごと省略）。baseline以外のRunは、そのRunの
プロンプトがbaselineのものと異なるときだけ行を出し、baselineに対する
トークン差分（追加=緑枠、weight変化=黄枠バッジ、削除=取り消し線）として
表示します。

各Runで最も重要なのは「前回から何を変えたか」です。`overrides.patches`
（comfyui-recipesのpatch語彙、[domain-model.md](domain-model.md#experimentrun)参照）は
それ自体がbase recipeへの差分なので、leaf diffではなくRunのpatch一覧をそのまま出し、
`parent_run_id`（未指定なら直前の`run_index`）のRunが基準です。基準Runと同一のpatch
（JSON同値）はそのまま、基準Runになくこの Run で加わった patch は
`+`、基準Runにありこの Run で消えた patch は `-`
で印を付けます。override全文は折りたたみます。`overrides.patches`
の形を認識できないRun（過去データなど）だけ従来のleaf diffへfallbackします。

``` text
#1  PASS なし
    Initial overrides
      prompt.positive  append  , light purple thighhigh socks

#2  FAIL
    Changed from #1
      prompt.positive  append  , light purple thighhigh socks
    + render.cfg       set     4.5
    thumbnail / evaluation / decision
```

Runに紐づくGenerationがあればそのサムネイル、なければ Batch
の代表画像を1枚出します。evaluation / decision
は固定schemaを持たないJSONなので、`overall` / `aspects` / `notes`、`action` /
`reason` / `next_overrides` を認識できたときだけ整形し、それ以外はJSONのまま見せます。

status の変更は詳細画面のselectから行います。Experiment / Run / Promotion
の削除UIは持ちません。

baseline（`run_index`が最小のRun）以外の各Runには、baselineとの `A/B vs #<baseline
run_index>` リンクが付きます（両Runにbatchが付いている場合のみ）。リンク先はA/B Judge
Viewです。

RunsとPromotionsの間に `A/B` セクションがあります。judgmentがある baseline/arm
の組ごとに1行（`#<baseline run_index> vs #<arm run_index>`、armの勝ち数 / baselineの勝ち数
/ tie数 / 合計）、行はそのペアのA/B Judge Viewへリンクします。judgmentがなければ
「No judgments yet.」。その下にRunごとのrating内訳表（生成数 / good / neutral / bad /
unrated、batch未attachのRunも0件で表示）が並びます。

## A/B Judge View

`/experiments/{id}/ab?baseline=<run_id>&arm=<run_id>` は、baseline runとarm
runのGenerationを人間が盲検で1対1に対比較する画面です
（[domain-model.md](domain-model.md#pairwisejudgment)のPairwiseJudgment参照）。

対象は両Runのbatchに共通するseedのみです（同じseedのGenerationが両方に存在する組）。
multi-output jobで同一seedに複数枚あるときは、batch内で最初に作られた1枚だけを対象にします。
既にjudgment済みのseedは対象から除きます。

表示のたびにサーバー側でどちらをleftに置くかをランダムに決めます。画面には現在のGenerationペア
と `seed` 値だけを出し、Run名 / objective / short_id / rating
などbaseline・arm判別につながる情報は一切出しません。画像クリックでオリジナル画像を新しいタブで開きます。

投票は3つのボタン（A / Tie / B）またはキーボードショートカット（`1` /
`←` = A、`2` / `→` = B、`0` / `t` = Tie）で行います。投票すると即座に次のペアへは進まず、
判定結果の reveal（PairwiseJudgment作成レスポンスの `reveal`、
[api.md](api.md#pairwisejudgment)参照）を1行で表示します：
`A = #<left.run_index> (<left.role>) · B = #<right.run_index> (<right.role>)`
に続けて、`render_diff` の各エントリを並べます。`delta`
を持つエントリ（`positive` / `negative`）は ` · <column>: <delta>`、
それ以外は ` · <column>: <baseline> → <arm>`（差分が無ければ
` · no fact difference`）です。すでに判定済み（409）の
場合は reveal の代わりに「already judged」とだけ出します。reveal表示中は投票
ボタンを無効化し、「Next」ボタン（キーボードは Enter / Space）を押すと次のペアへ
進んでreveal表示を隠します。全seedを判定し終えたペアでもreveal自体は表示され、
Nextを押すと完了メッセージとExperiment詳細への戻りリンクの状態に遷移します。
`baseline` / `arm` が未指定・不正・別Experiment・batch未attachのRunを指すときは、
ペア画面の代わりに警告文を表示します。

## Graph View

`/graph` は生成履歴全体を1画面で見るための、`Provenance View`
とは別の高度な表示です。Provenance View が選択
Generation/Batch周辺の1 hopに留めるのに対し、Graph
Viewは全Batchを一度にレイアウトします。

グローバルナビには含まれません（[Navigation](#navigation)参照）。Batch Detailのコンテキストメニュー
「Show subgraph from here」、または直接URL（`/graph`、`/graph?root=<short_id>`等）から到達します。

サーバーサイドでレイヤード DAG レイアウトを計算し、SVG として SSR
します。

家系図のように上が親（祖先）、下が子（子孫）となる縦型レイアウトです。

``` text
layer(Batch) = 入次数ゼロのルートからの最長パス長
y = layer（上から下へ）
x = 同一layer内でのcreated_at順
```

BatchReference / BatchRelation / StoryRelationは統合せず、視覚的に区別します（Relation
Separation、`docs/domain-model.md` 参照）。

``` text
Reference   実線・青系   生成材料として何を使ったか
Refinement  破線・橙系   前Batchを受けてどう再試行したか
Story       実線・緑系   作品上の続き
```

左上に凡例（3種の線種と意味）を固定表示します。

ノードはBatchの「グループ枠」（角丸の矩形）です。中には代表Generation1枚のサムネイルのみを表示します（選定順:
`thumbnail_generation_short_id`が指すGeneration →
最初の`rating === 'good'`のGeneration → 先頭のGeneration。Generationが1件も無ければ空枠）。件数はサムネイルでは示さず、上部のヘッダー行にBatchのshort_id（monospace）と`status
· count`で表示します。ノードの高さは常に1行分の固定値です。

Reference（青）エッジは、参照元Generationが表示中の代表サムネイルと一致する場合はそのサムネイル下端から、一致しない場合（参照元が代表サムネイルとして選ばれていない、またはそのBatch自体が非表示スコープの場合）はBatch枠の下端にフォールバックして描画します。Relation（橙・破線）とStory（緑）のエッジは従来どおりBatch枠の下端→Batch枠の上端です。

ナビゲーションはコンテキストメニュー経由のみです。Batchヘッダーの左クリックは何も起きません（ページ遷移なし）。Generationサムネイルの左クリックはCompare選択のトグルです（こちらもページ遷移なし）。1件以上選択すると画面下部にCompareバーが現れ、`/compare?ids=...`
へリンクします（Galleryのcompareバーと同じ仕組み）。Generationサムネイル、またはBatchヘッダー/枠を右クリックするとコンテキストメニューが開き、「Copy
ID」「Copy URL」「Open detail」（`/g/{short_id}`または`/b/{short_id}`を新規タブで開く）、「Show
subgraph from here」（対象Batchを起点にrootスコープへ遷移）、Generationの場合はさらに「Add/Remove
from compare」のトグルを提供します。

パン/ズームはvanilla JSでSVGのviewBoxを操作します。JS
無効時はコンテナのスクロールにフォールバックし、SVG自体は常に表示されます。

サイクル（Story等が過去Batchに戻るケース）を検出した場合、そのエッジは描画は維持しつつlayer計算からのみ除外します。

### 表示スコープ

Batch数が増えるとレイアウト計算・レンダリングが重くなるため、表示範囲を絞るスコープを持ちます。白紙スタートは作らず、無指定でも必ず何かを表示します。

スコープはURLクエリパラメータのみが状態を持ちます（localStorage等での永続化はしません）。

``` text
（無指定）                 Recent: created_atが最新のBatchを起点に、エッジを無向として辿った距離3以内のBatch
?depth=N                  （root省略時）Recentの距離をNへ上書き
?active=1                 Active tree: created_atが最新のBatchを含む連結成分（エッジを無向として辿る）
?story=<story_id>         そのStoryのStoryRelationに現れるBatchのみ
?root=<short_id>          指定Batchの祖先+子孫（3種エッジすべてを辿り、有向に到達可能な集合）+自身
?root=<short_id>&depth=N  rootを起点に、エッジを無向として辿った距離N以内のBatch
?all=1                    全Batch（従来表示）
```

`depth`は1〜10の整数にclampし、パース不能な値は3として扱います。

凡例の近くにセレクタ（`Recent` / `Active tree` / `All` / Story一覧 /
root絞り込み中のみ動的に現れる`Subgraph: <short_id>`）と、現在のスコープ名と表示件数（例:
`Recent · 12 batches`）を表示します。

`root`で指定したBatchが存在しない場合はempty-stateに「Batch not found:
<値>」を表示します。Batchが1件も無い場合も同様にempty-stateを表示します。

### リトライ鎖の集約（chain collapse）

Refinement（BatchRelation、`relation`エッジ）で繋がったBatch群はほぼ再試行の鎖であり、そのままではノード数が増えて見通しを悪くします。そこでスコープ計算の前段で、`relation`エッジだけを無向に見た連結成分（サイズ2以上）を「鎖」とみなし、既定で1ノードへ畳みます。参照/Story等の他エッジ種別はこの連結成分の判定には使いません。

各鎖の代表ノードは、鎖内でcreated_atが最も新しいBatch（同値ならid順で後のもの）です。畳んだ鎖は代表ノード1個に置き換わり、サムネイルグリッドの2列目に「⟳N」バッジ（Nは鎖に含まれるBatch総数）を表示します。クリックすると、現在のURLクエリを維持したまま`?expand=<代表のshort_id>`を追加して遷移し、その鎖だけを個別Batchへ展開します。展開中の鎖の代表ノードには、ヘッダー右上に小さな「⟲」バッジが現れ、クリックすると`expand`から該当short_idを取り除いて再び畳みます。

`?expand=`には代表Batchのshort_idをカンマ区切りで並べます。また`?root=<short_id>`で指定したBatchがいずれかの鎖のメンバーである場合、そのBatchが畳まれて見えなくなることを避けるため、該当の鎖は指定がなくても自動的に展開されます。このroot起因の自動展開には「⟲」バッジを表示しません（rootが残る限り再読み込みで展開し直されるため）。

集約は`?all=1`を含むすべてのスコープに適用されます（`all=1`は「全Batchを対象にする」であって「集約しない」ではありません）。以降の距離計算・連結成分計算・Storyフィルタ・隣接除外カウントは、すべて集約後のグラフを入力とします。鎖の内部エッジ（畳んだ鎖同士を結ぶ`relation`エッジ、および鎖の内部だけを結ぶ参照/Storyエッジ）は破棄し、鎖の外から鎖のメンバーへ向かうエッジは代表ノード宛てに付け替えます。付け替えた結果、種別・両端・Story IDが一致するエッジが複数生じた場合は1本にまとめます。

スコープセレクタでの遷移（`Recent` / `Active tree` / `All` / Story切り替え）はクエリを作り直すため、`expand`は引き継がれません。

### ドリルダウン（隠れた隣接Batch）

スコープによって除外されたBatchがある場合、表示中のBatchのうち除外されたBatchへ直接（無向で）隣接しているものは、サムネイルグリッドの3列目に「⋯
+N」スタブを表示します（Nはそのカードから見た、非表示になっている直接隣接Batchの数）。スタブをクリックすると、そのBatchを起点に`?root=<short_id>&depth=3`へ遷移し、隠れていた周辺を表示します。集約された鎖の代表ノードは、鎖の外にある隣接Batchが非表示スコープにある場合、集約バッジ（⟳N）と並んでこのスタブも表示することがあります。

## Bookmarks

Bookmarkした対象を素早く呼び出します。

``` text
Generations
Batches
Stories
Experiments
```

BookmarkはFavoriteではなく再利用・再訪のための導線です。

## Search

MVPの検索条件:

``` text
Character
Tags
Date range
Rating
Bookmark
```

ComfyUI Job ID / original filenameによる逆引きも提供します。

prompt全文検索、semantic全文検索、高度なgraph queryはMVP対象外です。

## Tag Editing

Tagは自由入力ですが、既存Tagを優先表示します。

例:

``` text
入力: pose

候補:
#pose-good
#pose-bad
#pose-reference

[新規タグ "pose" を作成]
```

類似Tagの乱立を避けるため、Claudeにも既存Tag再利用を推奨します。

## Rating

Generationカード上から3段階で変更できることを想定します。

``` text
bad
neutral
good
```

## Bookmark

Generation / Batch / Story /
Experimentの各画面で1操作で切り替えられるようにします。

## Responsive / Density

画像一覧の密度は重要ですが、metadataを増やして情報密度を上げないこと。

画像サイズと列数をレスポンシブに調整し、semantic情報はDetailへ退避します。
