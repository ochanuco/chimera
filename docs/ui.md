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

### キュー状態

ナビ右端（`margin-left: auto`）に、キュー（[requests](api.md#request)）の状態を示す
pillを置きます。`GET /api/v1/requests/summary`で初期表示し、以後はGalleryのnew
arrivalsと同じ共有 viewer WebSocket（`/api/v1/requests/ws`）の`status` /
`snapshot`メッセージを合図に再取得します（デバウンス500ms）。ページ非表示から復帰した
とき、およびpillを開いたときにも再取得します。

pillはdotとテキストで状態を表します。

-   dot: workerが1台以上接続していれば緑、未接続かつ待ちがあれば黄、それ以外は灰
-   テキスト: `実行中 N` `待ち N` `失敗 N`（直近24h）を該当する分だけ`·`区切りで並べ、
    待ちがあってworker未接続なら`worker なし`を追加する。全て0のときはdotのみ（テキスト
    無し、パディングを詰める）
-   幅600px以下では日本語ラベルと区切りを落とし、色分けした数字だけを表示する

pillは`<details><summary>`で開閉し、開くと`More`と同じ見た目のパネルが現れます。パネルは
1行 = 1グループで、finalize/repair/masked_redrawはBatch単位、run_idを持つgenerateは
Experiment単位、run_idの無いgenerateはrequest単位にまとめます（集計規則は
[api.md](api.md#summary)）。各行はサムネイル・BatchまたはExperimentのshort_id・kind別件数・
状態別件数を表示し、遷移先（Batch詳細 `/b/{short_id}` またはExperiment詳細
`/experiments/{short_id}`）があればリンク、無ければリンクなしの行です。パネルは表示・
遷移専用で、finalize/repairのような再実行やcancelledなどの操作は一切持ちません。パネル
末尾にworker接続数（`worker N 台接続中` / `worker 未接続`）を出します。グループが無ければ
「キューは空です」と表示します。

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

### Gallery pending changes

`/gallery`では、新着のGenerationとbadにしたカードの非表示を、グリッドへ即座には反映しません。
操作中のカードが手元で動かないよう件数だけを知らせ、利用者がボタンを押したとき（またはページを
再読み込みしたとき）にまとめて反映します。

#### 新着

対象は`ids`・Tag・Rating・Bookmarked only・公開済みのみのいずれも指定していない既定表示だけで
（`view`・`bad`は絞り込みに数えません）、その条件下でだけクライアントはviewer WebSocket
（`/api/v1/requests/ws`、[worker-protocol.md](worker-protocol.md#段階-3-workerhub)）を開き
（[Generation Detail](#generation-detail)のFinalizeで説明したrequest live接続を共有します）、
`generation`メッセージを受けます。

現在の`view`で受理できるものだけを扱います — `raw`は`refines_generation_short_id`が
nullのものだけ、`refined`はnon-nullのものだけ、`all`は両方です。既にグリッドに表示済みか
反映待ちに積んだshort_idは無視します。受理したら`GET /g/{short_id}?partial=card`（Gallery一覧と
同じ`GenerationCard`フラグメント）を取得し、反映待ちに積みます。

#### bad

badを隠している間（`bad=1`も`ids=`も指定していないとき）、カード上またはLightbox内でratingを
badにすると、カードはその位置のまま不透明度0.4（hover時0.75）になり、反映待ちに数えます。
反映前にbad以外へ付け直すと元の表示に戻り、反映待ちからも外れます。Lightboxはbadにしても
次の画像へは進みません。BookmarksとBatch Detailでは何も隠しません。

#### 反映

反映待ちが1件以上あると、グリッドの直前に全幅の帯（枠線・角丸10px・`--accent`文字・0.85rem/600・
高さ2.75rem以上）を出し、`新着 N 件 · bad M 件を隠す`（0件の側は省きます）と表示します。帯が
sticky toolbarの下へスクロールアウトしている間は、同じ文言のピル（`--accent`地・`#10131c`文字・
角丸999px・`0.4rem 1rem`パディング・影付き、新着があるときは上矢印アイコン付き。幅600px以下では
2.75rem以上の高さ）をtoolbarの直下中央に浮かべます。

帯かピルを押すと、新着を到着の古い順にグリッド先頭へ挿入し（＝新しいものが一番上に来ます）、
薄くしたbadのカードを取り除きます。新着を挿入したときは最上部へスクロールします
（telemetry `gallery.pending_apply`）。

ソケットが切れたときの再接続は同じ接続を使う[Generation Detail](#generation-detail)の
request live更新と同じ指数バックオフ（1s→2s→…上限30s）です。

Gallery / Bookmarksのグリッドは1行6枚です（幅1100px以下は4枚、800px以下は190px以上の幅で
入るだけ並べます）。Batch Detailのグリッドは左ペインの幅に190px以上で入るだけ並べます。

カードはサムネイル1枚と、その下の2行（short_idとbookmarkの行、rating（bad/neutral/good）の行）です。
short_idは等幅の文字そのものがボタンで、クリックするとクリップボードへコピーし、0.9秒間`--good`色に
変えて末尾に✓を出します。画像メタ（解像度/ファイルサイズ）・タグ・比較チェックボックスは
カードから外し、サムネイルクリックで開く[Lightbox](#lightbox)に移しました。サムネイル左上には
（上から順に、両方あれば縦に積みます）、このGenerationの所属Batchがfinalize/repair/
masked_redrawで書き換えた元のraw Generationがあるとき`from <short_id>`バッジ（`#402e21`地に
橙文字、short_idは等幅）、このGenerationを対象にした最新のfinalize/repair/masked_redraw
requestがあるとき進捗ピル（後述）を、左下には[Publication](domain-model.md#publication)が
1件以上あるとき送信アイコン付きの`公開済み`ピルを重ねます。幅600px以下ではbookmarkをサムネイル
右上の2.75rem角のタップ領域へ移し、ratingの3ボタンは行いっぱいに広がります（各2.75rem以上）。
short_idのボタンも高さ2.75rem以上にします。

進捗ピル（`rgba(18,18,20,0.86)`地・`--border`の1px枠・角丸999px、テキストはstatusごとに
色分け）はkind（`finalize`/`repair`/`masked redraw`）とstatusから組み立てます。

``` text
finalize · queued                      ← --accent
repair · running 3/10                  ← --neutral（step/totalはprogressメッセージが届いてから）
masked redraw · done → xyz789          ← --good、xyz789は等幅
finalize · failed                      ← --bad
```

`[data-request-id]`要素なので、[Generation Detail](#generation-detail)のrequest live更新が
受ける同じ`progress`/`status`メッセージでその場更新されます（runningの`progress`は
`step`/`total`が分かっている間だけ`kind · running step/total`に、doneになった時点で結果の
short_idを取得して`kind · done → <short_id>`に差し替えます）。Lightboxからfinalizeを
送信したときも、その場でこのピルをqueued状態で足す/差し替えます（他のカードは触りません）。

カード表示例:

``` text
[ IMAGE ]
 from abc123          ← rawを書き換えた出力のときだけ
 finalize · queued    ← finalize/repair/masked_redraw requestがあるときだけ
 公開済み             ← Publicationが1件以上あるときだけ

abc123                    🔖   ← short_idはクリックでコピー
bad  neutral  good
```

Batch Detail / Bookmarksも同じカードコンポーネントを使い、from-badge / 公開済みピルは
表示します。進捗ピルは`GET /api/v1/generations`（Gallery / Bookmarksが使う一覧）と
Gallery live insertionのカードフラグメントだけが持つデータなので、Batch Detailのカードには
出ません。

表示しないもの（サムネイルクリックで[Lightbox](#lightbox)を開けば見られます）:

-   画像メタ（解像度/ファイルサイズ）
-   タグ
-   commit hash
-   prompt全文
-   git diff
-   semantic全文
-   Story graph
-   ComfyUI workflow

## Lightbox

Gallery / Bookmarks / Batch Detailのカードサムネイルを、修飾キーなしの左クリックで開きます。
中クリック・Cmd/Ctrl/Shift/Altを押しながらのクリック・JS無効環境では従来通りカードの
`<a href="/g/{short_id}">`として`/g/{short_id}`（Generation Detail）へ遷移します。

パネルのHTMLは`GET /g/{short_id}?partial=lightbox`が返すフラグメント（`<html>`を含まない）で、
Generation Detailと同じコンポーネント（RatingBookmark / PublicationSection / TagsEditor /
FinalizeSection / NoteSection）から組み立てるため、挙動を二重管理しません。パネルの内容は
上から次の順です。

``` text
short_id + コピーボタン ・ 比較に追加 ・ 閉じる
画像メタ（解像度/ファイルサイズ） + 詳細ページ ↗
from <short_id>（refineしている場合のみ、カードと同じ見た目のリンク行）
rating（大きいボタン） + bookmark
公開
Tag
Finalize（展開）
Note（折りたたみ）
```

画像本体とoverlayのUIはクリック側のJSが組み立てます（クリックしたカードの`<img class="thumb-fg">`が
既に原寸相当のURLを持っているため、fragment自体は画像タグを含みません）。

幅1100px以上では`rgba(8,8,10,0.78)`のscrim付き固定overlayで、`minmax(0,1fr) 420px`の2カラム
（左: 画像、右: `--bg-elevated`・角丸10pxのパネル、`overflow-y: auto`）。行の高さは
`minmax(0,1fr)`でoverlayの高さに固定し、画像は縦横とも画像エリアに収まるよう縮小します
（見切れもスクロールもしません）。画像エリア左右端の中央に丸いprev/nextボタン（2.75rem）を
重ねます。

幅1100px未満では不透明（`--bg`）の全画面・縦スクロールです。上から3.25remのトップバー
（閉じるボタン2.75rem・short_id・詳細ページ↗）→ 画像（幅いっぱい、ただし高さは
トップバーを除いた画面の高さまで）→ パネル（rating各ボタン・
ボタン・入力を2.75rem以上のタップ領域にしたもの）の順に並びます。画像上の左右スワイプで
prev/next、パネルのスクロール位置が最上部（`scrollTop === 0`）にあるときの下スワイプで
閉じます。

Prev/Nextはページのグリッド内カードの現在のDOM順を辿ります。Galleryで最後に読み込んだカードを
過ぎたときは、「もっと見る」リンクがあれば無限スクロールと同じfetchで次ページを読み込んでから
続けます。

開いている状態はURLの`#g=<short_id>`に反映します（最初に開くときはpushState、Lightbox内の
prev/nextでの移動はreplaceState）。そのため、ブラウザのBackボタンで
一度に閉じ、`#g=`付きURLを直接開く・再読み込みすると同じGenerationのLightboxが開き直します。
`Esc`と、画像・パネル・prev/next・トップバー以外の場所（scrimや画像の余白）のクリックでも
閉じます。背景クリックは押下も背景で始まったときだけ数えるので、パネル内でテキストを選択して
背景で離しても閉じません。閉じるとフォーカスを開く前の要素へ戻し、背後のページのスクロール位置は
動かしません（開いている間は`body`のスクロールをロックします）。

Lightbox内でratingを変えると、背後のカードのrating-groupにも同じ値を反映します（逆方向 —
カード側での変更をLightboxへ反映 — はLightboxが開くたびに再フェッチするので不要です）。

rating / bookmark / タグ追加・削除 / note保存 / 公開の追加・URL入力・削除 / finalizeの各ハンドラは
すべて`document`へのイベント委譲なので、差し込まれたfragment内でも再初期化なしにそのまま動きます。

### Compare entry

カードのチェックボックスは廃止しました。Lightboxと[Generation Detail](#generation-detail)の
`比較に追加`ボタンがsessionStorageのcompare set（タブ内限定、要素は`{ id, short_id }`）を
トグルします（ボタンのラベルは`比較から外す`に切り替わります、telemetry `compare.add`）。

`#compare-bar`はLayoutが全ページの下端に固定配置し、setが空でない間だけ表示します。表示中は
`main`の下にバーの高さ（`--compare-bar-h`、3.75rem）分の余白を足し、Generation Detail / Batch
Detailの2カラムはその分だけ高さを縮めます。バーの中身は左から次の順です。

-   選択中の各Generationのサムネイルチップ（2.75rem角、右上に×）。クリックでsetから外します
    （telemetry `compare.remove`）。サムネイルはカードと同じ`/g/{short_id}/image`で、
    10件目以降は`/compare`に渡らないため薄く表示します。横に溢れたらチップの列だけ横スクロールします
-   `すべて解除`: setを空にしてバーを消します（telemetry `compare.clear`）
-   `Compare (N)`: `/compare?ids=...`（先頭9件のshort_id）へのリンク（telemetry `compare.open`）

別ページでsetを変えてからBackで戻った（bfcacheから復元された）ときもバーを描き直します。

## Batch Detail

1回の生成要求をまとめて確認する画面です。

幅1100px以上（MBP 16インチのフルスクリーン運用を想定）では、左（Generation
サムネイルグリッド）: 右（情報）= 2:1 の2ペインをビューポート1画面に収め、
各ペインが独立してスクロールします。それ未満の幅では従来どおり縦一列です。

左のサムネイルグリッドはGalleryと同じ[GenerationCard](#gallery)（from-badge / 公開済みピル
込み）で、サムネイルクリックで同じ[Lightbox](#lightbox)を開きます。

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
-   Lightboxから比較に追加（[Compare entry](#compare-entry)）
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
[ IMAGE ] | abc123  比較に追加
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
"gui"`）を1件積み、ページの再読み込みはしません。積んだ直後の`queued`行をその場で
`request-status-list`の先頭へ挿入します（一覧がまだ無ければ作ります）。Generation Detailと
[Lightbox](#lightbox)のFinalizeフォームはどちらもこの仕組みです。この一覧には、このGenerationを
対象とした最新のrequest（finalize / repair）を最大5件、新しい順に`status · created_at`の行として
表示し、`done`なら納品Generationへのリンク、`failed`ならその`error`を添えます。

各行は`data-request-id` / `data-request-status`を持ち、`/api/v1/requests/ws`
（段階3 WorkerHub、[worker-protocol.md](worker-protocol.md#段階-3-workerhub)参照）に
繋いだライブ接続が接続直後の`snapshot`と以後の`progress` / `status`を受けて、行内の
`.request-progress`に`phase step/total`（stepが無ければ`phase`のみ）を、`status`変化時は
行のクラスと表示statusを書き換えます。`done` / `failed`への遷移時は該当requestと
（`done`なら）納品Generationを取得し直し、ページ読み込み時と同じ結果リンク / errorをその場に
追加します。ページ読み込み後に新しく現れた行（finalize送信直後の挿入、Lightboxの再オープン）も
現れた時点でこの接続に登録され、まだ張っていなければソケットを開きます。Batch Detailの
Finalize all armsセクションでも、finalize送信のたびに集計行（`N queued`）と
`request-status-list`をその場で更新し、同じ仕組みで各行が進捗します。WebSocketが張れない
環境でも静的な表示のまま壊れません（未対応・切断時は1秒→30秒のバックオフで再接続を試み続けます）。

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

Generationsセクションのカードと[Lightbox](#lightbox)はGalleryと共通です（bad非表示との
組み合わせは無いため、[Gallery pending changes](#gallery-pending-changes)のbadの扱いはありません）。

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
| `compare.add` | `generation_id`, `count` | [Compare entry](#compare-entry)の`比較に追加`/`比較から外す`ボタン |
| `compare.remove` | `generation_id`, `count` | compareバーのチップで外す（`initCompareBar`） |
| `compare.clear` | `count` | compareバーの`すべて解除`（`initCompareBar`） |
| `compare.open` | `count` | Compareへ遷移（`initCompareBar`） |
| `gallery.filter` | filter-formの各入力値 | Galleryのfilter送信（`initGalleryFilter`） |
| `gallery.view` | `view`, `bad` | Gallery / Bookmarksのview切り替え・bad表示トグル（`initGalleryView`） |
| `gallery.pending_apply` | `new_count`, `hidden_count`, `source`（`strip` / `pill`） | [Gallery pending changes](#gallery-pending-changes)の反映（`applyGalleryPending`） |
| `ui.error` | `action`, `message`, `status`, 該当操作のprops | 上記操作の失敗時 |
