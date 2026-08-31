# Generation Request Contract

## Purpose

`request.json` は **Claude Code が解釈した人間の生成意図**を Python CLI
へ渡す正式な境界です。

``` text
Human
  ↓ natural language
Claude Code
  ↓ request.json
Python CLI
  ↓
ComfyUI + Management API
```

Pythonはsemanticな意味を極力解釈せず、要求を実行し事実を記録します。

## Version 1

``` json
{
  "schema_version": 1,
  "request": {
    "instruction": "abc123のポーズとxyz987の服装を採用して9枚生成",
    "count": 9
  },
  "generation": {
    "recipe": "dq3",
    "prompt": "...",
    "negative_prompt": "...",
    "parameters": {}
  },
  "references": [
    {
      "generation_id": "abc123",
      "purpose": "composition",
      "aspect": "pose",
      "instruction": "上半身の姿勢と腕の位置を採用"
    },
    {
      "generation_id": "xyz987",
      "purpose": "composition",
      "aspect": "outfit",
      "instruction": "服装構成を採用"
    }
  ],
  "refinement": null,
  "story": null
}
```

## request

``` json
{
  "instruction": "...",
  "count": 9
}
```

`instruction` は可能な限り人間の元指示を保持します。

`count` は生成枚数です。

## generation

``` json
{
  "recipe": "dq3",
  "prompt": "...",
  "negative_prompt": "...",
  "parameters": {}
}
```

ComfyUI
固有パラメータを共通schemaへ過剰に固定しません。recipe固有の追加値は
`parameters` に保持します。

## references

0..m 件です。

``` json
{
  "generation_id": "abc123",
  "purpose": "composition",
  "aspect": "pose",
  "instruction": "ポーズを採用"
}
```

purpose 推奨値:

``` text
composition
reference
rebuild
continuity
```

aspect 推奨値:

``` text
pose
expression
outfit
style
composition
other
```

aspect は将来拡張可能とします。

## refinement

前Batchを受けた再試行の場合のみ指定します。

``` json
{
  "source_batch_id": "B001",
  "actor": "claude",
  "reason": "手の破綻が多かったためpromptを修正"
}
```

actor:

``` text
human
claude
```

## story

Story上の続きの場合のみ指定します。

``` json
{
  "story_id": "story-id",
  "previous_batch_ids": ["B042"],
  "transition": {
    "label": "夕方の海辺へ",
    "description": "衣装と絵柄を維持しつつ、夕方の海辺へ場面を移す"
  }
}
```

分岐・合流を許すため `previous_batch_ids` は配列とします。

`label` / `description` はClaudeが人間の会話から生成します。

## experiment（Version 2）

ExperimentRun の override を生成要求へ渡すためのブロックです。

``` json
{
  "experiment": {
    "experiment_id": "...",
    "run_id": "...",
    "overrides": {}
  }
}
```

`overrides` は chimera の ExperimentRun が持つ差分をそのまま渡します。これを読んで
base recipe へ override を適用する責務は comfyui-recipes 側の `scripts/generate.py`
にあります。

`experiment` は既存の `references` / `refinement` / `story` と同様、キー省略と明示
`null` のどちらも「該当なし」として受理します。

## Seeds

通常はClaude Codeがseedを決定しません。

``` json
{
  "request": {
    "count": 9
  }
}
```

Python CLI が9件のseedを生成します。

再現が必要な場合のみ明示overrideを許します。

``` json
{
  "request": {
    "count": 1,
    "seeds": [123456789]
  }
}
```

`seeds` 指定時は `count` と件数が一致する必要があります。

## CLI

想定インターフェース:

``` text
uv run generate --request request.json
```

CLI は schema validation 後、Batch作成からDiscord通知までを実行します。

## Validation Principles

-   `schema_version` は必須。
-   `count >= 1`。
-   `seeds` 指定時は `len(seeds) == count`。
-   Reference の `generation_id` はManagement APIで存在確認する。
-   refinement source と story previous batch は存在確認する。
-   experiment の `experiment_id` / `run_id` はManagement APIで存在確認し、
    `run_id` が `experiment_id` に属することも確認する。
-   同じ実行を再送しても重複Batchを作らないよう idempotency key
    を内部生成・保持する。
