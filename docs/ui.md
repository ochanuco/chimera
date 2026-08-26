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

References: 2
Refinement from: B000
Story: yk-line
```

主な操作:

-   Generation rating
-   Bookmark
-   Tag
-   複数Generation選択
-   Compare
-   provenance確認

## Compare

複数Generationを画像中心で比較します。

2〜9枚程度を想定します。

各画像から「次の生成でどの要素を採用するか」を指定できるUIを将来的に提供します。

例:

``` text
G123
[IMAGE]
Poseとして採用

G456
[IMAGE]
Outfitとして採用
```

結果:

``` text
Selected references

G123 → pose
G456 → outfit
```

MVPではComfyUIへ直接生成要求を送らず、Claudeへ渡す指示を生成・コピーできれば十分です。

例:

``` text
https://example/g/abc123 の pose
https://example/g/xyz987 の outfit
を採用して再生成
```

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
References
Story
Prompt
Seed
ComfyUI Job
Git
Note
```

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
