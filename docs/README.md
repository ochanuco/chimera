# ComfyUI Generation Manager --- Design

Claude Code + Python + ComfyUI
で生成した画像について、単なる画像置き場ではなく、生成探索の
provenance（来歴）、Story、評価、再利用可能な semantic
情報を永続管理するための Web GUI / Management API の設計です。

## 目的

現在の生成フローは以下です。

``` text
Human
  ↓ natural language
Claude Code
  ↓ uv run ...
Python scripts
  ↓
ComfyUI
  ↓
generated images
  ↓
Discord
```

人間は Discord 上の画像と JOB ID を見ながら Claude
と対話し、良い画像にはタグを付けています。しかし、過去に何が良かったか、どの画像のどの要素を次の生成へ継承したか、どの
Story の続きなのかを体系的に追跡しにくい問題があります。

本システムはこの問題を解決します。

## 設計原則

1.  **画像が主役**。メタデータや系譜は必要なときだけ段階的に表示する。
2.  **Generation は永続的な資産**。ComfyUI output を削除しても R2
    上で保持する。
3.  **生成上の因果関係と Story 上の連続性を混同しない**。
4.  chimera は Generation Experiment Orchestrator である。semantic
    な判断主体は Claude Code / Agent / Human のいずれでもよく、Python CLI
    は実行と記録を担当する。
5.  ComfyUI workflow の構築・実行は comfyui-recipes（worker）に残し、chimera
    自身は ComfyUI へ到達しない。GUI が積んでよいのは semantic 判断を伴わない
    再実行（finalize）だけで、GUI が触るのは自分の D1 の requests 行のみ。
6.  canonical Generation URL を、人間・Claude・Discord・CLI
    の共通参照とする。
7.  削除よりラベリングを優先し、生成履歴を破壊しない。
8.  Experiment / override / evaluation / decision / promotion
    を管理し、検証の反復と comfyui-recipes への昇格を追跡可能にする。

## ドキュメント

-   `docs/architecture.md` --- システム構成と責務
-   `docs/domain-model.md` --- ER/ドメインモデル
-   `docs/use-cases.md` --- 主要ユースケース
-   `docs/generation-request.md` --- Claude Code → Python CLI 契約
-   `docs/worker-protocol.md` --- requests キューと worker の契約
-   `docs/api.md` --- Management API
-   `docs/ui.md` --- Web GUI

## MVP

MVPでは以下を優先します。

-   Batch / ComfyJob / Generation の登録
-   R2 への画像保存
-   Gallery / Batch / Generation Detail
-   Character / Tag / Date による検索
-   Rating / Bookmark / Note
-   Generation semantic metadata
-   Generation → Batch の Reference
-   Batch → Batch の Refinement
-   Story と StoryRelation
-   canonical Generation URL
-   Claude 向け context API
-   Experiment / ExperimentRun / ExperimentPromotion

semantic 全文検索、GraphDB、統計分析などは後回しにします。

全体 Graph 表示（`/graph`）は前倒しで実装済みです。詳細は
[ui.md](ui.md) の「Graph View」を参照してください。
