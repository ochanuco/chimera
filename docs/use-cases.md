# Use Cases

## UC-01: Seed違いで9枚生成する

人間:

``` text
結月ゆかりをseed違いで9枚作って
```

Claude Code は prompt を構築し `request.json` を作成します。

Python CLI:

1.  Batchを作成
2.  seedを9件生成
3.  ComfyJobを9件作成
4.  ComfyUIへ順にenqueue
5.  各outputを取得
6.  R2へ保存
7.  Generationを9件登録
8.  Discordへ通知

結果:

``` text
Batch B001
├─ Job J001 → G001
├─ Job J002 → G002
...
└─ Job J009 → G009
```

## UC-02: Seed違いGenerationをマッシュアップする

人間:

``` text
abc123 のポーズと xyz987 の服装を採用して9枚
```

Claude は canonical URL / context から semantic 情報を取得し prompt
を再構成します。

``` text
G abc123 -- pose ----\
                      > Batch B002
G xyz987 -- outfit --/
```

B002には BatchReference が2件登録されます。

## UC-03: 3件以上をマッシュアップする

``` text
A -- pose --------\
B -- outfit -------+
C -- expression ---+--> Batch X
D -- style --------/
```

Reference は `1..m` 件を許可します。親を2件に限定しません。

## UC-04: Claudeが自動的に再試行する

Claude が生成結果を検品し、改善が必要と判断します。

``` text
B001 -- refinement(actor=claude) --> B002
```

B001とB002は別Batchです。

途中試行を削除せず、生成履歴として保持します。

## UC-05: 人間の追加指示で再試行する

人間:

``` text
もう少し表情を柔らかくして
```

``` text
B002 -- refinement(actor=human) --> B003
```

Claude自動再試行と同じ BatchRelation を使い、actor で区別します。

## UC-06: 古いGenerationを現在の絵柄へrebuildする

過去Generationを検索します。

条件例:

``` text
character = 結月ゆかり
tag = outfit-good
date = 2026-01..2026-05
```

過去Experimentを再開せず、新しいBatchから過去Generationを参照します。

``` text
Old G123 -- purpose=rebuild / aspect=outfit --> New Batch
```

現在の Python recipe / prompt
とマッシュアップし、最新の絵柄へ更新します。

## UC-07: Storyの続きを生成する

過去のStoryに属するBatchの続きとして新しいシーンを生成します。

ポーズ・表情・構図は大きく変えてよい一方、絵柄・服装・キャラクター等の根本的なidentityは維持します。

StoryRelation:

``` text
B010 -- "夕方の海辺へ" --> B020
```

生成 provenance と Story continuity は独立して扱います。

## UC-08: Storyを分岐させる

``` text
B010
├─ "海へ行く" → B020
└─ "帰宅する" → B021
```

StoryRelation は分岐を許可します。

## UC-09: Storyを合流させる

複数のStory上の流れを1 Batchへ合流可能とします。

StoryはDAGとして扱います。

## UC-10: Generationを検索してClaudeへ渡す

主な検索軸:

-   Character
-   Tag
-   Date
-   Rating
-   Bookmark

検索結果には canonical URL を含めます。

人間はClaudeへURLを渡すだけでGenerationを参照できます。

## UC-11: Generationを後からsemantic解析する

生成時にClaude検品をしなかったGenerationでも、Web GUI / Claude
Codeから後で画像を解析します。

生成対象:

-   summary
-   pose
-   expression
-   outfit
-   style
-   composition
-   strengths
-   defects
-   attributes

semantic schema は version 管理します。

## UC-12: 失敗画像を残す

Generationを原則物理削除しません。

例:

``` text
rating = bad
tags = [bad-hand, reject]
```

ComfyUI JOB IDとの対応と生成履歴を維持します。

## UC-13: Bookmarkする

Generation / Batch / Story / Experiment を Bookmark できます。

Bookmark は品質評価ではなく「後から素早く呼び出す」ための導線です。

## UC-14: ComfyUI Job ID / filenameから逆引きする

既存の会話に以下のような参照が残っている場合:

``` text
JOB ID a0b2e9d3-d14d-41a8-b3a4-f5f57a8fa8df
file yk-lineT3_00001_.png
```

`comfy_prompt_id` + `original_filename`
等からGenerationを検索できるようにします。
