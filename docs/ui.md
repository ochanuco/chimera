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

例:

``` text
Batch B001
"浜風をseed違いで9枚"

[img][img][img]
[img][img][img]
[img][img][img]

親 2 · 子 1 · 兄弟 0 · Story: yk-line
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
浜風           浜風
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

同じ行で全カラムの値が一致しない場合、その行の値セルを軽く強調表示（diff）します。
semantic未解析（semantic_jsonがNULL）のGenerationは列全体が `(not analyzed)`
になります。値がnullの項目は `—` と表示し、attributes行はすべてのGeneration
で値なしの場合は行ごと表示しません（summary / core / strengths / defects の
固定行は常に表示）。

テーブルは横スクロール可能なコンテナに収め、列数が多くても崩れないようにします。

Compareは比較表示のみで、ComfyUIへの生成要求も指示テキストの生成も行いません。

## Generation Detail

画像を最上部に大きく表示します。

``` text
[ IMAGE ]

abc123
浜風
good  🔖
#pose-good #outfit-good
```

下部は折りたたみ可能な詳細セクション:

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

ノードはBatchの「グループ枠」（角丸の矩形）です。中にGenerationのサムネイルを3列グリッドで並べ（最大9枚まで表示、10枚目以降は9枚目の枠を「+n」のプレースホルダーに置き換えます）、上部のヘッダー行にBatchのshort_id（monospace）と`status
· count`を表示します。ノードの高さはサムネイル行数（3列グリッド）に応じて可変で、layerのy位置はその上のlayerで最も高いノードに合わせて決まります。

Reference（青）エッジは、参照元Generationのサムネイルが画面上に実在する場合はそのサムネイル下端から、実在しない場合（Batchが9枚を超えて保持しており、参照元がoverflow枠に落ちた場合）はBatch枠の下端にフォールバックして描画します。Relation（橙・破線）とStory（緑）のエッジは従来どおりBatch枠の下端→Batch枠の上端です。

ナビゲーションはコンテキストメニュー経由のみです。Batchヘッダーの左クリックは何も起きません（ページ遷移なし）。Generationサムネイルの左クリックはCompare選択のトグルです（こちらもページ遷移なし）。1件以上選択すると画面下部にCompareバーが現れ、`/compare?ids=...`
へリンクします（Galleryのcompareバーと同じ仕組み）。Generationサムネイル、またはBatchヘッダー/枠を右クリックするとコンテキストメニューが開き、「Copy
ID」「Copy URL」「Open detail」（`/g/{short_id}`または`/b/{short_id}`を新規タブで開く）、Generationの場合はさらに「Add/Remove
from compare」のトグルを提供します。

パン/ズームはvanilla JSでSVGのviewBoxを操作します。JS
無効時はコンテナのスクロールにフォールバックし、SVG自体は常に表示されます。

サイクル（Story等が過去Batchに戻るケース）を検出した場合、そのエッジは描画は維持しつつlayer計算からのみ除外します。

Batchが1件も無い場合はempty-stateを表示します。

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
