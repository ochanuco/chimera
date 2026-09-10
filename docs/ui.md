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
再実行（finalize / repair）だけで、GUI が触るのは自分の D1 の requests 行のみです
（[worker-protocol.md](worker-protocol.md)）。ComfyUI workflow の構築・実行は
comfyui-recipes（worker）が担います。

## Navigation

トップレベル導線は、ブランド `Chimera`（`/gallery` へのリンク）に続けて次の項目です。

``` text
Chimera
Gallery
Bookmarks
More（Batches / Experiments）
```

`More` は `<details><summary>`によるJSなしのドロップダウンです。開くと `Batches`
`Experiments` の2リンクを持つパネルが summary の直下に現れます。

現在地に対応するナビ項目には`aria-current="page"`を付け、下線（`text-decoration-color:
var(--accent)`）で強調します。`/gallery`ではGallery、`/bookmarks`ではBookmarks、`/batches`
`/b/{short_id}` `/experiments` 配下（`/experiments/{short_id}` `/experiments/{short_id}/ab`
含む）では`More`のsummaryがアクティブになります。`/g/{short_id}` `/compare`はどの項目もアクティブに
なりません。

幅600px以下では、ナビの水平パディングを1rem・項目間隔を1.25remに詰め、各リンクと`More`の
summaryはタップ領域確保のため`min-height: 2.75rem`のフレックスボックスにします。

パスと内容の対応:

| パス | 内容 |
|---|---|
| `/gallery` | 画像グリッド。`finalize以外` / `finalize` / `すべて` の3-way切り替え、bad表示トグル、ID / Tag / Rating / Bookmarkの絞り込み、カード上で rating・bookmark 変更、無限スクロール |
| `/batches`, `/b/{short_id}` | 生成リクエスト単位の一覧・詳細 |
| `/g/{short_id}` | Generation 詳細（canonical URL）。Summary / Semantic / References / Story / Prompt / Seed / Git などは折りたたみ表示 |
| `/bookmarks` | Bookmark した Generation / Batch / Experiment |
| `/compare?ids=a,b` | 2〜9枚比較。aspect を選んで Claude へ渡す指示テキストを生成・コピー |
| `/experiments`, `/experiments/{short_id}` | Experiment の一覧・詳細。Run ごとの override 差分・評価・Promotion を表示 |

Story一覧・DAG表示（`/stories`）と生成履歴全体のGraph表示（`/graph`）のSSR画面は持ちません。Batch
Detail / Generation Detailは所属Storyの名前をリンクなしのテキストで表示します。`/api/v1/stories`
`/api/v1/graph`のJSON APIとStory関連のMCPツールは引き続き提供します（[api.md](api.md)参照）。

## Gallery

目的:

-   良い画像を探す
-   過去Generationを再利用する
-   Bookmark / Rating / Tagを確認する

nav直下にsticky なツールバーを持ちます。

``` text
[ finalize以外 | finalize | すべて ]   bad も表示 ☐   [ 絞り込み ▾ ]
```

