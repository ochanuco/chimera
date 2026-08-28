# UI Design

## Core Principle

> 画像が主役。メタデータと系譜は必要になったときだけ見せる。

Progressive disclosure
を基本とし、Git、prompt、semantic、provenance、Story等を一覧画面へ詰め込みません。

人間の通常フローは以下です。

``` text
見る → 選ぶ → Claudeに渡す
```

Web GUI 自身を ComfyUI の生成オーケストレーターにはしません。

## Navigation

MVPのトップレベル導線:

``` text
Gallery
Batches
Stories
Bookmarks
```

Experimentは主要導線にせず、Batch等から辿れる程度でも構いません。

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
（CLAUDE.md の不変条件）ですが、画面上は用途別セクションではなく「親・子・兄弟」の3セクションにまとめ、各行に
タイプバッジ（`Reference` / `Refinement` / `Story`）を付けて区別します。

-   親: このBatchの材料になったGeneration（バッジ `Reference`、purpose/aspect
    を表示）、このBatchをrefinementした元Batch（バッジ `Refinement`、reason
    を表示）、StoryRelationで前段にあたるBatch（バッジ `Story`、Story名にリンク）
-   子: このBatchのGenerationを材料に使ったBatch（バッジ `Reference`、どの
    Generation経由かを表示）、このBatchをrefinement元とするBatch（バッジ
    `Refinement`）、StoryRelationで後続にあたるBatch（バッジ `Story`）
-   兄弟: 親を共有する他のBatch。BatchRelationで同じ親からrefinementされた
    Batch、またはBatchReferenceで同じGenerationを材料に使ったBatch。共有の
    親（Batch短縮IDまたはGeneration短縮ID）を表示

各行のリンクはshort_id優先（Generation/Story RelationページのGraph凡例と同じ配色: Reference=青、
Refinement=橙、Story=緑）。

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
行内で最初に実値を持つ列を基準（base）とし、他の列をbaseとのトークン単位diff
で表示します（GitHub word-diff相当）。追加されたトークンは緑、baseにのみ存在し
削除されたトークンは赤の取り消し線で示します。strengths / defects / 配列形式の
attributesは項目単位でdiffし、1行1項目で追加・削除を表示します。基準セル自身、
`(not analyzed)`、`—` のセル、および行内の実値が1個以下の場合はdiff装飾なしの
プレーン表示です。テーブル上部にはこの基準・凡例を説明する注記を表示します。

テーブルは横スクロール可能なコンテナに収め、列数が多くても崩れないようにします。

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
親
子
Story
Prompt
Seed
ComfyUI Job
Git
Note
```

親・子はBatch Detailと同じ family 表示の縮小版です（兄弟は同Batch内の他Generationに相当し表示不要）。

-   親: このGenerationが属するBatch自身の材料（BatchReference、バッジ `Reference`）。purpose/aspectを表示
-   子: このGenerationを材料に使ったBatch一覧（バッジ `Reference`）。purpose/aspectを表示

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

## Graph View

`/graph` は生成履歴全体を1画面で見るための、`Provenance View`
とは別の高度な表示です。Provenance View が選択
Generation/Batch周辺の1 hopに留めるのに対し、Graph
Viewは全Batchを一度にレイアウトします。

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

### ドリルダウン（隠れた隣接Batch）

スコープによって除外されたBatchがある場合、表示中のBatchのうち除外されたBatchへ直接（無向で）隣接しているものは、サムネイルグリッドの3列目に「⋯
+N」スタブを表示します（Nはそのカードから見た、非表示になっている直接隣接Batchの数）。スタブをクリックすると、そのBatchを起点に`?root=<short_id>&depth=3`へ遷移し、隠れていた周辺を表示します。

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
