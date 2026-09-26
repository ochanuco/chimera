# ComfyUI Generation Manager --- Design

Claude Code + Python + ComfyUI
で生成した画像について、単なる画像置き場ではなく、生成探索の
provenance（来歴）、Story、評価、再利用可能な semantic
情報を永続管理するための Web GUI / Management API の設計です。

## 目的

生成フローは、brain（Claude Code / Agent / Human）が request.json を chimera の requests
キューに積み、worker（comfy-recipes）がそれを claim して ComfyUI
で生成し、結果を chimera へ ingest する形です（[worker-protocol.md](worker-protocol.md)「配置と責務」）。

人間は Web GUI / Discord 上の画像を見ながら Claude
と対話し、良い画像にはタグを付けています。しかし、過去に何が良かったか、どの画像のどの要素を次の生成へ継承したか、どの
Story の続きなのかを体系的に追跡しにくい問題があります。

本システムはこの問題を解決します。

## 設計原則

1.  画像が主役。メタデータや系譜は必要なときだけ段階的に表示する。
2.  Generation は永続的な資産。ComfyUI output を削除しても R2
    上で保持する。
3.  生成上の因果関係と Story 上の連続性を混同しない。
4.  chimera は Generation Experiment Orchestrator である。semantic
    な判断主体は Claude Code / Agent / Human のいずれでもよく、worker
    は実行と記録を担当する。
5.  chimera 自身は ComfyUI へ到達しない。GUI が積んでよい操作の範囲は
    [architecture.md](architecture.md#web-gui) の Web GUI Responsibilities を参照。
6.  canonical Generation URL を、人間・Claude・Discord・CLI
    の共通参照とする。
7.  削除よりラベリングを優先し、生成履歴を破壊しない。
8.  Experiment / override / evaluation / decision / promotion
    を管理し、検証の反復と comfyui-recipes への昇格を追跡可能にする。

## ドキュメント

-   `docs/architecture.md` --- システム構成と責務
-   `docs/domain-model.md` --- ER/ドメインモデル
-   `docs/use-cases.md` --- 主要ユースケース
-   `docs/generation-request.md` --- request.json 契約（brain → chimera requests キュー → worker）
-   `docs/worker-protocol.md` --- requests キューと worker の契約
-   `docs/experiment-agent.md` --- MCP 経由の Experiment agent 運用
-   `docs/api.md` --- Management API
-   `docs/ui.md` --- Web GUI