`view` は3値の切り替えです。既定は `view=raw`（finalize/repair/masked_redraw
の出力ではない raw Generation のみ）で、`view=refined`（finalize
済みの出力のみ）、`view=all`（両方）へ切り替えられます。raw / finalize済みの判定は Batch の
`refines_generation_id`（[domain-model.md](domain-model.md#batch)）です。

「bad も表示」は既定で隠している bad rating の Generation を表示に加えるトグルです
（`bad=1`）。未評価・good・neutralの Generation は常に表示します。

`絞り込み`パネル（`<details>`。いずれかの項目に値が入っているときは開いた状態で描画）は
次を持ちます。

``` text
ID（複数可、改行またはカンマ区切り、short_id と UUID の混在可）
Tag
Rating
Bookmarked only
公開済みのみ
```

「公開済みのみ」は`published=true`（[api.md](api.md#generation-search)）で、少なくとも1件
[Publication](domain-model.md#publication)を持つGenerationだけに絞ります。他のフィルタと
同じくview/badトグルをまたいで保持され、いずれかの項目に値が入っているかの判定にも数えます。

Character / 日付範囲 / ComfyUI Job ID / original filenameによる絞り込みはGUIから外しました
（`GET /api/v1/generations`はこれらのqueryを引き続き受け付けます。agentがMCP/APIから直接
叩く用途、[api.md](api.md#generation-search)参照）。

`ID`の指定を解決した結果がGeneration 1件だけになったとき（他の指定と組み合わせた結果も
含む）は一覧を描画せず`/g/{short_id}`へ直接遷移します。0件・2件以上のときは通常どおり
一覧を表示します。`ID`を指定した検索は`view`とbad非表示を無視し、指定したGenerationだけを
返します。

一覧はPrev/Nextページングの代わりに無限スクロールです。グリッド末尾の「もっと見る」
リンクが画面に入ると次ページを自動でフェッチしてグリッドへ追記します（JS無効環境では
リンクとして機能します）。

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
                | Finalize all arms / Tags / 親 / 子 / 兄弟 / Prompt / ...
```

Relation は BatchReference（生成材料） / BatchRelation（再試行） / StoryRelation（作品上の続き）の3種に分離されたまま
（CLAUDE.md の不変条件）ですが、画面上は用途別セクションではなく「親・子・兄弟」の3セクションにまとめ、各関係を
FamilyCard（サムネイル + タイプバッジ + short_id + 補足テキストの横並びカード、`family-strip`）で表示します。
サムネイルは相手Batchの代表Generation（指定サムネイル → 先頭の`rating === 'good'`のGeneration →
先頭のGeneration、の優先順で選ぶ）、または相手GenerationそのものをFamilyCardリンク先にします。

-   親: このBatchの材料になったGeneration（バッジ `Reference`、purpose/aspect
    を表示）、このBatchをrefinementした元Batch（バッジ `Refinement`、reason
    を表示）、StoryRelationで前段にあたるBatch（バッジ `Story`、Story名/labelを表示）、
    このBatchに紐づくExperimentRunの親Run（`parent_run_id`が指すRun）のBatch
    （バッジ `Experiment`、`run #親 → run #自分`を表示）
-   子: このBatchのGenerationを材料に使ったBatch（バッジ `Reference`、どの
    Generation経由かを表示）、このBatchをrefinement元とするBatch（バッジ
    `Refinement`）、StoryRelationで後続にあたるBatch（バッジ `Story`）、
    このBatchに紐づくExperimentRunを`parent_run_id`とする子RunのBatch
    （バッジ `Experiment`、`run #自分 → run #子`を表示）
-   兄弟: 親を共有する他のBatch。BatchRelationで同じ親からrefinementされた
    Batch、またはBatchReferenceで同じGenerationを材料に使ったBatch。共有の
    親（Batch短縮IDまたはGeneration短縮ID）をカード補足テキストに表示。加えて、
    同じExperimentの他Run（親・子を除く、batch付与済みのRunのみ）のBatch
    （バッジ `Experiment`）

`Experiment` バッジのカードはBatchReference / BatchRelation / StoryRelationのいずれでもない、
ExperimentRun（`parent_run_id` / `run_index`）から読み取り時に導出するだけの表示専用の4本目の軸です
（CLAUDE.mdの3種統合禁止の対象外で、行を作りません）。カードの補足テキストにはExperiment名を表示します。

各カードのリンク先・short_idはshort_id優先（Reference/Refinement/Storyはそれぞれ固定配色:
青・橙・緑。Experimentは他3種のいずれでもない4本目の軸なので専用の紫）。

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

Finalize all armsセクションは、このBatch配下の全GenerationについてFinalizeと
同じoptions（`repin` / `recolor` / `keep legwear` / `denoise`）で1 Generation
1行のfinalize requestを順に積みます（Generation Detailの Finalize
参照、[worker-protocol.md](worker-protocol.md)）。直下には
`finalize: N queued · M running · K done · F failed`の集計行と、その下に各requestを
1行ずつ持つ`request-status-list`を表示します（進捗の反映はGeneration Detailの
Finalizeセクションと同じ仕組み、後述）。

主な操作:

-   Generation rating
-   Bookmark
-   Tag
-   複数Generation選択
-   Compare
-   Finalize all arms
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
公開
Finalize
Summary
Semantic
Map
親
子
兄弟
Story
Workflow
ComfyUI Job
Git
Note
```

`公開`セクションはrating/bookmark行の直後にあります。[Publication](domain-model.md#publication)
が1件以上あれば送信アイコン付きで`公開済み（N）`を`#4fd8a4`で、無ければ`未公開`を
`--text-dim`で表示します。続けて記録済みのPublicationを`MM-DD HH:mm`（`--text-dim`）・
URL（あればリンク、無ければ`URL なし`と埋め込み用のURL入力欄）・`×`削除ボタンの行として
新しい順に並べ、末尾に`投稿 URL（空でも記録できる）`のテキスト入力と`公開を記録`ボタン
（枠線・文字とも`#4fd8a4`、角丸6px）の追加フォームを置きます。追加・URL入力・削除の
いずれも`/api/v1/generations/{id}/publications`・`/api/v1/publications/{id}`をfetchし、
リロードなしでセクションを書き換えます。

親・子・兄弟はBatch Detailと同じFamilyCard表示です。Batch
Detailと異なり、このGenerationが属するBatch自体のRefinement/Story関係も合わせて表示するため、
それらのカードには「via batch」という補足を添えて、Generation自身の材料関係（Reference）と区別します。
兄弟はBatchReference由来のもの（同じ材料Generationを使った他Batch）は出しません。それはこの
Generationが属するBatchの他のGenerationと実質同じものだからです。ExperimentRunの兄弟（同じ
Experimentの他Run、親・子を除く）だけを表示します（バッジ `Experiment`、「via batch」）。

-   親: ①このGenerationが属するBatch自身の材料（BatchReference、バッジ `Reference`、Generationカード。
    purpose/aspectを表示） ②そのBatchをrefinementした元Batch（バッジ `Refinement`、Batchカード＝代表
    サムネイル、reasonを表示） ③StoryRelationで前段にあたるBatch（バッジ `Story`、Batchカード）
    ④このBatchに紐づくExperimentRunの親Run（バッジ `Experiment`、Batchカード）
-   子: ①このGenerationを材料に使ったBatch一覧（バッジ `Reference`、Batchカード。purpose/aspectを表示）
    ②このGenerationが属するBatchをrefinement元とするBatch（バッジ `Refinement`、Batchカード）
    ③StoryRelationで後続にあたるBatch（バッジ `Story`、Batchカード）
    ④このBatchに紐づくExperimentRunの子Run（バッジ `Experiment`、Batchカード）
-   兄弟: このBatchに紐づくExperimentRunと同じExperimentの他Run（親・子を除く、batch付与済みの
    Runのみ）のBatch（バッジ `Experiment`、Batchカード）

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

右ペイン最上部のFinalize / Repairセクションは、段階2の唯一の生成要求手段です（不変条件:
GUIが積んでよいのはsemantic判断を伴わない再実行=finalize / repairだけ。ComfyUIへは
到達しない。[worker-protocol.md](worker-protocol.md)参照）。フォームは3つの
`fieldset`（`仕上げ` / `納品の見た目` / `部分描き直し`）にグループ化されます。各
コントロール名自体は`comfy-recipes` CLIのフラグ名（worker-protocol.md参照）に
揃えて英語のままとし、ラベル直後に`?`の`finalize-help`マーカーを添えます。マーカーは
ホバー/フォーカスで日本語の説明を`::after`吹き出しで表示するだけのCSS実装（JS不使用）で、
`repair hands` / `repair feet`は1つのマーカーを共有します。

仕上げグループは`repin` / `recolor` / `keep legwear`のチェックボックスと、空欄が
recipe既定を意味する`denoise`の数値入力を持ちます。`recolor`はBatchのrecipeが
`yukari`のときだけ表示します（`yukari-sketch`のfinalizeはrecolorを受け付けず、
workerが`failed`にします）。

納品の見た目グループは`backdrop`のselect（`stripes`既定 / `transparent` /
`color`）を持ち、`color`を選ぶとlabel内に置かれた`#RRGGBB`のテキスト入力が
現れます（空か形式違いなら送信せずalertします）。続けて`stroke light（影の向き）`の
select（`none`既定と8方位）を持ちます。選択肢は矢印だけを出し、矢印は影が伸びる
向きです。`→`なら影は右で、紫縁もその側が太くなります。送る値そのもの（`n`..`nw`）は
光源の方位なので矢印とは逆を指しますが、これはworker / MCP / CLIと共通の語彙で、
GUIだけ入れ替えると同じ値が画面とAPIで別物になるため対応は変えません。

部分描き直しグループは`repair hands` / `repair feet`のチェックボックス（既定どちらも
off。1つ以上チェックすると`repair`配列を積みます）と、`repair pad`の数値入力
（空欄が省略=worker既定を意味する）を持ちます。`repair pad`はrepair hands /
repair feetのどちらもチェックされていない間`disabled`で、どちらかをチェックすると
有効になります。

送信ボタンの上には`finalize-preview`の一行があり、フォームの現在値から実際に
積まれるoptionsのkeyだけを`送信内容: repin, backdrop=stripes`のように表示します
（backdropが不正な値のときは`送信内容: —`）。`backdrop`は常に送るキーなので
必ず出し、`transparent`を選んで`null`を送る場合も`backdrop=transparent`と表示します。この表示はsubmit時と同じ
serializer（`finalizeOptionsFrom`）を使うため、送信内容とズレません。Finalize all
armsも同じ項目・同じ条件です。
Finalizeボタンで`POST /api/v1/requests`（`kind: "finalize"`, `created_by:
"gui"`）を1件積んでページを再読み込みします。その下には、このGenerationを対象と
した最新のrequest（finalize / repair）を最大5件、新しい順に`status · created_at`の行として
表示し、`done`なら納品Generationへのリンク、`failed`ならその`error`を添えます。

各行は`data-request-id` / `data-request-status`を持ち、`/api/v1/requests/ws`
（段階3 WorkerHub、[worker-protocol.md](worker-protocol.md#段階-3-workerhub)参照）に
繋いだ`initRequestLive()`が接続直後の`snapshot`と以後の`progress` / `status`を
受けて、行内の`.request-progress`に`phase step/total`（stepが無ければ`phase`のみ）を、
`status`変化時は行のクラスと表示statusを書き換えます。Batch Detailの
Finalize all armsセクションでも、集計行の下に同じ`request-status-list`を出し、
同じ仕組みで各行が更新されます。WebSocketが張れない環境でも静的な表示のまま
壊れません（未対応・切断時は1秒→30秒のバックオフで再接続を試み続けます）。

手足の局所redraw（[worker-protocol.md](worker-protocol.md#repair)の`repair`）は
GUIでは独立したセクションを持たず、Finalizeフォームの`repair hands` / `repair feet`
から同じfinalize requestに乗せます。`kind: "repair"`のrequestはAPI / MCPからだけ積め、
このGenerationを対象にした行はFinalizeセクションのrequest一覧にfinalizeと並んで出ます。

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

`/experiments/{short_id}` は詳細です。Experiment概要（Base Recipe / Base
Generation（サムネイル付きリンク） / Character / Tag / 各時刻）、Runの一覧、
Promotionの順に並べます。

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

## Bookmarks

Bookmarkした対象を素早く呼び出します。

``` text
Generations
Batches
Experiments
```

BookmarkはFavoriteではなく再利用・再訪のための導線です。

GenerationsセクションはGalleryと同じ3-way view switch（`finalize以外` / `finalize` /
`すべて`）を持ちますが、既定は`view=refined`（finalize済みの出力）です。bad非表示の
トグルはありません。Batches / Experimentsセクションにはこの切り替えはありません。

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

Generation / Batch /
Experimentの各画面で1操作で切り替えられるようにします。

## Responsive / Density

画像一覧の密度は重要ですが、metadataを増やして情報密度を上げないこと。

画像サイズと列数をレスポンシブに調整し、semantic情報はDetailへ退避します。

## Telemetry

UI/UXを改善するため、人間がブラウザ上で行った操作のログをPostHogに送ります。
MCP / APIを直接叩くエージェントの操作はブラウザを通らないため対象外です。

`POSTHOG_KEY` secret（`wrangler secret put POSTHOG_KEY`）を設定すると有効になります。
未設定の場合、`/assets/telemetry.js`は何も初期化しない空のJSを返し、telemetryは完全に
無効になります。`POSTHOG_HOST`は省略時`https://us.i.posthog.com`です。

Cloudflare Accessで認証されたメールアドレス（`Cf-Access-Authenticated-User-Email`
ヘッダ）があれば`posthog.identify`でそのユーザーとして識別します。ヘッダが無い
リクエスト（Access境界の外、またはヘッダ未設定）は匿名のままです。

autocapture・pageview・pageleaveに加えセッションリプレイも有効化していますが、
リプレイの記録自体はPostHog側のプロジェクト設定でも有効化が必要です。

イベント名は「名詞.動詞」の形にしています。`ui.error`は各操作が失敗したときの
共通イベントで、`action`にどの操作が失敗したかを記録します。

| event | properties | 発火箇所 |
| --- | --- | --- |
| `rating.set` | `generation_id`, `rating`, `previous` | Generationのrating変更（`initRating`） |
| `bookmark.toggle` | `kind`, `id`, `bookmarked` | bookmarkの切り替え（`initBookmark`） |
| `experiment.status` | `experiment_id`, `from`, `to` | Experimentのstatus遷移（`initExperimentStatus`） |
| `tag.add` | `kind`, `id`, `tag` | tag追加（`initTagAdd`） |
| `tag.remove` | `kind`, `id`, `tag_id` | tag削除（`initTagRemove`） |
| `note.save` | `kind`, `id`, `length` | noteの保存（`initNoteForm`） |
| `publication.add` | `generation_id`, `has_url` | Publicationの追加（`initPublicationAdd`） |
| `publication.url` | `generation_id`, `has_url` | PublicationのURL入力（`initPublicationUrlSave`） |
| `publication.remove` | `generation_id`, `has_url` | Publicationの削除（`initPublicationRemove`） |
| `finalize.submit` | `scope`（`one` / `all`）, `generation_id` または `count`, finalizeオプション | finalize送信（`initFinalize` / `initFinalizeAll`） |
| `judge.pick` | `experiment_id`, `verdict`, `seed`, `index`, `judged`, `duplicate`（既判定時のみ） | A/B judgeの投票（`initAbJudge`） |
| `compare.open` | `count` | Compareへ遷移（`initCompareBar`） |
| `gallery.filter` | filter-formの各入力値 | Galleryのfilter送信（`initGalleryFilter`） |
| `gallery.view` | `view`, `bad` | Gallery / Bookmarksのview切り替え・bad表示トグル（`initGalleryView`） |
| `ui.error` | `action`, `message`, `status`, 該当操作のprops | 上記操作の失敗時 |
