# UI Design

## Core Principle

> 画像が主役。メタデータと系譜は必要になったときだけ見せる。

Progressive disclosure
を基本とし、Git、prompt、semantic、provenance等を一覧画面へ詰め込みません。

人間の通常フローは以下です。

``` text
見る → 選ぶ → Claudeに渡す
```

Web GUI は ComfyUI へ到達せず、prompt も書きません。GUI が積むのは semantic 判断を伴わない
再実行（finalize / repair）と、[絵柄チェック](#絵柄チェック)の pin 再描画の requests 行だけで、
Compare は semantic metadata の diff を表示するところまでです（不変条件の正本は
[architecture.md](architecture.md#web-gui)、requests の契約は [worker-protocol.md](worker-protocol.md)）。

## Navigation

トップレベル導線は、ブランド `Chimera`（`/gallery` へのリンク）に続けて次の項目です。

``` text
Chimera
Gallery
Bookmarks
More（Experiments / 絵柄チェック）
```

`More` は `<details><summary>`によるドロップダウンです。開くと
`Experiments` `絵柄チェック` の2リンクを持つパネルが summary の直下に現れます。
パネル外クリックまたは
Escapeで閉じます（キュー状態pill・[絞り込みパネル](#gallery)と共通の挙動、`initPopoverClose`）。

現在地に対応するナビ項目には`aria-current="page"`を付け、下線（`text-decoration-color:
var(--accent)`）で強調します。`/gallery`ではGallery、`/bookmarks`ではBookmarks、`/experiments` 配下
（`/experiments/{short_id}` `/experiments/{short_id}/ab`含む）と`/check`では`More`のsummaryが
アクティブになります。`/compare`はグリッドから入る
導線なのでGalleryをアクティブにします。`/g/{short_id}`はどの項目もアクティブになりません。

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
1行 = 1グループで、finalize/repair/masked_redrawは仕上げ元Generationが属するRequest単位、
run_idを持つgenerateはExperiment単位、run_idの無いgenerateはrequest単位にまとめます
（集計規則は[api.md](api.md#summary)）。各行はサムネイル・Request（仕上げ元のRequest）または
Experimentのshort_id・kind別件数・状態別件数を表示し、遷移先（仕上げ元Requestの最初の
Generation `/g/{short_id}` またはExperiment詳細 `/experiments/{short_id}`）があればリンク、
無ければリンクなしの行です。パネルは表示・
遷移専用で、finalize/repairのような再実行やcancelledなどの操作は一切持ちません。パネル
末尾にworker接続数（`worker N 台接続中` / `worker 未接続`）を出します。グループが無ければ
「キューは空です」と表示します。

パスと内容の対応:

| パス | 内容 |
|---|---|
| `/` | `/gallery` へのリダイレクト |
| `/gallery` | [Gallery](#gallery) |
| `/compare?ids=a,b` | [Compare](#compare)（2〜9枚の semantic metadata 比較） |
| `/b/{short_id}` | `short_id` を持つ Request の最初の Generation（Job の index、出力の index の昇順で先頭）の `/g/{short_id}` へ 302 でリダイレクトする。該当する Request か Generation が無ければ 404 ページ |
| `/g/{short_id}` | [Generation Detail](#generation-detail)（Generation の canonical URL） |
| `/check` | [絵柄チェック](#絵柄チェック) |
| `/experiments`, `/experiments/{short_id}` | [Experiment View](#experiment-view) |
| `/experiments/{short_id}/ab` | [A/B Judge View](#a-b-judge-view) |
| `/bookmarks` | [Bookmarks](#bookmarks) |

`/b/{short_id}` は、過去に Discord などへ貼られた URL を壊さないための入口です。
Request の `short_id` から最初の Generation の `/g/` へ 302 で飛ばします。
系譜全体の走査は MCP の `get_generation_lineage` の担当で、GUI の Generation Detail は
隣接する 1 段の親・子・兄弟だけを見せます（[Generation Detail](#generation-detail)）。

## Gallery

目的:

-   良い画像を探す
-   過去Generationを再利用する
-   Rating / Bookmarkを付ける

nav直下にsticky なツールバーを持ちます。

``` text
[ finalize以外 | finalize | すべて ]   bad も表示 ☐   [ 絞り込み ▾ ]
```

`view` は3値の切り替えです。既定は `view=all`（raw / finalize済み両方）で、
`view=raw`（finalize/repair/masked_redrawの出力ではない raw Generationのみ）、
`view=refined`（finalize済みの出力のみ）へ絞り込めます。raw / finalize済みの判定は Generation の
`refines_generation_id`（[domain-model.md](domain-model.md#generation)）です。

「bad も表示」は既定で隠している bad rating の Generation を表示に加えるトグルです
（`bad=1`）。未評価・good・neutralの Generation は常に表示します。

`絞り込み`パネル（`<details>`。いずれかの項目に値が入っているときは開いた状態で描画）は
パネル外クリックまたはEscapeで閉じます（nav の `More` / キュー状態pill と共通の挙動、
`initPopoverClose`）。次を持ちます。

``` text
ID（複数可、改行またはカンマ区切り、short_id と UUID の混在可）
Tag
Rating
Bookmarked only
公開済みのみ
基準のみ
```

「公開済みのみ」は`published=true`（[api.md](api.md#generation-search)）で、少なくとも1件
[Publication](domain-model.md#publication)を持つGenerationだけに絞ります。「基準のみ」は
`reference=true`（[api.md](api.md#generation-search)）で、いずれかのpose の基準 render として
pin されているGenerationだけに絞ります（[domain-model.md](domain-model.md#基準-render-の-pin)）。
どちらも他のフィルタと同じくview/badトグルをまたいで保持され、いずれかの項目に値が入っているかの
判定にも数えます。

Character / 日付範囲 / ComfyUI Job ID / original filenameによる絞り込みはパネルに置かず、
`GET /api/v1/generations`のqueryとしてMCP/APIから使います（[api.md](api.md#generation-search)）。

`ID`の指定を解決した結果がGeneration 1件だけになったとき（他の指定と組み合わせた結果も
含む）は一覧を描画せず`/g/{short_id}`へ直接遷移します。0件・2件以上のときは通常どおり
一覧を表示します。`ID`を指定した検索は`view`とbad非表示を無視し、指定したGenerationだけを
返します。

一覧は無限スクロールです。グリッド末尾の「もっと見る」
リンクが画面に入ると次ページを自動でフェッチしてグリッドへ追記します（JS無効環境では
リンクとして機能します）。

### Gallery pending changes

`/gallery`では、新着のGenerationとbadにしたカードの非表示を、グリッドへ即座には反映しません。
操作中のカードが手元で動かないよう件数だけを知らせ、利用者がボタンを押したとき（またはページを
再読み込みしたとき）にまとめて反映します。

#### 新着

対象は`ids`・Tag・Rating・Bookmarked only・公開済みのみ・基準のみのいずれも指定していない既定表示だけで
（`view`・`bad`は絞り込みに数えません）、その条件下でだけクライアントはviewer WebSocket
（`/api/v1/requests/ws`、[worker-protocol.md](worker-protocol.md#段階-3-workerhub)）を開き
（[Generation Detail](#generation-detail)のFinalizeで説明したrequest live接続を共有します）、
`generation`メッセージを受けます。

現在の`view`で受理できるものだけを扱います — `raw`は`refines_generation_short_id`が
nullのものだけ、`refined`はnon-nullのものだけ、`all`は両方です。既にグリッドに表示済みか
反映待ちに積んだshort_idは無視します。受理したら`GET /g/{short_id}?partial=card`（Gallery一覧と
同じ`GenerationCard`フラグメント）を取得し、反映待ちに積みます。

#### bad

badを隠している間（`bad=1`も`ids=`も指定していないとき）、カード上でratingを
badにすると、カードはその位置のまま不透明度0.4（hover時0.75）になり、反映待ちに数えます。
反映前にbad以外へ付け直すと元の表示に戻り、反映待ちからも外れます。Bookmarksでは何も隠しません。

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

### GenerationCard

カードはサムネイル1枚と、その下の2行（short_idとbookmarkの行、rating（bad/neutral/good）の行）です。
short_idは等幅の文字そのものがボタンで、クリックするとクリップボードへコピーし、0.9秒間`--good`色に
変えて末尾に✓を出します。サムネイルは[Generation Detail](#generation-detail)への素のリンク
`<a href="/g/{short_id}">`です。サムネイル左上には
（上から順に、両方あれば縦に積みます）、このGenerationがfinalize/repair/
masked_redrawで書き換えた元のraw Generationがあるとき`from <short_id>`バッジ（`#402e21`地に
橙文字、short_idは等幅）。バッジはクリックで元のshort_idをコピーし（遷移しない）、コピー後は
short_idのボタンと同じく0.9秒間`--good`色に変えて✓を出します。サムネイルのリンク内なので
`<button>`ではなく`role="button"`・`tabindex="0"`の`<span>`で、Enter / Spaceでも動きます。
このGenerationを対象にした最新のfinalize/repair/masked_redraw
requestがあるとき進捗ピル（後述）を、左下には[Publication](domain-model.md#publication)が
1件以上あるとき送信アイコン付きの`公開済み`ピルを、このGenerationがpose の基準 render として
pin されているとき`基準 <pose名>`ピル（[domain-model.md](domain-model.md#基準-render-の-pin)）を、両方
あれば横並びで重ねます。幅600px以下ではbookmarkをサムネイル
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
short_idを取得して`kind · done → <short_id>`に差し替えます）。

カード表示例:

``` text
[ IMAGE ]
 from abc123          ← rawを書き換えた出力のときだけ
 finalize · queued    ← finalize/repair/masked_redraw requestがあるときだけ
 公開済み             ← Publicationが1件以上あるときだけ

abc123                    🔖   ← short_idはクリックでコピー
bad  neutral  good
```

Bookmarks / Compareも同じカードコンポーネントを使い、from-badge / 公開済みピルは
表示します。

表示しないもの（サムネイルクリックで[Generation Detail](#generation-detail)を開けば見られます）:

-   画像メタ（解像度/ファイルサイズ）
-   タグ
-   commit hash
-   prompt全文
-   git diff
-   semantic全文
-   ComfyUI workflow

## Compare

複数GenerationのSemantic Metadataをdiff表示します。

対象は2〜9枚です（10件以上を渡すと先頭9件だけを表示し、警告を出します）。

Generationごとに縦カラムで並べ、各カラムはGalleryと同じ[GenerationCard](#gallery)です
（サムネイル・from-badge / 進捗ピル / 公開済み / 基準の各バッジ・rating/bookmark行、クリックで
`/g/{short_id}`へ遷移）。比較しながらその場でratingとbookmarkを変更できます。originalが
purge済みのGenerationも、GenerationCardが常にpreviewサムネイルを使うためそのまま表示できます。

その下にsemantic比較テーブルを表示します。行は変更点（後述）、seed / created、
render_facts、summary、core 5項目（pose /
expression / outfit / style / composition）、strengths、defects、そして全
Generationのattributesキーの和集合（`patches` キーは変更点の `patches` 行と重複するため
除きます）。列は各Generationです。値がオブジェクトのattributeは1段だけ展開し、
全列のサブキーの和集合を `palette.sat` のような `key.subkey` 行として並べます
（各行は他のattributes行と同じ扱い）。同じキーが列によってオブジェクトとスカラー
／配列に分かれる場合は展開せず、従来どおり1行で表示します。

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

`created` 行の直後・`summary` 行の直前には、各GenerationのComfyJobから抽出した
render_facts（[domain-model.md](domain-model.md#comfyjob)参照）を `render.checkpoint` /
`render.sampler` / `render.steps` / `render.cfg` / `render.denoise` / `render.canvas` /
`render.lora` / `render.controlnet` の行として並べます。値の表現はsemantic行と同じ
コンセンサス方式のトークンハイライトを使い、行内の値が全カラムで一致しない場合は
その行を黄系ハイライト（diff）します。ComfyJobにgraphが無いGenerationはそのカラムに
`(no graph)` を表示し、全カラムが値なしの列（render_facts行）はその行ごと表示しません。

#### 変更点

テーブルの先頭（seed行の前）に、各列が何を変えたかを示す行を置きます。
いずれもRequestに保存済みの値を表示するだけで、Compareが文面を生成することはありません。

- `instruction` 行: 各Generationが属するRequestの `raw_instruction` をそのまま表示します（無ければ `—`）。全列がnullなら行ごと表示しません
- `patches` 行: 各Requestの `patches_json` のうち、全列には含まれないpatchだけを列ごとに並べます。全列が持つpatchは親から継承されたものなので省きます（patchの同一判定はキー順に依存しないJSON比較）。patchは `target`（`prompt.positive.` は省略、`prompt.negative.` は `negative.` に短縮。例: `artist` / `negative.quality`）に続けて内容を表示します。`replace` で `old` / `value` が文字列なら old→value のトークン単位の差分（削除は赤の取り消し線、追加は緑）、それ以外のopは op と value を簡潔に表示します。`reason` があれば薄い色で後ろに付けます。固有patchの無い列は `（変更なし）`。どの列にも固有patchが無ければ行ごと表示しません

#### プロンプト全文

`render.positive` / `render.negative` 行（各Generationのpass 1の
positive/negativeプロンプト、値の表現はsemantic行と同じコンセンサス方式の
トークンハイライト）は、メインのテーブルには含めず、その下の既定で閉じた
`<details>`「プロンプト全文（差分）を表示」の中の別テーブルに並べます。いずれかの
Generationが2pass以上を持つ場合は、存在するpass indexごとに
`render.positive (pass 2)` / `render.negative (pass 2)` のように追加します
（全カラムが値なしの行は表示しません）。

#### 同一の行の省略

変更点の行を除き、全列の値が同一の行（`—` や `(not analyzed)` が全列に並ぶ
semantic行を含む）は既定で非表示です。テーブルの上に「全列同一:」として省略した行を
`seed=123` のように `行名=値` のチップで並べ（折り返しはチップの間）、「同一の行も
表示」チェックで表示に切り替えます。値は60文字を超えると `…` で切り詰め、全文は
`title` 属性に入れます。全列が値なし（`—` / `(not analyzed)` / `(no graph)`）の行は
末尾に「値なし:」として行名だけをまとめます。チェックの状態はlocalStorage（`chimera-compare-show-same`）
に保存します。

#### 固定表示

セルは長い値（JSONや長文のverdictなど）でも列幅を押し広げないよう、語の途中でも折り返します。

テーブルは縦横にスクロールできるコンテナに収め、ヘッダ行（short_id）とラベル列を
sticky固定します。固定セルは両テーマで不透明な背景色を持ち、スクロール中のセルが
透けません。ヘッダのshort_idは`/g/{short_id}`へのリンクで、カードのサムネイルと同じく
カーソルを乗せるとその画像をカーソル脇に拡大表示します。

Compareが書き込むのはrating/bookmarkだけで、ComfyUIへの生成要求も指示テキストの生成も行いません。

### Compare entry

Generation Detailの`比較に追加`ボタンがsessionStorageのcompare set（タブ内限定、要素は
`{ id, short_id }`）をトグルします（ボタンのラベルは`比較から外す`に切り替わります、
telemetry `compare.add`）。

`#compare-bar`はLayoutが全ページの下端に固定配置し、setが空でない間だけ表示します。表示中は
`main`の下にバーの高さ（`--compare-bar-h`、3.75rem）分の余白を足し、Generation Detailの
2カラムはその分だけ高さを縮めます。バーの中身は左から次の順です。

-   選択中の各Generationのサムネイルチップ（2.75rem角、右上に×）。クリックでsetから外します
    （telemetry `compare.remove`）。サムネイルはカードと同じ`/g/{short_id}/preview`で、
    10件目以降は`/compare`に渡らないため薄く表示します。横に溢れたらチップの列だけ横スクロールします
-   `すべて解除`: setを空にしてバーを消します（telemetry `compare.clear`）
-   `Compare (N)`: `/compare?ids=...`（先頭9件のshort_id）へのリンク（telemetry `compare.open`）

別ページでsetを変えてからBackで戻った（bfcacheから復元された）ときもバーを描き直します。

## Generation Detail

幅1100px以上では左ペインに画像をペイン全体で表示し、右ペイン（幅比 2:1）に
情報を縦に並べます。それ未満の幅では画像を最上部に大きく表示する縦一列です。

``` text
[ IMAGE ] | abc123  比較に追加
[ IMAGE ] | 結月ゆかり
[ IMAGE ] | good  🔖
[ IMAGE ] | 基準にする
[ IMAGE ] | 公開 ...
[ IMAGE ] | #pose-good ×  #outfit-good ×   [add tag] [+]
```

見出しのshort_idとコピーボタンの隣には、このGenerationがfinalize / repair /
masked_redrawで書き換えた元のraw Generationがあるとき、小さな`--text-dim`色の
`from <short_id>`（short_idは`/g/{short_id}`へのリンク）とそのコピーボタンを添えます。
rawのGenerationには出しません（`GET /api/v1/generations/{id}`の`refines_generation`）。

originalが保持期間ジョブでpurge済み（[domain-model.md](domain-model.md#original-の保持)）の
Generationは、画像に`GET /g/{short_id}/preview`（1024pxのpreview）を表示し、画像meta欄の下に
`原寸は破棄済み（preview のみ）`と添えます。Finalizeセクションはfinalizeフォームを出さず、代わりに
「原寸は破棄済みのため finalize / repair / masked redraw は積めません。」という一文を表示します
（profile登録フォームと進捗履歴のrequest一覧は表示したままです）。

情報セクションは折りたたみ可能（`<details>`）ですが、既定ですべて展開して
表示します（展開クリックを不要にするため）。生JSON（Semantic の Raw JSON、
Workflow の Raw graph）のみ既定で畳みます。

``` text
Finalize
仕上げの解決値
Summary
Semantic
親
子
兄弟
同じ Request の Generation
Workflow
ComfyUI Job
Git
Note
```

rating/bookmark行の直後は「基準」行です。このGenerationがposeの基準 renderとしてpinされていれば
`基準 <pose名>`ピルを、されていなければ`基準にする`ボタンを表示します。ボタンは
`POST /api/v1/generations/{id}/pose-reference`（[api.md](api.md#pose-reference-pin)）でpinし、
その場で行をピルに書き換えます。recipe / poseはサーバーがGenerationの属するRequestから推測し、rating goodでない
Generationなどは拒否されます（[domain-model.md](domain-model.md#基準-render-の-pin)）。

続く`公開`セクションは[Publication](domain-model.md#publication)
が1件以上あれば送信アイコン付きで`公開済み（N）`を`#4fd8a4`で、無ければ`未公開`を
`--text-dim`で表示します。続けて記録済みのPublicationを`MM-DD HH:mm`（`--text-dim`）・
URL（あればリンク、無ければ`URL なし`と埋め込み用のURL入力欄）・`×`削除ボタンの行として
新しい順に並べ、末尾に`投稿 URL（空でも記録できる）`のテキスト入力と`公開を記録`ボタン
（枠線・文字とも`#4fd8a4`、角丸6px）の追加フォームを置きます。追加・URL入力・削除の
いずれも`/api/v1/generations/{id}/publications`・`/api/v1/publications/{id}`をfetchし、
リロードなしでセクションを書き換えます。

#### タグ追加

`公開`の下には付与済みタグのチップ（各チップに`×`削除ボタン）とタグ追加フォームを置きます。
フォームは自由入力のテキスト欄で、入力のたびに200ms待って`GET /api/v1/tags?q=`（前方一致、
最大20件）を引き、既存タグ名を`<datalist>`の候補として出します。未登録の名前を送ればそのタグを
作って付与します。追加・削除ともリロードせずチップを書き換えます。

`仕上げの解決値`セクションは、このGenerationを産んだrequestの結果が`resolved_options`を持つとき
だけ出し、要求した`options`（requested）とworkerが解決した値（resolved）をJSONのまま並べます。

親・子・兄弟は、FamilyCard（サムネイル + タイプバッジ + short_id + 補足テキストの横並びカード、
`family-strip`）で表示します。関係は 素材参照（Generation → Request、`request_references`）と
仕上げ元（Generation → Generation、`generations.refines_generation_id`）の2種に分離されたまま
（CLAUDE.md の不変条件）で、画面上は用途別セクションではなく「親・子・兄弟」の3セクションにまとめます。
カードのリンク先は相手の `/g/{short_id}` です。Requestを相手にする関係は、そのRequestの最初のGeneration
（Jobのindex、出力のindexの昇順で先頭）を代表にし、カードに「via request」という補足を添えて、
Generation自身の関係と区別します。まだGenerationを持たないRequest（queued / running）はカードにしません。

-   親: ①このGenerationが属するRequestの素材（バッジ `Reference`、素材のGenerationカード。
    purpose/aspectを表示） ②このGenerationが仕上げた元のGeneration（`refines_generation_id`、バッジ
    `Refinement`、Generationカード） ③このGenerationが属するRequestの結果にあたるRunの親Run
    （`parent_run_id`が指すRun）の結果Request（バッジ `Experiment`、`run #親 → run #自分`を表示、「via request」）
-   子: ①このGenerationを素材に使ったRequest（バッジ `Reference`、Requestの代表Generationカード。
    purpose/aspectを表示、「via request」） ②このGenerationを仕上げ元とするGeneration
    （バッジ `Refinement`、Generationカード） ③このGenerationが属するRequestの結果にあたるRunを
    `parent_run_id`とする子Runの結果Request（バッジ `Experiment`、`run #自分 → run #子`を表示、「via request」）
-   兄弟: 同じExperimentの他Run（親・子を除く、結果Requestを持つRunのみ）の結果Request
    （バッジ `Experiment`、「via request」）

`Experiment` バッジのカードは素材参照・仕上げ元のどちらでもない、ExperimentRun（`parent_run_id` /
`run_index`）から読み取り時に導出するだけの表示専用の軸です（CLAUDE.mdの2種統合禁止の対象外で、行を
作りません）。Reference / Refinement / Experiment はそれぞれ青・橙・紫の固定配色です。

`同じ Request の Generation` セクションは、このGenerationと同じRequestに属する他のGeneration
（`GET /api/v1/generations/{id}` の `siblings`）を、バッジ `Request` のFamilyCardで並べます。
カードは各Generationの `/g/{short_id}` へのリンクで、補足テキストに出力のindex（`output N`）を出します。
他のGenerationが無ければ `None.` と表示します。

Workflowセクションは「同じ Request の Generation」の直後にあります。このGenerationの
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
positive/negativeは`PromptChips`コンポーネントで表示します。pass 2以降の行は直前のpassのプロンプトに対する
トークン差分（追加=緑枠、weight変化=黄枠バッジ、削除=取り消し線の別行）を表示し、
trim後に完全に同じ場合は「same as pass N」とだけ表示します。

graphが無い（未抽出）場合は `(no graph)` とだけ表示したうえで、Requestの
`prompt` / `negative_prompt` をpositive/negativeのチップとして、seedは
ComfyJobの`seed`列を表示するフォールバックにします。graphがあり、かつ
Requestの`prompt`（trim後）がpass 1のpositiveと異なる場合は、dimな
「request prompt differs」行と、折りたたみ`Request prompt`（Requestの
promptをpass 1のpositiveに対して差分表示したチップ）を追加します。

`Output`行は最初の（node id順）`SaveImage`の`filename_prefix`です。
末尾の折りたたみ`Raw graph`にはComfyJobの`graph`をそのままJSON整形して表示します。

Finalizeセクションは、Generation Detailから積める唯一の生成要求です（範囲は
[Core Principle](#core-principle)、契約は[worker-protocol.md](worker-protocol.md)）。フォームは3つの
`fieldset`（`仕上げ` / `納品の見た目` / `部分描き直し`）にグループ化されます。各
コントロール名自体は`comfy-recipes` CLIのフラグ名（worker-protocol.md参照）に
揃えて英語のままとし、ラベル直後に`?`の`finalize-help`マーカーを添えます。マーカーは
ホバー/フォーカスで日本語の説明を`::after`吹き出しで表示するだけのCSS実装（JS不使用）で、
`repair hands` / `repair feet`は1つのマーカーを共有します。

`仕上げ`グループの先頭に`deliver only (no redraw)`のチェックボックスがあります
（既定off、dial対応の有無に関わらず常に表示）。チェックすると`options`に
`deliver_only: true`を積み、`denoise` / `repair_lora`のキーは送りません
（`keep_legwear`も一緒に`disabled`になります）。`repair hands` / `repair feet` /
`repair pad`とregion描画（後述）はdeliver only中も使えます — チェックした部位・
描いた範囲があれば`repair` / `repair_regions`は変わらず積み、加えて候補数を指定する
`repair_seeds`（既定`disabled`、部位チェックか範囲のどちらかがある間だけ有効）を積みます。
外すとdenoise / keep_legwearが元の状態に戻り、`repair_seeds`は送らなくなります。

`仕上げ`グループには`hires`のselectもあります。`off`（既定、`hires` / `hires_denoise`とも
送らない）、`2048 · denoise 0.45 線まで描き直す`、`2048 · denoise 0.35 構図を保つ`の3択で、
選ぶと`options`に`hires: 2048`と`hires_denoise: 0.45 | 0.35`を積みます。`hires`の値は標準canvas
（1024x1640）の長辺をその値にしたときの画素数を表し、元絵の縦横比のまま合わせるので、縦長は1280x2048、
正方形は約1616四方になります。finalizeの前に
元Generationのgraphに同じseedのhiresを足してworkerが描き直し、他のoptionはその絵に掛かります。
hiresはdeliver only中だけ使え、repairとは併用できないので、hiresを選んだままdeliver onlyを外すか
repairの部位・範囲を使うと、送信時にalertを出して積みません（プレビューは`送信内容: —`）。プロファイルを押すと、プロファイルの
`hires` / `hires_denoise`がselectの選択肢に一致するときだけselectがそれに切り替わります。

catalogの`recipes[].finalize.dof`があるrecipeだけ、`ボケ`グループを出します。`被写界深度ボケ（dof）`の
チェックボックス（既定オフ）をオンにすると、`範囲指定`がOFFの間は画像をクリックしてピント位置を置け、
クリックした位置にマーカーを出して`ピント: 0.82, 0.55`のように表示します。置いた位置はチェックを外しても
保持します。F値のスライダーはcatalogの`finalize.dof.f_number.stops`の段に吸着し、既定はcatalogの
`default`に最も近い段で、`f/2.8`のように表示します。チェックしたままピント位置が無いときと、repairの
部位・範囲を使っているときは、送信時にalertを出して積みません（workerはdofとrepair系optionの併用を
`failed`にします）。catalogに`finalize.dof.scope`があるときだけ、`背景もぼかす`のチェックボックスも出します（既定は
catalogの`default`）。オンにすると白フチ・紫フチ・影・背景までぼかし、`dof`がオフのときと`透過PNG`を
選んでいるときは無効になります（workerは透過納品との併用を`failed`にします）。送るのは
`dof: {focus: [x, y], f_number, scope}`（`scope`はチェックありなら`all`、なしか無効なら`figure`、チェックボックスが無いときは省略）で、
オフなら`dof`を送りません。catalogに`finalize.dof.viewfinder`があるときだけ、`ファインダー表示`のselect
（`OFF` / `ON` / `ON/OFF 2枚`、既定はcatalogの`default`、`dof`がオフの間は無効）も出し、`OFF`以外を選んだときだけ
`dof.viewfinder`に`on` / `both`を付けます。
プロファイルを押すと、プロファイルの`dof`に合わせてチェック・ピント位置・スライダー・背景もぼかす・ファインダー表示が切り替わります。

`納品の見た目`グループの中に、ラベル列と操作列を揃えたグリッドで3つの操作を並べ、ヘルプの`?`は1つだけ置きます。
- `光源`のselect（`なし` / `夕日` / `月明かり`、既定は`なし`）。catalogに`finalize.light`があるときだけ出します。未知の場面はcatalogの値のまま表示します。
- `光の向き`のselect（`左上から` / `上から` / `右上から` / `左から` / `右から` / `左下から` / `下から` / `右下から`）。紫縁の太い側・落ち影・光源の光の向きをまとめて決める1つの操作で、値は`nw` `n` `ne` `w` `e` `sw` `s` `se`です。
- `紫縁`のselect（`立体` / `均等` / `無し`）。

送るのは`stroke_light`と`light`です。`紫縁`が`立体`なら`stroke_light`は`光の向き`の値、`均等`なら`even`、`無し`なら`none`です。`光源`が`なし`以外のときは`light: {scene, from}`も送り、`from`は`光の向き`の値です。`紫縁`が`立体`のときは`stroke_light`を送らず、workerが`from`に揃えます。`均等`と`無し`は`light`と一緒に送ります。`光の向き`が効くのは`光源`を選んだときか`紫縁`が`立体`のときだけなので、`光源`が`なし`で`紫縁`が`立体`以外の間は無効にします。
既定はcatalogの`finalize.defaults.stroke_light`で決めます。方位なら`紫縁`は`立体`で`光の向き`はその方位、`even` / `none` / `null`（未指定を含む）なら`紫縁`は`均等` / `無し` / `均等`で`光の向き`はcatalogの`default_from`（無ければ`上から`）です。
`light`は`deliver_only`のときだけ使え、repairとは併用できません（チェックはworkerが行います）。プロファイルを押すと、
`stroke_light`の方位は`立体`と`光の向き`、`even`と`null`は`均等`、`none`は`無し`として選び直し、`light`は`光源`と`光の向き`を切り替えます（`light`が無いプロファイルは`なし`）。送信内容の表示は`光源 夕日 · 左上`の形です。

このGenerationが属するRequestのrecipeにcatalogの`dials.finalize`かchimeraの`finalize`プロファイルの
どちらか一方でもあるときだけ、フォームは以下のdial対応表示に切り替わります。どちらも
無いrecipeは数値入力とチェックボックスで表示します
（[domain-model.md](domain-model.md#finalize-プロファイル)）。

dial対応フォームは`仕上げ`グループの直前に`profile`の行を持ち、そのrecipeの
`finalize`プロファイル（`list_presets kind=finalize`の最新active版）をボタンで
並べ、先頭に`custom`（プロファイルを指名しない）を置きます。プロファイルを押すと
下のフィールド群がそのプロファイルの`options`で埋まり、以後フィールドを編集しても
プロファイルの指名（hiddenな`profile_name` / `profile_version`）は外れません —
送信時は常にフォームの現在値を`options`として送りつつ、`profile`も一緒に送ります。
サーバー側がこの2つを`{ ...profile.options, ...options }`で合成するため（明示した
キーが勝つ）、結果はどのキーを人が実際に変えたかに関わらず一致します。

`denoise`のような数値フィールドは、そのrecipeのcatalogが`dials.finalize.denoise`
（word → number）を持つときだけ、数値入力の代わりに word ボタンの列（＋`既定`
＋`custom`）になります。`custom`を押すと数値入力が現れ、どのwordボタンも押していない
状態（`既定`）は空欄送信と同じ`null`です。`keep legwear` / `repair lora`は
dial対応フォームに切り替わった時点で、catalogの語彙の有無にかかわらず常に
`off` / `on` / `custom`の3択になります（`on`はworker既定の重みを表す真偽値
`true`を送ります）。

納品の見た目グループは`backdrop`のサムネイルピッカー（ラジオボタン）を持ちます。
カタログの`backdrops`（[api.md](api.md#recipe-catalog)、名前・ラベル・サムネイルの
配列）を1枚ずつカードで並べ、末尾に固定の`transparent`（透過PNG）と`color`（単色）の
2枚を置きます。サムネイルは`GET /api/v1/catalogs/{recipe_ref}/backdrops/{name}.png`
（`?v=`にcatalogのupdated_atを付けたキャッシュバスター付きURL）から都度取得し、
カタログに`backdrops`が無い場合はサムネイル無しの`stripes`カード1枚だけに
フォールバックします。既定の選択はcatalogの`finalize.defaults.backdrop`（無ければ
先頭のパターン）に従います。`color`を選ぶとlabel内に置かれた`#RRGGBB`のテキスト入力が
現れます。初期値はcatalogの`finalize.backdrop_color`（`#RRGGBB`のときだけ。無ければ`#ffffff`）で、
空か形式違いなら送信せずalertします。続けて`光源` / `光の向き` / `紫縁`の3つの操作を持ちます（上記の`光源`グループの説明を参照）。

部分描き直しグループは`repair hands` / `repair feet`のチェックボックス（既定どちらも
off。1つ以上チェックすると`repair`配列を積みます）と、`repair pad`の数値入力
（空欄が省略=worker既定を意味する）を持ちます。`repair pad`はrepair hands /
repair feetのどちらもチェックされていない間`disabled`で、どちらかをチェックすると
有効になります。`repair lora`はdeliver only中は常に`disabled`（Anima＝recipe yukariの絵を
deliver onlyで使うときはworkerがここを無視するため、GUIはrecipeを問わず一律disabledにする）、
それ以外はrepair hands / repair feetのどちらかが必要です。

Generation Detail（画像1枚に対して1つのFinalizeフォームが並ぶページ）は
これに加えて、画像の上にドラッグで矩形を描いて`repair_regions`を指定する操作を持ちます。画像の親要素に`repair-region-overlay`をJSでサイズ・位置とも
`<img>`に一致させて重ね、フォーム上の「範囲指定」トグル（`data-repair-region-toggle`、既定OFF）をONにしている間だけ、ポインタイベント（マウス/タッチ共通）でのドラッグ1回が矩形1つ
（`repair-region-rect`、右上に消去ボタン）になり、複数指定できます。矩形は表示中の画像
サイズに対する分数`[x0, y0, x1, y1]`（0〜4桁に丸め、0..1にクランプ）としてfinalize
formの状態に保持され、フォーム上の「範囲をすべて消す」ボタン（`data-repair-region-clear`）
で一括削除できます。OFFの間はoverlayが`pointer-events: none`になり、画像のクリック・右クリック・タッチスクロールは画像側に届きます。描いた矩形はOFFにしても残り（送信にも積まれる）、消去ボタンもそのまま押せます。`repair`配列が空でも`repair_regions`だけを積めます（部位チェックと
範囲、どちらか片方だけでも送信可）。描き直し（redraw）・deliver onlyどちらのモードでも、
範囲が1つ以上あれば`repair_regions`を積み、`repair`は空配列にします（描いた範囲が部位の自動検出を置き換える。検出の円を矩形に足すとマスクが部位の外まで広がるため）。`repair pad` / `repair lora`のdisabledは
部位チェックだけで決まり、範囲の有無では変わりません。`repair seeds`
（deliver only中のみ）は部位チェックか範囲、どちらか一方でもあれば有効になります。

送信ボタンの上には`finalize-preview`の一行があり、フォームの現在値から実際に
積まれるoptionsのkeyだけを`profile daily v2 · backdrop=stripes · denoise tidy (0.65)
· keep_legwear`のように`·`区切りで表示します（値が`true`のキーはキー名だけ。
backdropが不正な値のときは`送信内容: —`）。プロファイルを指名していれば先頭に`profile <name> v<version>`
を置きます。`backdrop`は常に送るキーなので必ず出し、`transparent`を選んで`null`を
送る場合も`backdrop=transparent`と表示します。wordを送るキーは、そのrecipeの
`dials.finalize`が対応するnumberを持っていれば`<word> (<number>)`と添えて表示します
（catalogに無いwordは数値無しでそのまま表示）。この表示はsubmit時と同じserializer
（`finalizeOptionsFrom`）を使うため、送信内容とズレません。
Finalizeボタンで`POST /api/v1/requests`（`kind: "finalize"`, `created_by:
"gui"`）を1件積み、ページの再読み込みはしません。積んだ直後の`queued`行をその場で
`request-status-list`の先頭へ挿入します（一覧がまだ無ければ作ります）。挿入先はフォームの下で
長いページでは視界の外になりやすいため、ボタン自身も押下に応えます。送信中は`disabled`で
`Queueing…`、積めたら1.5秒だけ`--good`色の`Queued ✓`を
表示して元のラベルに戻り、失敗時はすぐ戻ります。この一覧には、このGenerationを
対象とした最新のrequest（finalize / repair）を最大5件、新しい順に`status · created_at`の行として
表示し、`done`なら納品Generationへのリンク、`failed`ならその`error`を添えます。

各行は`data-request-id` / `data-request-status`を持ち、`/api/v1/requests/ws`
（段階3 WorkerHub、[worker-protocol.md](worker-protocol.md#段階-3-workerhub)参照）に
繋いだライブ接続が接続直後の`snapshot`と以後の`progress` / `status`を受けて、行内の
`.request-progress`に`phase step/total`（stepが無ければ`phase`のみ）を、`status`変化時は
行のクラスと表示statusを書き換えます。`done` / `failed`への遷移時は該当requestと
（`done`なら）納品Generationを取得し直し、ページ読み込み時と同じ結果リンク / errorをその場に
追加します。ページ読み込み後に新しく現れた行（finalize送信直後の挿入）も
現れた時点でこの接続に登録され、まだ張っていなければソケットを開きます。WebSocketが張れない
環境でも静的な表示のまま壊れません（未対応・切断時は1秒→30秒のバックオフで再接続を試み続けます）。

このGenerationが`rating = good`で、かつfinalize requestが産んだもの（納品
Generationか、相乗りしたrepairのsiblingのどちらか）であるときだけ、Finalizeの
request一覧の下に`profile に登録`フォーム（名前入力＋ボタン）を表示します。送信すると
`POST /api/v1/presets/promote-profile`を呼び、その場に`registered: <name>
v<version>`を表示します（リロードなし）。それ以外のGenerationにはこのフォームは
出ません。

手足の局所redraw（[worker-protocol.md](worker-protocol.md#repair)の`repair`）は
GUIでは独立したセクションを持たず、Finalizeフォームの`repair hands` / `repair feet`
から同じfinalize requestに乗せます。`kind: "repair"`のrequestはAPI / MCPからだけ積め、
このGenerationを対象にした行はFinalizeセクションのrequest一覧にfinalizeと並んで出ます。

## 絵柄チェック

`/check`。recipe既定のprompt/paramsが、pin済みの絵柄からずれていないか人間が見比べる
ページです。対象recipe・代表ポーズの一覧は`src/lib/style-check.ts`の`STYLE_CHECK_POSES`
が正本で、現在は`yukari`だけです。

``` text
framing   pose
bust      bust
cowboy    coffee
cowboy    gao
full      step
full      dance
full      anyo
```

ポーズごとに1行、左右2カラムで並べます。

-   左: そのposeの現在のpin（`preset_references`、`getCurrentReference` /
    `referenceView`）。[Gallery](#gallery)と同じ[GenerationCard](#gallery)（サムネイル・
    short_idリンク・基準ピル）で表示します。pinが無ければ行全体を「pin 無し」とだけ表示し、
    右カラムは出しません（描けないため）。
-   右: 今のカタログcommitでの、そのposeのplain render。default idempotency key
    (`plain:<recipe>:<pose>:<seed>:<git_commit>` — MCP `plain_render`と同じ形、
    `src/lib/plain-render.ts`の`plainRenderIdempotencyKey`)に一致するrequestを探すだけで
    (積まない)、無ければ「まだ描いていない」と表示します。requestがqueued/runningなら
    status行（[Finalize](#generation-detail)の`request-status-list`と同じ`<li
    data-request-id>`）、doneならその結果GenerationをGenerationCardで表示します。
-   pinと結果の両方が揃った行には `pin と比較` リンク（`/compare?ids=<pinのshort_id>,
    <結果のshort_id>`）を出します。

ページ上部の`今の既定で描く`ボタンが`POST /api/v1/style-check/{recipe}`
（[api.md](api.md#絵柄チェック)）を呼びます。pinを持つポーズごとに1行、MCP
`plain_render`と同じ組み立て（`buildPlainRenderRequest` → `createRequest`、`created_by =
gui`）でrequestを積みます。pinが無いポーズはskipされ、応答にその旨が残ります。idempotency
keyが上と同じ既定キーなので、同じカタログcommitへの連打は積み直さず既存行を返します
（`created: false`）。

積んだ直後は応答のrequest idをその場の右カラムに挿し込むだけで、reloadしません
（`data-style-check-slot="<pose>"`の要素を差し替える）。以後のrunning/doneは他ページと
同じ`[data-request-id]`のWebSocket購読（`registerRequestElement` /
`requestLiveApplyStatus`）で反映されます — [Finalize](#generation-detail)の
`request-status-list`と同じく、doneでstatusが変わり結果Generationへのリンクが添わります。
GenerationCard（サムネイル）への差し替えは次のGET `/check`（reload）で反映されます。

絵柄チェックが書き込むのはこのplain renderのrequest行だけで、pinそのものは変更しません
（pinの変更はGeneration Detailの「基準にする」、[domain-model.md](domain-model.md#基準-render-の-pin)）。

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
bookmark
```

status で絞り込めます。

`/experiments/{short_id}` は詳細です。Experiment概要（Base Recipe / Base
Generation（サムネイル付きリンク） / Character / Tag / 各時刻）、Runの一覧、
Promotionの順に並べます。

Runsセクションの先頭には、Runが2件以上あるときだけ Compare セクション
（`#experiment-compare`）を置きます。Runを列にした[Compare](#compare)の表で、
`/compare`と同じ`CompareView`（カード、全列同一バー、差分表、プロンプト全文の折りたたみ、
ヘッダのhoverプレビュー）を使います。

-   列はRunを`run_index`順に最大9件並べ、超えた分は「先頭 N 件の Run だけを表示しています
    （ほか M 件）」と注記します。列見出しは`variables.arm`があればその値、なければ`#<run_index>`です。
-   各列のGenerationは、選んだseedと同じseedを持つ、そのRunの結果Requestの
    Generationです。そのseedのGenerationがまだ無い列は、別のseedの画像を代わりに出さず、
    「生成待ち」のプレースホルダ列（値はすべて`—`で、差分の対象にしない）にします。
-   選ぶseedはquery `?seed=`で、省略時は`base_parameters.seeds`の先頭、なければ最初に
    Generationを持つ列のそのGenerationのseedです。Runの結果に現れるseedが2種類以上あるときは、
    各seedへのリンクを並べたスイッチャーを出します（現在のseedはリンクにしない）。
-   変更点の行は、Generationが属するRequestではなくRunから取ります。`instruction`は
    `objective`、`patches`は`overrides.patches`で、全列に共通のpatchは省き、patchを持たない
    列は`（変更なし）`と表示します。
-   `Compare で開く`リンクは、選ばれたGenerationのshort_idを`/compare?ids=`に並べます
    （2件以上あるとき）。

Compareセクションの下のRunsには、少なくとも1つのRunがrender_factsまたはvariablesを
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
プロンプトを`PromptChips`で表示します。
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
の形を認識できないRunだけleaf diffを表示します。

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

Runに紐づくGenerationがあればそのサムネイル、なければ結果Request
の最初のGenerationを1枚出します。サムネイルとその下の`request <short_id>`リンクは、いずれもその
Generationの`/g/{short_id}`へ遷移します。evaluation / decision
は固定schemaを持たないJSONなので、`overall` / `aspects` / `notes`、`action` /
`reason` / `next_overrides` を認識できたときだけ整形し、それ以外はJSONのまま見せます。

status の変更は詳細画面のselectから行います。Experiment / Run / Promotion
の削除UIは持ちません。

baseline（`run_index`が最小のRun）以外の各Runには、baselineとの `A/B vs #<baseline
run_index>` リンクが付きます（両Runに結果Requestがある場合のみ）。リンク先はA/B Judge
Viewです。

RunsとPromotionsの間に `A/B` セクションがあります。judgmentがある baseline/arm
の組ごとに1行（`#<baseline run_index> vs #<arm run_index>`、armの勝ち数 / baselineの勝ち数
/ tie数 / 合計）、行はそのペアのA/B Judge Viewへリンクします。judgmentがなければ
「No judgments yet.」。その下にRunごとのrating内訳表（生成数 / good / neutral / bad /
unrated、結果Requestの無いRunも0件で表示）が並びます。

### A/B Judge View

`/experiments/{id}/ab?baseline=<run_id>&arm=<run_id>` は、baseline runとarm
runのGenerationを人間が盲検で1対1に対比較する画面です
（[domain-model.md](domain-model.md#pairwisejudgment)のPairwiseJudgment参照）。

対象は両Runの結果Requestに共通するseedのみです（同じseedのGenerationが両方に存在する組）。
multi-output jobで同一seedに複数枚あるときは、Request内で最初に作られた1枚だけを対象にします。
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
`baseline` / `arm` が未指定・不正・別Experiment・結果Requestの無いRunを指すときは、
ペア画面の代わりに警告文を表示します。

## Bookmarks

Bookmarkした対象を素早く呼び出します。

``` text
Generations
Experiments
```

BookmarkはFavoriteではなく再利用・再訪のための導線です。どの対象も🔖の1操作で切り替えます。
Generationはカードと Generation Detail、
ExperimentはExperiment一覧の行とExperiment詳細に🔖を置きます。

GenerationsセクションはGalleryと同じ3-way view switch（`finalize以外` / `finalize` /
`すべて`）を持ちますが、既定は`view=refined`（finalize済みの出力）です。bad非表示の
トグルはありません。Experimentsセクションにはこの切り替えはありません。

Generationsセクションのカードは[GenerationCard](#gallery)でGalleryと共通です（bad非表示との
組み合わせは無いため、[Gallery pending changes](#gallery-pending-changes)のbadの扱いはありません）。

## Responsive / Density

一覧の密度は画像の大きさと列数で調整し、カードにmetadataを足して上げることはしません。
semantic情報はDetailに置きます。

ブレークポイントは3段です。

| 幅 | 挙動 |
|---|---|
| 1100px以上 | Generation Detailが2:1の2ペイン。Gallery / Bookmarksのグリッドは6列 |
| 1100px以下 | Detailは縦一列。グリッドは4列（800px以下は190px以上の幅で入るだけ並べる） |
| 600px以下 | ナビ・カード・反映ピルのタップ領域を2.75rem以上に広げ、キュー状態pillは数字だけにする |

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
| `pose_reference.set` | `generation_id` | Generation Detailの`基準にする`（`initPoseReference`） |
| `promote_profile.submit` | `generation_id`, `name`, `version` | Generation Detailの`profile に登録`（`initPromoteToProfile`） |
| `style_check.render` | `recipe` | 絵柄チェックの`今の既定で描く`（`initStyleCheck`） |
| `queue.open` | `counts` | [キュー状態](#キュー状態)pillを開く（`initNavQueue`） |
| `queue.group.click` | `kinds`, `has_request` | キュー状態パネルの行クリック（`navQueueRow`） |
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
