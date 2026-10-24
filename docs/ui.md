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
再実行（redraw / deliver）と、[絵柄チェック](#絵柄チェック)の pin 再描画と、[参考画像](#参考画像references)の解析 reference とそこから描く reference_render の requests 行だけで、
Compare は semantic metadata の diff を表示するところまでです（不変条件の正本は
[architecture.md](architecture.md#web-gui)、requests の契約は [worker-protocol.md](worker-protocol.md)）。

## Navigation

トップレベル導線は、ブランド `Chimera`（`/gallery` へのリンク）に続けて次の項目です。

``` text
Chimera
ギャラリー
ブックマーク
ワークベンチ
その他（実験 / 絵柄チェック / 写真 / 参考画像 / 統計）
```

`その他` は `<details><summary>`によるドロップダウンです。開くと
`実験` `絵柄チェック` `写真` `参考画像` `統計` の5リンクを持つパネルが summary の直下に現れます。
パネル外クリックまたは
Escapeで閉じます（キュー状態pill・[絞り込みパネル](#gallery)と共通の挙動、`initPopoverClose`）。

現在地に対応するナビ項目には`aria-current="page"`を付け、下線（`text-decoration-color:
var(--accent)`）で強調します。`/gallery`ではGallery、`/bookmarks`ではBookmarks、`/work` 配下（`/work/{short_id}`含む）ではワークベンチ、`/experiments` 配下
（`/experiments/{short_id}` `/experiments/{short_id}/ab`含む）と`/check`・`/stats`・`/photos`・`/references`では`More`のsummaryが
アクティブになります。`/compare`はグリッドから入る
導線なのでGalleryをアクティブにします。`/g/{short_id}`はどの項目もアクティブになりません。

幅600px以下では、ナビの水平パディングを0.6rem・項目間隔を0.4rem・文字を0.8remに詰め、各リンクと`More`の
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
1行 = 1グループで、redraw/deliver/repair/masked_redraw（と古いfinalize）は仕上げ元Generationが属するRequest単位、
run_idを持つgenerateはExperiment単位、run_idの無いgenerateはrequest単位にまとめます
（集計規則は[api.md](api.md#summary)）。各行はサムネイル・Request（仕上げ元のRequest）または
Experimentのshort_id・kind別件数・状態別件数を表示し、遷移先（仕上げ元Requestの最初の
Generation `/g/{short_id}` またはExperiment詳細 `/experiments/{short_id}`）があればリンク、
無ければリンクなしの行です。パネルは表示・
遷移専用で、redraw/deliverのような再実行やcancelledなどの操作は一切持ちません。パネル
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
[ 納品以外 | 納品 | すべて ]   bad も表示 ☐   途中を隠す ☐   [ 絞り込み ▾ ]
```

`view` は3値の切り替えです。ラベルは `納品以外` / `納品` / `すべて` で、既定は `view=all`（raw / 仕上げ済み両方）、
`view=raw`（redraw/deliver/repair/masked_redrawの出力ではない raw Generationのみ）、
`view=refined`（仕上げ済みの出力のみ）へ絞り込めます。判定は Generation の
`refines_generation_id`（[domain-model.md](domain-model.md#generation)）です。

「bad も表示」は既定で隠している bad rating の Generation を表示に加えるトグルです
（`bad=1`）。未評価・good・neutralの Generation は常に表示します。

「途中を隠す」は仕上げの連鎖の先端だけを出すトグルです（`tip=1`、API の`tip=true`）。
bad でない続き（その Generation を仕上げ元にする Generation）がある Generation を隠すので、
ワークベンチで積んだ絵は最後のフェーズの出力だけが残ります。採用しなかった候補は先端なので残ります。
view / bad と同じく他の絞り込みをまたいで保持し、新着のライブ反映も止めません。

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
モデル系統（anima / il / moss / 不明、複数選択は OR）
```

「公開済みのみ」は`published=true`（[api.md](api.md#generation-search)）で、少なくとも1件
[Publication](domain-model.md#publication)を持つGenerationだけに絞ります。「基準のみ」は
`reference=true`（[api.md](api.md#generation-search)）で、いずれかのpose の基準 render として
pin されているGenerationだけに絞ります（[domain-model.md](domain-model.md#基準-render-の-pin)）。
どちらも他のフィルタと同じくview/badトグルをまたいで保持され、いずれかの項目に値が入っているかの
判定にも数えます。

「モデル系統」は`model`（`anima` / `il` / `moss` / `unknown`）で、チェックボックスは同じキーを
繰り返して送ります（リンクはカンマ区切りの1値）。`unknown`は系統が決まらない Generation
（`model_family`が NULL）です。

フェーズはパネルに入れず、ツールバーの下段にボタンとして並べます。ワークベンチのフェーズ列と同じ順に
元絵 › 描き直し › フチ › 彩度 › 背景 › 光 › ボケ をつなぎ、区切りの後ろにレンズ / 写真合成 / 取り込みを置きます。
ボタンは押すたびにその値を`phase`（カンマ区切り、複数選択は OR）に足し引きするリンクで、ほかの絞り込みと
view / bad を保ちます。選んでいる間だけ「解除」が出ます。パネルの検索は選択中の`phase`を hidden で送り直します。
フェーズはその Generation の Request の`kind`に対応し、`generate`は generate / finalize、`redraw`は
redraw / repair / masked_redraw、それ以外は同名の kind です（対応表は`src/lib/phases.ts`）。`model`も
`phase`も[api.md](api.md#generation-search)の絞り込みで、タイムラインと枠範囲にも同じ値が渡ります。

Character / 日付範囲 / ComfyUI Job ID / original filenameによる絞り込みはパネルに置かず、
`GET /api/v1/generations`のqueryとしてMCP/APIから使います（[api.md](api.md#generation-search)）。

`ID`の指定を解決した結果がGeneration 1件だけになったとき（他の指定と組み合わせた結果も
含む）は一覧を描画せず`/g/{short_id}`へ直接遷移します。0件・2件以上のときは通常どおり
一覧を表示します。`ID`を指定した検索は`view`とbad非表示を無視し、指定したGenerationだけを
返します。

`ids`指定の一覧（タイムラインを持たない）は無限スクロールです。グリッド末尾の「もっと見る」
リンクが画面に入ると次ページを自動でフェッチしてグリッドへ追記します（JS無効環境ではリンクとして
機能します）。タイムラインのある一覧は次の「Gallery timeline」のとおり、全件分の枠を先に並べます。

詳細ページからBackで戻ったときの復元は、`ids`指定の一覧では`history.state`の`galleryUntil`
（読み込んだ末尾カードのカーソル）で`until=`付きの1回のフェッチに置き換えて追記し、記録したカードを
同じ画面位置へ戻します。サーバーは`cursor`から`until`のカーソルが指すGenerationまで（上限2000件）を
1つの結果として返します。タイムラインのある一覧の復元は「Backによる復元」を参照してください。

### Gallery timeline

一覧は生成時刻（`created_at`）をJST（UTC+9）の15分枠に区切って見せます。枠のキーはJSTの壁時計で
`2026-10-06T21:45`と書き、Generationのない枠は表示しません。

各カードのroot（`.card`）に所属する枠のキーを`data-slot`として持ちます（`?partial=card`の
ライブ用フラグメントも同じ）。グリッド（`[data-gallery-grid]`）の中では、JST日付が変わるカードの
直前に日付見出し、枠が変わるカードの直前に枠見出しを全幅（`grid-column: 1 / -1`）で挟みます。
カードの大きさと6 / 4 / autoの列数は見出しの有無で変わりません。

``` text
10月6日（火）  397 枚 · 49 枠      ← 日付見出し。nav と toolbar の下に sticky
21:45–22:00 · 12 枚                ← 枠見出し
[card] [card] ...
```

見出し（`data-date-header="2026-10-06"` / `data-slot-header="2026-10-06T21:45"`）は、先頭ページ分を
サーバーが、残りをクライアントが描画します。枚数はクライアントが埋めます。

#### 枠を先に並べる

画像は遅れて読み込まれても、カードの枠は最初から全件分あり、読み込みで位置がずれません。

-   サーバーは`GET /api/v1/generations/timeline`（[api.md](api.md#generation-timeline)）と同じ結果
    （一覧と同じ絞り込み。`ids`指定は対象外）を`<script type="application/json" id="gallery-timeline-data">`
    としてグリッドの直前に埋め込みます。ページ読み込み後の往復なしに全体の並びが決まります
-   サーバーが描画する本物のカードは先頭ページ（`at=`のときはその枠から始まるページ）だけです。
    クライアントは、そのページの最後の枠の残り、それより古い全枠、`at=`のときはそれより新しい全枠について、
    日付見出し・枠見出しと、その枠の枚数ぶんのスケルトン（`.card.card-skeleton[data-slot]`）を1回の
    `insertAdjacentHTML`でまとめて並べます。`at=`のとき新しい側のスケルトンは先頭の前に入りますが、
    先頭ページの先頭カードが同じ画面位置に残るようスクロールを補正します。`.load-more` / `.load-newer`
    リンクはこのとき取り除きます（JS無効環境ではリンクのまま機能します）
-   スケルトンは子要素を持たない1要素で、サムネ領域（`--thumb-ar`）と固定高の`card-row`を擬似要素で
    作ります。実カードの`card-row`も同じ固定高（`--card-row-h`）で、短いrow2つ（short_idの行と
    ratingの行。各`--card-id-h` / `--card-rate-h`、幅600px以下は各2.75rem、それ以外は各1.5rem）と
    パディング・gapの合計です。枠線も含めて実カードと外寸が一致します。塗りは`--bg`の単色で、
    アニメーションはありません
-   画面の上下1.5画面ぶんに入った枠でスケルトンが残っているものを、隣り合う枠をまとめて1リクエスト
    （最大200枚。1枠が200枚を超えるときはその枠だけ）で取得し、スケルトンを同じ位置のカードと1対1で
    置き換えます。同時に最大3リクエストで、画面中央に近い順に取ります。取得は
    `/gallery?slot_from=<枠キー>&slot_to=<枠キー>&partial=1`（現在のURLの絞り込みをそのまま引き継ぐ。
    [api.md](api.md#gallery-slot-range)）で、スクロール・リサイズ・反映のたびに判定します。失敗した
    枠は5秒後にもう一度試します
-   返ったカードの数が枠の枚数と違うとき（取得の間にデータが変わった場合）は、返ったぶんでその枠の
    スケルトンを置き換え、枠見出しの枚数とレールを直します。ここだけは小さな位置ずれが起こりえます。
    すでにその枠にある本物のカード（反映した新着など）は重複させません

右端にはビューポートに固定した縦のレール（幅56px。幅480px以下では44px）を置きます。
グリッドを含む`.container`は右に`--rail-w`分の余白を取るのでカードには重なりません。レールは
compare barがあるときはその上までに収まり、z-indexはsticky toolbarより上・pending pill / compare
barより下です。レールがあるページではブラウザのスクロールバーを隠します（ホイール・キー・タッチでのスクロールはそのまま）。

-   位置は新しい方からの累積枚数の割合で、一番上が最新です
-   日付ラベル（`10/6`）を各日の最初の枠の位置に、20枚以上の枠にドットを置きます。ラベルが14px未満で
    重なるときは古い方を隠します
-   つまみはスクロールに追従します。画面最上部に見えているカード（スケルトンを含む）の`data-slot`と、
    その枠の中での順番から割合を求めます
-   hover / ドラッグ中は`10月6日（火） 15:45–16:00`と`21 枚`のバブルを出します
-   ドラッグ / クリック / キーのジャンプは、その枠の見出しまでスクロールするだけです（枠内は枚数で
    補間して、そのカードの位置まで）。枠は常にDOMにあるのでページ遷移も追加読み込みもなく、着いた先の
    カードは近づいた時点で上の手順で埋まります
-   レールはフォーカスでき（`role="slider"`）、上下 / PageUp / PageDownキーで約2%ずつ動きます

`ids`指定の一覧はタイムラインもレールも持たず、上の無限スクロールのままです。

#### at=

`/gallery?at=2026-10-06T21:45`は、その枠の終端（JSTの22:00）より前で最新のGenerationから先頭ページを
描画します（絞り込みは有効のまま。`ids`・`cursor`・`after`と併用したときは無視します）。
クライアントはそれより新しい枠のスケルトンを上に並べ、見ている位置をその枠に保ちます。ブックマークした
`at=`のURLは、同じ枠が最初に見える位置で開きます。グリッドには`data-gallery-at`が付きます。

`after=<カーソル>`（新しい方向の1ページ）は`/gallery`の`partial=1`として残していますが、タイムラインの
クライアントは使いません。

#### Backによる復元

カードのサムネイルをクリックした時点（と`pagehide`）で、そのカードの枠キー・枠内の順番・短いIDと画面上の
位置を`history.state`（`galleryAnchorSlot` / `galleryAnchorIndex` / `galleryAnchor` /
`galleryAnchorTop`）へ記録します。Backによる再訪（`back_forward`。リロードや通常の遷移では復元しません）では、
全件分の枠を並べたあとで、そのカードが同じ画面位置に来るようスクロールします（短いIDが残っていればそれを、
なければ枠キーと枠内の順番で探します）。カードは通常の埋め込みで順次埋まります。

### Gallery pending changes

`/gallery`では、新着のGenerationとbadにしたカードの非表示を、グリッドへ即座には反映しません。
操作中のカードが手元で動かないよう件数だけを知らせ、利用者がボタンを押したとき（またはページを
再読み込みしたとき）にまとめて反映します。

#### 新着

対象は`ids`・Tag・Rating・Bookmarked only・公開済みのみ・基準のみ・モデル系統・フェーズのいずれも指定していない既定表示だけで
（`view`・`bad`は絞り込みに数えません）、その条件下でだけクライアントはviewer WebSocket
（`/api/v1/requests/ws`、[worker-protocol.md](worker-protocol.md#段階-3-workerhub)）を開き
（[Generation Detail](#generation-detail)のRequestsで説明したrequest live接続を共有します）、
`generation`メッセージを受けます。

現在の`view`で受理できるものだけを扱います — `raw`は`refines_generation_short_id`が
nullのものだけ、`refined`はnon-nullのものだけ、`all`は両方です。既にグリッドに表示済みか
反映待ちに積んだshort_idは無視します。受理したら`GET /g/{short_id}?partial=card`（Gallery一覧と
同じ`GenerationCard`フラグメント）を取得し、反映待ちに積みます。

判定（[Safety](api.md#safety)）は新着の通知より数秒遅れて保存されるため、`safety`メッセージを受けると
該当short_idのカードを取得し直し、反映待ちのカードはそのHTMLを、グリッド上のカードはカードごと
差し替えて、センシティブなどのバッジをリロードなしで出します。カードの初回取得の最中に届いた
`safety`は、その取得が終わった直後に1回だけ取得し直します。

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
薄くしたbadのカードを取り除きます。「途中を隠す」では、挿入した新着の仕上げ元のカードも取り除きます。新着を挿入したときは最上部へスクロールします
（telemetry `gallery.pending_apply`）。新着が属する枠の見出しがなければ作り、`at=`で開いた一覧でも
同じようにグリッド先頭へ入れます。タイムラインの枚数は反映の直後に取得し直します（枠のスケルトンの
数はそのままで、本物のカードが増減ぶんを埋めます）。

ソケットが切れたときの再接続は同じ接続を使う[Generation Detail](#generation-detail)の
request live更新と同じ指数バックオフ（1s→2s→…上限30s）です。

### GenerationCard

Generation のサムネイルはどのページも`GenerationCard`（`src/ui/components/GenerationCard.tsx`）で出します。ギャラリー・ブックマーク・
Compare の列・実験のマトリクスと Run・[絵柄チェック](#絵柄チェック)の pin と結果・[`/work`](#work)・ワークベンチの候補の帯が使い、
どこでも short_id のコピー・bookmark・rating をその場で操作できます。rating / bookmark / コピーは class と data 属性を拾う
ページ共通の委譲ハンドラが動かすので、カードごとの JS はありません。bookmark を切り替えると同じ Generation の bookmark ボタンを
すべて揃え、`chimera:bookmark` を投げます（rating の`chimera:rating`と同じ）。

-   `compact`: 帯や行に並べる小さい版。行の文字とボタンを詰め、`✎` / `↻` は省きます。幅は置く側が決めます。
-   `href`: サムネイルの行き先。既定は`/g/{short_id}`、`/work`では`/work/{short_id}`です。
-   子要素: カードの下端に足す行（`card-extra`）。絵柄チェックの seed、`/work`の状態と recipe に使います。
-   JS で組むカード（ワークベンチの帯・絵柄チェックの結果）は、ページに置いた`<template data-generation-card-template>`
    （`GenerationCardTemplate`）を`buildGenerationCard`が複製して値を埋めます。マークアップの正は JSX の`GenerationCard`だけです。

サムネイルは`/g/{short_id}/preview`で、cutoutを持つGenerationではその切り抜きから作った透明のWebPです
（[architecture.md](architecture.md)「R2」）。サムネイルの背景は常に市松なので、透明部分はそのまま透けて見えます。
ギャラリー、タイムライン、ブックマーク、Compare、ワークベンチのミニサムネイルが同じ`/preview`を使うため、どこでも切り抜きが見えます。

カードはサムネイル1枚と、その下の2行（short_idとbookmarkの行、rating（bad/neutral/good）の行）です。
short_idは等幅の文字そのものがボタンで、クリックするとクリップボードへコピーし、0.9秒間`--good`色に
変えて末尾に✓を出します。サムネイルは[Generation Detail](#generation-detail)への素のリンク
`<a href="/g/{short_id}">`です。サムネイル左上には
（上から順に、両方あれば縦に積みます）、このGenerationがredraw/deliver/repair/
masked_redrawで書き換えた元のraw Generationがあるとき`元 <short_id>`バッジ（`#402e21`地に
橙文字、short_idは等幅）。バッジはクリックで元のshort_idをコピーし（遷移しない）、コピー後は
short_idのボタンと同じく0.9秒間`--good`色に変えて✓を出します。サムネイルのリンク内なので
`<button>`ではなく`role="button"`・`tabindex="0"`の`<span>`で、Enter / Spaceでも動きます。
このGenerationを対象にした最新のredraw/deliver/repair/masked_redraw（と古いfinalize）
request（JSONのフィールド名は`refinement_request`）があるとき進捗ピル（後述）を、左下には[Publication](domain-model.md#publication)が
1件以上あるとき送信アイコン付きの`公開済み`ピルを、このGenerationがpose の基準 render として
pin されているとき`基準 <pose名>`ピル（[domain-model.md](domain-model.md#基準-render-の-pin)）を、両方
あれば横並びで重ねます。幅600px以下ではbookmarkをサムネイル
右上の2.75rem角のタップ領域へ移し、ratingの3ボタンは行いっぱいに広がります（各2.75rem以上）。
short_idのボタンも高さ2.75rem以上にします。仕上げ元の無い（raw の）カードには、short_idの行のbookmarkの隣に
小さな`↻`リンク（`/reroll/{short_id}`、[リロール](#リロール)）を置きます（幅600px以下でもタップ領域は2.75rem角）。`card-row`の高さは固定（short_idの行とratingの行を各
1.5rem、幅600px以下は各2.75rem。パディング・gapを含む）で、バッジなどで変わりません。
読み込み前のスケルトンと同じ外寸にするためです（[Gallery timeline](#gallery-timeline)）。

進捗ピル（`rgba(18,18,20,0.86)`地・`--border`の1px枠・角丸999px、テキストはstatusごとに
色分け）はkind（`描き直し`/`納品`/`repair`/`masked redraw`、古い行は`finalize`）とstatusから組み立てます。

``` text
納品 · queued                          ← --accent
repair · running 3/10                  ← --neutral（step/totalはprogressメッセージが届いてから）
masked redraw · done → xyz789          ← --good、xyz789は等幅
描き直し · failed                      ← --bad
```

`[data-request-id]`要素なので、[Generation Detail](#generation-detail)のrequest live更新が
受ける同じ`progress`/`status`メッセージでその場更新されます（runningの`progress`は
`step`/`total`が分かっている間だけ`kind · running step/total`に、doneになった時点で結果の
short_idを取得して`kind · done → <short_id>`に差し替えます）。

カード表示例:

``` text
[ IMAGE ]
 元 abc123            ← rawを書き換えた出力のときだけ
 納品 · queued        ← redraw/deliver/repair/masked_redraw requestがあるときだけ
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
採点済みのカードの下には安全性の1行を置きます。4区分の小さな積み上げ帯・`少し際どい`の%・先頭のカラムからの増減（pt。
下がれば緑、上がれば赤、先頭のカラムと基準が未採点のカラムは`—`）を並べます。判定のピルはカード側に出ます。

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
-   `比較 (N)`: `/compare?ids=...`（先頭9件のshort_id）へのリンク（telemetry `compare.open`）

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

見出しのshort_idとコピーボタンの隣には、このGenerationがredraw / deliver / repair /
masked_redrawで書き換えた元のraw Generationがあるとき、小さな`--text-dim`色の
`元 <short_id>`（short_idは`/g/{short_id}`へのリンク）とそのコピーボタンを添えます。
rawのGenerationには出しません（`GET /api/v1/generations/{id}`の`refines_generation`）。

cutout asset（描き直しの`cut: true`が付ける透明の切り抜き）を持つGenerationは、主画像に原寸の
`GET /g/{short_id}/assets/cutout`を市松の上に出し、画像meta欄の上に`切り抜き表示 · 元画像（緑背景）`の1行を添えます
（`元画像`は`/g/{short_id}/image`へのリンク。originalがpurge済みなら出しません）。

originalがpurge済み（[domain-model.md](domain-model.md#original-の保持)）の
Generationは、画像に`GET /g/{short_id}/preview`（1024pxのpreview）を表示し、画像meta欄の下に
`原寸は破棄済み（preview のみ）`と添えます。

Generation Detailには生成要求を積む編集欄（描き直し・Repair・納品・ボケ）はありません。編集は
[ワークベンチ](#workbench)で行い、画像の下に主ボタンの`ワークベンチで開く`（`/work/{short_id}`）を置きます。
`ワークベンチで開く`の右に副ボタン`リロール`（`/reroll/{short_id}`）を置きます。仕上げ済みの Generation か、recipe を持つ generate から作られた
Generation にだけ出ます（import など振り直せない元絵には出しません）。
人物レイヤー（`layer-figure` と `layer-outline`）を持つ Generation には、同じ並びに副ボタン`枠に入れる`（`/frame/{short_id}`、[枠](#枠)）も出ます。
評価・ブックマーク、タグ、メモ、公開、基準にする、比較に追加、Requestsの一覧と`profile に登録`、安全性、系譜、解決値、
親 / 子 / 兄弟のカードは従来どおりです。

情報セクションは折りたたみ可能（`<details>`）ですが、既定ですべて展開して
表示します（展開クリックを不要にするため）。生JSON（Semantic の Raw JSON、
Workflow の Raw graph）と、末尾のRequestsだけ既定で畳みます。

``` text
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
Requests
```

ページの`<title>`は`<short_id> · 詳細`です。この画面はワークベンチとリロールの見出しでは`詳細`と呼びます。

rating/bookmark行の直後は「基準」行です。このGenerationがposeの基準 renderとしてpinされていれば
`基準 <pose名>`ピルを、されていなければ`基準にする`ボタンを表示します。ボタンは
`POST /api/v1/generations/{id}/pose-reference`（[api.md](api.md#pose-reference-pin)）でpinし、
その場で行をピルに書き換えます。recipe / poseはサーバーがGenerationの属するRequestから推測し、rating goodでない
Generationなどは拒否されます（[domain-model.md](domain-model.md#基準-render-の-pin)）。

rating/bookmark行・基準行の下に`安全性`セクションを置きます（[Safety](api.md#safety)）。折りたたまず常に表示し、
上から次の順に並べます。未採点は`未採点`のみです。

- 見出し行: `安全性`と、判定が`none`でなければ`出さない`（赤塗り）・`センシティブ`（赤）・`注意`（黄）のピル、`none`なら`問題なし`。
  `block`のときは露出タグと`15%`の閾値を示す理由の1行をこの下に出します。
- 判定の理由の1行（`none`以外）。`block`は露出タグと`15%`、`sensitive`は`かなり際どい`の値や乳・股間のタグ（`15%`以上／`35%`以上）、
  `caution`は尻・下着のタグ（`50%`以上）を値の大きい順に並べ、閾値を添えます。
- 4区分（全年齢・少し際どい・かなり際どい・成人向け）の2×2セル。各セルは区分名と大きな%を持ち、背景を値の幅だけ左から区分の色
  （緑・黄・赤・濃赤）で薄く塗ります。`かなり際どい`のセルだけ`15%`の位置に縦線の目盛りを置き、%の後ろに`/ 15%`を添えます。
  値が`15%`以上のとき、そのセルの枠と数字が赤になります。
- 効いていそうなタグ（見出しは付けません）: `TAG_X_RISK`のタグのうち保存されているものを、露出・乳股間・尻下着・X で効きにくいの順、同じ区分内は確率順に最大8件。
  枠は露出と乳・股間が濃赤、尻・下着が赤、X で効きにくいタグ（タイツ・脚・足・座り方など）は灰で文字も薄くします。
  50%以上のタグは太字にします。区分は X での見え方の経験則です。

%は小数1桁で、0.1%未満は`0%`です。同じピルをGalleryなどのサムネイル左下（`公開済み`の隣）にも出します。
採点済みのカードはサムネイル下端に4区分の3px帯を重ね、判定が`none`のカードにはホバー時だけ`際 93.1%`（`少し際どい`の値）を右下に出します
（`hover: none`の端末では常時表示）。Galleryの新着カードは
判定の保存後に`safety`メッセージで差し替わり、ピルと帯がリロードなしで現れます（[新着](#新着)）。判定が`block`のGenerationで
`公開を記録`を押すと確認ダイアログを出し、`sensitive`では記録後にXのセンシティブ設定を付ける注意を出します。

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
だけ出します。workerが解決した値（resolved）を1項目1行の表にし（`dof`はF値・ピント位置・ボケの範囲・
ファインダーの行に分け、`stroke_light`・`light`・`backdrop`はDeliverフォームと同じ語で、redrawの`method`・`scene`・`from`・`keep_regions`も表示（古いcanvas / lightの行を含む）。古いfinalizeの行もそのまま読めます）、
要求した`options`（requested）とresolvedの生JSONは既定で畳んだ`Raw JSON`に入れます。

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

#### フチのリスト

ワークベンチの納品フェーズの編集欄（`OutlineEditor`）です。内側から外側の順に、1本ごとに色（`input[type=color]`）・幅
（0.2〜`deliver.outlines.max_width`、刻み0.02、長辺に対する%）・内側へ / 外側へ / 消すのアイコンボタンを持つ行を並べます。`+ 外側に足す`
（`deliver.outlines.max_count`、無ければ6本まで）と、catalogの`deliver.outlines.default`（無ければ白0.4% + 紫1.04%）に戻す`白・紫に戻す`があります。
フチが1本以上あるときだけ`一番外の陰影`として`均一`（`even`）と`光の向きで陰影`（8方向のコンパス、向きが`stroke_light`）を出します。初期値は
catalogの`deliver.defaults.stroke_light`（`even`か向きのときだけ。それ以外は`even`）です。

#### Requests

このGenerationを対象にした最新のrequest（すべての種類）を最大5件、新しい順に`<kind> status · created_at`の行として出します。
kindは`描き直し` / `納品` / `ボケ` / `repair` / `masked redraw`（古い行は`finalize`）で、`done`なら結果Generationへのリンク、
`failed`ならその`error`、worker が書いた`resolved_options`があればその要約を添えます。

各行は`data-request-id` / `data-request-status`を持ち、`/api/v1/requests/ws`
（段階3 WorkerHub、[worker-protocol.md](worker-protocol.md#段階-3-workerhub)参照）に
繋いだライブ接続が接続直後の`snapshot`と以後の`progress` / `status`を受けて、行内の
`.request-progress`に`phase step/total`（stepが無ければ`phase`のみ）を、`status`変化時は
行のクラスと表示statusを書き換えます。`done` / `failed`への遷移時は該当requestと
（`done`なら）結果Generationを取得し直し、ページ読み込み時と同じ結果リンク / errorをその場に
追加します。ページ読み込み後に新しく現れた行（送信直後の挿入）も
現れた時点でこの接続に登録され、まだ張っていなければソケットを開きます。WebSocketが張れない
環境でも静的な表示のまま壊れません（未対応・切断時は1秒→30秒のバックオフで再接続を試み続けます）。

このGenerationが`rating = good`で、かつdeliver requestが産んだものであるときだけ、一覧の上に
`profile に登録`フォーム（名前入力＋ボタン）を表示します。送信すると
`POST /api/v1/presets/promote-profile`を呼び、その場に`registered: <name>
v<version>`を表示します（リロードなし）。それ以外のGenerationにはこのフォームは出ません。

## Workbench

元絵（raw Generation）から、描き直し・切り抜き・フチ・彩度・背景・光・ボケの6フェーズを1つずつ積み、各フェーズで候補を作って比べ、採用かスキップをする画面です。
選んだ結果は`/api/v1/workbenches/{rootId}`に保存されます（[api.md](api.md#workbench)）。

### `/work`

手を入れた元絵（`refines_generation_id`が無い Generation のうち、仕上げ先の Generation を持つか、保存済みの`workbenches`行がある物）を
最終更新の新しい順（子孫の最新`created_at`と`workbenches.updated_at`の遅い方）に24枚ずつ並べる再開画面です。未着手の Generation は出ません。
カードは[GenerationCard](#generationcard)で、下端の行に状態と recipe を出します。`しかかり`は納品済みの子孫がまだ無いもの、`完成`は子孫に納品済み（`isDeliveredRequest`と同じ判定: deliver / dof / lens / finalize、
または deliver / hires-chain / deliver_only の repair）があるものです。状態（`すべて` / `しかかり` / `完成`、`?state=wip|done`）とrecipeの
絞り込みピルがあり、ページは`?page=`の前へ / 次へで送ります。カードのサムネイルをクリックすると`/work/{short_id}`へ進みます。
新しく始めるときはギャラリーか`/g/{id}`の`ワークベンチで開く`から入る旨を冒頭に書いています。空のときは「作業中の絵がありません」を出します。

### `/work/{short_id}`

元絵でない Generation を渡すと、元絵の`/work/<root short_id>?at=<渡したshort_id>`へ302で転送します。`?at=`はその Generation のフェーズと候補を
開いた時点で選んだ状態にします（保存済みの採用とつながらない系譜なら、その Generation の入力を一時的な入力にします）。

-   ヘッダー: `元絵を選び直す`（`/work`へ）と、`元絵 › 1. 描き直し › 2. フチ › 3. 彩度 › 4. 背景 › 5. 光 › 6. ボケ`のステッパー。各段は1行で、全段が同じ固定幅（ラベルが
    あふれたら省略記号）です。現在の段を塗りで示し、未採用の段は破線の枠にします。到達済みの段だけ押せます。
-   主領域: `入力`（前フェーズの採用、スキップなら更に前の入力。1 では元絵）と`候補`（選択中の候補）を大きく2枚並べるか、`同じフェーズを全部並べる`で入力と
    このフェーズの全候補を格子に並べます。画像は`/g/{short_id}/image`（原寸が破棄済みなら`/preview`）を`object-fit: contain`で出し、
    十字線・矩形・ピントのマーカーは描画された画像の箱（余白を除く）に対する正規化座標で、見えているすべての画像に同期して出ます。
    `ルーペ`は十字線の位置を中心に、見えているすべての画像へ同期して拡大した窓（正方形、一辺280px、小さい画像では短い辺の半分まで縮む）を出します。
    倍率は`×2` `×3` `×5` `×8`（初期値は`×3`）で、描画された画像の箱に対する倍率なので解像度の違う画像でも同じ範囲が映ります。
    初期状態はオンで、`z`で切り替え、`[` / `]`で倍率を下げる / 上げます（入力欄にフォーカスがある間は効きません）。オンオフと倍率はブラウザに保存されます。
    `入力`と`候補`の見出し、および全部並べたときの各タイルの見出しに、画像の寸法とサイズを`1536×1536 · 2.9 MB`の形で添えます（Generation Detailの画像meta欄と同じ書式。
    サイズが未記録の画像と処理中の候補には出しません）。
    候補のサムネイル帯（compact の[GenerationCard](#generationcard)。サムネイルを押すと候補を選び、rating / bookmark はその場で付けられます。採用の点・処理中の`…`を重ねます）、比べ方の切り替え、`スキップ`、`次へ`（6では`完成`）、
    採用が6まで済んだときの`完成しました。`の文言。入力欄と候補欄の見出しにはそれぞれ、その絵の short_id（押すとコピー）、詳細（`/g/<short_id>`）へのリンク`詳細`、`bad` / `neutral` / `good`、🔖が並びます。
    現在の評価を押すと外し（`PUT /api/v1/generations/{id}/rating`）、🔖はブックマークを足し外しします（`PUT` / `DELETE /api/v1/generations/{id}/bookmark`）。
-   候補: フェーズ k の候補は、フェーズが k で`refines_generation_id`がフェーズ k の入力であるツリーのノード（`GET /api/v1/generations/{root}/tree`）と、
    入力を指す処理中の request（`pending`）です。1 だけは重ねられるので（hires の上に light）、入力からフェーズ 1 のノードだけをたどって届くノードも候補です。作れなくなった古い repair / masked_redraw の出力は、フェーズ 1 の候補として扱います。採用・スキップは`PUT /api/v1/workbenches/{root}`に`picks`全体を送り、候補の系譜から決まる
    それ以前の採用（間は`skip`）に置き換えるので、前の採用を変えると後ろの採用は消えます。
-   右の欄（最大380px）は現在のフェーズのフォームだけを出します。比較の2枚と右の欄は画面の下端で終わるよう高さを測って合わせ、ページ自体はスクロールしません。
    右の欄の高さはフェーズによらず一定で、フォームは欄の中で独立してスクロールし、実行ボタン（右寄せ）とエラー表示は欄の下端に固定されるので、
    実行ボタンの位置は全フェーズで同じです
    （幅900px以下の縦積みでは、スクロール位置に関係なく画面の下端に固定されます）。
    1 描き直し: `hires` だけ。長辺（2048 / 2560 / 3072、既定 2048）と denoise を選びます。
    既定で `cut: true` を送り、候補は切り抜かれた（透明の）絵として市松の上に出ます。`切り抜かない`にチェックを入れると `cut` を送らず、不透明の絵のままです。
    2 フチ: 透過の deliver（`transparent: true`）だけを積みます（描き直しで切り抜き済みの入力は切り抜き直さず、フチの候補だけが増えます。切り抜き済みでない入力は、この 2 で初めて切り抜きます）。開いた`フチ`（見出しの右に現在のフチを`白 0.8 + 紫 3`のように色の名前（白・紫以外は色コード）と幅で要約し、
    向きの陰影のときは`· 陰影 nw`を添える。[フチのリスト](#フチのリスト)を編集すると即座に更新。既定はcatalogのフチ）、切り抜きの注記。
    入力が納品済みなら実行できません。
    3 彩度（`saturation`）: `強さ`（0〜1、刻み 0.05、初期値は catalog の最上位 `saturation.strength`、無ければ 1）のスライダー 1 本で、キャラとフチ（フチの色も）の彩度を圧縮します。
    入力は deliver の出力か、切り抜き済みの描き直しの出力（`cut: true`）です。それ以外（切り抜かれていない絵）のときは`切り抜かれていません`と`フチなしで切り抜く`を出し、
    押すと`{transparent: true, outlines: []}`の deliver を入力に積んで 2 の候補に移ります（候補を採用してから 3 に戻る。元の request は自動では積まない）。
    2 フチも 3 彩度も飛ばしてよく、飛ばすと次の入力は直前の採用のままです。
    4 背景（`stage`）: `柄・単色` / `写真`。柄はcatalogの柄（既定は`ランダム`で、実行のたびに1つを選んで送る）か`単色`（#RRGGBB）と、枠の`枠あり`（既定）/ `枠なし`、影の`影あり`（既定）/ `影なし`。
    `枠あり`は`frame`に既定の箱（納品キャンバスの中央に幅・高さとも 90%、`[0.05, 0.05, 0.95, 0.95]`）と 4 辺とも`out`だけを入れて送り、線・縁・紙・余白は worker の既定（catalog の`stage.frame`）に任せます。
    箱の大きさは client の`WB_FRAME_BOX`の 1 か所で決めます。
    影の向きは選ばせず、2 の`一番外の陰影`と同じ向き（`均一`ならシーンの光の向き、どちらも無ければ影は付かない）を`shadow_from`に入れ、
    欄にその向きを出します（入力の納品が`stroke_light`を持たないときは送らず worker に任せる。`影なし`は`shadow_from: null`）。
    柄のパネルの`枠に入れる…`は、4 の入力（選んだ候補）の`/frame/<short_id>`へのリンクです（[枠](#枠)）。入力が枠つきの stage の出力ならその状態を復元して開きます。
    入力の系譜に light の描き直し（または light 付きの納品）があれば、
    `シーンの色を背景と影に付ける: 月明かり（from ne、1 の light から）`のチェック（既定でオン。worker が引き継ぐ。外すと`light: null`）を出します。写真は登録済みの写真（[写真](#写真photos)の一覧と同じ、新しい順に最大60件）から選ぶか、
    `写真を足す`で写真ページと同じ手順で登録してその場で選びます。選ぶと`入力`欄が写真になり、クリックした点に台座（板の下辺の中央。写真の下の余白まで、y 1.5 まで置ける）を置き、
    `高さ`（0.05〜1.5）のスライダーと合わせて、切り抜きの絵の見えている範囲を写真の上に重ねて見せます（ぼかしは無し）。入力が deliver / saturation の出力か切り抜き済みの描き直しの出力でなければ実行できません（3 と同じ`フチなしで切り抜く`を出す）。切り抜き済みの描き直しを入力にした stage の影は、`shadow_from`を明示したときだけ付きます。2 フチを飛ばしても 4 に進めます。
    5 光（`lighting`）: `強さ`（0〜1、既定 0.7）、`シーン`（`なし`が既定 / `夕日` / `月明かり`。選ぶとキャラをその光で照らし、柄の背景もその色に染める。
    写真の背景はそのまま）と光の向き（`向きなし`が既定、コンパス。シーンだけ選んだときは nw）。入力は stage の出力のほか、背景の無い絵（透過の deliver・saturation の出力、切り抜き済みの描き直しの出力）も取れます。
    背景の無い入力では、向きかシーンのどちらかを選ぶまで実行できません（実行ボタンに`背景が無いので、向きかシーンを選んでください`と出る）。
    切り抜かれていない絵が入力のときは、3 と同じ`フチなしで切り抜く`を出します。
    6 ボケ: [Dof](#dof)と同じ操作（ピントは入力の絵のクリック）。ピントを置くと、入力の絵にピントが合う範囲の目安の円（半径 = catalogの`dof.guide_radius_per_f` × F × 長辺。係数が無ければ出さない）を重ね、F を動かすと追従します。
    入力が写真に置いた絵（その stage を lighting が挟んでも）なら、`ボカす範囲`の代わりに`板を傾ける`（tilt）・`手前に寄せる`（nearer）・`玉ボケ`（bokeh）のスライダーを出します。
    入力が deliver / saturation / stage / lighting の出力か切り抜き済みの描き直しの出力でなければ実行できません（3 と同じ`フチなしで切り抜く`を出す）。
-   実行すると`POST /api/v1/requests`（`created_by: "gui"`、`idempotency_key`は`gui:workbench:<kind>:<入力のshort_id>:<uuid>`）を積み、
    候補が処理中としてすぐ増えます。進み具合は`/api/v1/requests/ws`の`status` / `progress`で受け、終わったらツリーを取り直して新しい候補を選びます
    （処理中がある間は4秒ごとにも取り直します）。
-   幅900px以下では右の欄が主領域の下に積まれ、600px以下では`入力`と`候補`の2枚も縦に並びます。

## リロール

元絵の生成条件をそのままに、seed だけ変えて4枚振り直して見比べる画面です。prompt も recipe も触らないので semantic 判断を伴わず、GUI から積めます。
同じ元絵を何度でも振り直せて（1回ぶんが「1回目」「2回目」…の回）、結果は`requests.reroll_of_generation_id`で元絵に結び付いて残ります（[api.md](api.md#reroll)）。

### `/reroll/{short_id}`

元絵でない Generation を渡すと、元絵の`/reroll/<root short_id>`へ302で転送します。不明な ID は404です。

-   ヘッダー: `詳細へ戻る`（`/g/<short_id>`へ）、`リロール <short_id>`、元絵の recipe 名。
-   主領域: 左に元絵（固定、縦2段ぶんの高さ）、右に1つの回の候補4枚（2列×2段。最新の回が既定）。画像は[ワークベンチ](#workbench)と同じ比較ペイン（`wbViewer`）で、
    十字線とルーペ（`ルーペ`のオンオフと`×2` `×3` `×5` `×8`、`z` / `[` / `]`）は元絵と4枚のすべてに同期して出ます。盤全体の高さは画面の下端で終わるよう
    測って合わせ、幅900px以下ではページ自体のスクロールで、元絵を全幅、候補を2列で縦に積みます。
-   見出し: 元絵と各候補に、寸法とサイズ（`1536×1536 · 2.9 MB`）を添えます。操作の箱はワークベンチの`入力` / `候補`の見出しと共通の部品（`CapActions`）で、
    short_id（押すとコピー）、`詳細`（`/g/<short_id>`）、`bad` / `neutral` / `good`、🔖に加えて`ワークベンチへ`（`/work/<short_id>`）を出します。
-   回のタブ: 盤の上に`1 回目` `2 回目`…をワークベンチのピルと同じ見た目で並べ、表示中の回を強調します。完了していない回には`待機中` / `処理中` / `失敗` / `中止`を添えます。
    選んだ回は URL の`?round=N`（`history.replaceState`）に反映し、無ければ最新の回を開きます。まだ回が無いときはタブ行を出しません。
-   リロール前: 候補は`未実行`の空きタイル4つで、主ボタン`4 枚振る`を出します。押すと`POST /api/v1/generations/{id}/reroll`を呼び、
    タイルが`待機中…` / `処理中…`（進み具合は`/api/v1/requests/ws`の`progress`）になり、終わった順に画像に変わります。
    処理中は3秒ごとに`GET /api/v1/generations/{id}/reroll`でも取り直します。失敗したときはボタンの横にエラーを出します。
-   リロール後: ボタンは`もう 4 枚振る`になり、押すと新しい回を積んでその回のタブへ切り替えます。直近の回が`queued` / `running`の間だけ、ボタンは`処理中…`で押せません。
    失敗した回のタイルには失敗の理由を出します。
-   recipe を持つ generate から作られていない元絵では、ボタンの代わりに振り直せない旨を出します。

## 枠

納品の絵のキャラとフチを背景の箱に入れ、頭などを枠の外へはみ出させる stage（`frame`、[worker-protocol.md](worker-protocol.md#stage)）を、プレビューを見ながら組む画面です。
GUI が決めるのは箱の位置・辺・ブラシの幾何だけで、prompt は書きません。送るのは`POST /api/v1/requests`の stage 1 件（`created_by: "gui"`、
`idempotency_key`は`gui:frame:<base のshort_id>:<uuid>`）だけです。

### `/frame/{short_id}`

-   対象: `layer-figure` と`layer-outline`の asset を持つ Generation（ふつうは透過納品）。枠つきの stage の出力を渡すと、その入力の絵を対象にし、
    stage request の`backdrop` / `shadow_from` / `frame`を初期状態に復元します。層が無い絵は、人物レイヤーが無いので枠に入れられない旨の画面を 404 で返します。不明な ID も 404 です。
-   ヘッダー: `枠 <short_id>`、`ワークベンチ <base>`（`/work/<base>`）、`詳細 <short_id>`（`/g/<short_id>`）。
-   プレビュー: 1 枚の canvas に worker と同じ順（紙、背景、縁と線、フチ、キャラ）で合成します。背景は catalog の柄のサムネイルを、箱の長辺に合わせた倍率で箱の左上から敷き詰めた近似です
    （柄は箱の長辺で正規化した座標で描かれるため。中心を持つ柄はずれます）。単色は塗りつぶしです。
    出力範囲の外は暗くハッチをかけ、範囲の辺は、自動なら破線、固定した辺なら実線で描きます。表示範囲は元絵・箱・出力範囲の和に余白を足したもので、ドラッグを離したときだけ取り直します。
    作業用のコピーは長辺 1280px に縮め、座標は分数のまま持つので、解像度に依存しません。
-   ツール: `枠`（箱の中をドラッグで移動、8 つのハンドルでリサイズ。最小 0.02、-1〜2 に収める）、`消す` / `戻す`（ブラシ。幅は 0.2〜20 %、既定 2。カーソルに円を出す）、
    `範囲`（出力範囲の辺と角のハンドルをドラッグ。余白なしの辺は動かず、動かした辺だけを固定する）。ブラシの軌跡は分数の点列（小数 4 桁、約 0.5px 未満の点は省く）で持ちます。
-   `取り消し` / `やり直し`（Ctrl / Cmd + Z、Shift 付きでやり直し）は箱・辺・色・範囲・ブラシの状態全体を戻します。`ブラシを全部消す`でストロークだけを空にします。
-   辺: 上・右・下・左ごとに`切る` / `上に出す` / `枠の下を通す`（`cut` / `out` / `behind`。既定は上が`上に出す`、ほかは`切る`）。背景は catalog の柄か単色。線は色と太さ（0〜5 %、0 は`line: null`）、縁は色と太さ（0〜5 %、0 は`rim: null`）、紙の色。
    辺・線・縁・紙の初期値は catalog の`stage.frame`から取ります（無ければ線 #4a3152 / 0.6 / 実線、縁 #2e2236 / 0.25、紙 #ffffff）。
    線の柄は`実線` / `斜線`（`line.pattern`）で、`斜線`に切り替えたとき線の太さが 1.2 未満なら 1.2 に上げます。プレビューの斜線は出力キャンバスの左上を原点に描きます。
    影は`影なし`（`shadow_from: null`、既定）/ `影あり`（`shadow_from`を省略し、納品の影の向きを継ぐ）。プレビューは影を描かないので、既定を`影なし`にして仕上がりと揃えます。
    枠つき stage の出力から開いたときは、`shadow_from`の省略を`影あり`として復元します。
-   出力範囲: 上・右・下・左ごとに`余白あり` / `余白なし`（`expand`の辺ごとの値。既定は catalog の`stage.frame.expand`）。`余白なし`の辺は自動の範囲を元画像の端までに収め、
    固定も外します。`余白あり`の辺は`範囲`ツールで固定でき、固定した辺には`自動に戻す`を出します。自動の範囲はプレビューも worker と同じく辺ごとに収め、
    固定した辺だけを置き換えます。辺が向かいの辺を越えたときは送れません。
-   初期の箱: 元絵のキャラの bbox から、上 3 割ほどが箱の外に出る位置に置きます。
-   ストロークは 200 本、点は 20000 までで、超えると数を赤くして送れなくなります。
-   `この枠で stage する`: `frame`は箱・4 辺・線・縁・紙・辺ごとの`expand`・4 辺の`canvas`（自動の辺は null）を必ず明示し、ストロークは空でないときだけ送ります。送れたら`ワークベンチで見る`（`/work/<base>?at=<base>`）を出し、
    内容が変わるまで再送できません。失敗したときはサーバーのメッセージを出します。

## 絵柄チェック

`/check`。recipeの全ポーズについて、pinが今のカタログからずれていないかを一覧で確かめ、ずれたポーズのpinを直すページです。
対象recipeは`src/lib/style-check.ts`の`STYLE_CHECK_RECIPE`で、現在は`yukari`だけです。

ポーズの一覧は、公開済みカタログのposeと、Presetにだけ存在するpose（昇格したpose、`src/lib/plain-render.ts`）の和集合を名前順に並べたものです。
pinが無いポーズも並び、`pin なし`と出します。1ポーズが1行で、行は次を持ちます。

-   ポーズ名とドリフト状態。
-   pin: 現在のpin（`preset_references`、`getCurrentReference` / `referenceView`）を compact の[GenerationCard](#generationcard)で出し、下端に seed を足します。
-   最新の描き直し結果。今の描画内容でのidempotency key
    (`style-check:<recipe>:<pose>:<sha256>`、`src/lib/style-check.ts`の
    `styleCheckIdempotencyKey`)に一致するrequestを探すだけで(積まない)、無ければ`未描画`と出します。
    ハッシュの入力は、pinのseed、poseのPreset（版と本文）、
    カタログ上のposeレコードの`positive` / `negative` / `canvas`、recipeの`model`です。パラメータ語彙やposeの`parts`などは入れません。
    git commit・generated_at・patches・backdropsは入れないので、docsや納品の既定だけの
    変更・worker再起動ではkeyが変わらず、結果は空になりません。結果があれば pin と同じカード（seed 付き）を出します。
-   `今のコードで描き直す`: そのポーズだけを描き直します。pinが無いときは押せません。
-   `good にして基準にする`: 結果が出ているときだけ押せます（pinと同じ絵のときは押せません）。確認ダイアログのあと、
    その結果のratingを`good`にし（`PUT /api/v1/generations/{id}/rating`）、続けてpinを差し替え
    （`POST /api/v1/generations/{id}/pose-reference`）、ページを読み込み直します。結果は同じseedで描かれているので、差し替えてもkeyは変わりません。
-   `/compare で開く`リンク（`/compare?ids=<pinのshort_id>,<結果のshort_id>`）。結果があるときだけ出します。

`/check?sweep=<experimentのshort_id>`は、右側を「最新の描き直し」から「そのpose sweep（MCP `sweep_patch`、[experiment-agent.md](experiment-agent.md#sweep_patch)）の結果」に替えます。
sweepのRunが無いposeは`対象外`と出し、sweepのRunが生成中の間は同じ3秒ごとの取り直しで埋まります。
ページ上部にsweepの名前、patches（読み取り専用の折りたたみ）、実験ページへのリンクを出します。
sweepの結果はplain renderではないので、`pin 済みを全部描き直す`、`今のコードで描き直す`、`good にして基準にする`は出しません（`set_pose_reference`が拒否する絵のため）。
`?pose=`は`?sweep=`と併用できます。`?sweep=`がsweepでないExperimentを指すときは404です。GUIがsweepを作ることはなく、patchesはMCPから作られたものを表示するだけです。

#### 比較ビューア

行（サムネイルを含む）を押すと、画面いっぱいの比較ビューアが開きます。[ワークベンチ](#workbench)と同じ比較ペイン（2枚並び・十字線・ルーペ）で、
左にpin、右にそのポーズの最新の描き直し結果を大きく出します。結果がまだ無いときは右に`未描画` / `待機中…` / `処理中…`などを出し、pinだけを見られます。

-   見出し: ポーズ名、ドリフト状態、左右の画像のshort_idとseed・画像meta。結果があるときは右に`bad` / `neutral` / `good`の評価ボタン。
-   `今のコードで描き直す` / `good にして基準にする` / `/compare で開く`は一覧の行と同じ動作です。実行中のrequestは3秒ごとに取り直し、ビューアにも反映します。
-   `?pose=<pose>`に開いているポーズを載せます。このURLを開くと、そのポーズのビューアが開いた状態で始まります。一覧にないポーズ名は無視して一覧だけを出します。
    開くとき履歴に1つ積むので、ブラウザの戻るで一覧に戻れます。ポーズを切り替えても履歴は積みません。
-   キー: `Esc`で閉じる。`←` / `k`で一覧の前のポーズ、`→` / `j`で次のポーズ。`z`でルーペの切り替え、`[` `]`で倍率（ワークベンチと同じ）。

#### ドリフト状態

描画せずに判定します。比較するのは、pinのGeneration（`resolveDerivationSource`で遡った、仕上げ元のないGeneration）のRequestが持つ
`pose_fingerprint`と、カタログのposeレコードの`fingerprint`（`sha256:<hex>`、chagamaが公開する。[domain-model.md](domain-model.md#基準-render-の-pin)の
`requests.pose_fingerprint`と同じ値）です。

``` text
一致       2つが等しい
ドリフト   2つが異なる
判定不可   カタログのposeにfingerprintが無い / pinのRequestにfingerprintが無い / poseがカタログに無い（Presetだけのpose）
pin なし   pinが無い
```

ドリフトの行には、pinを描いた実際のprompt（pinのGenerationを描いたJobのrender_factsのpositive / negative。`renderFactsForJob`）と、カタログのposeの
`positive` / `negative`との差（`diffFactSummaries`、トークン単位の`promptDelta`）を折りたたみで出します。全文も開けます。
カタログのposeがその文字列を持たないキーは比べません。

ページ上部の`pin 済みを全部描き直す`ボタンと各行の`今のコードで描き直す`ボタンが`POST /api/v1/style-check/{recipe}`
（[api.md](api.md#絵柄チェック)）を呼びます。pinを持つポーズごとに、MCP
`plain_render`と同じ組み立て（`buildPlainRenderRequest` → `createRequest`、`created_by =
gui`）でrequestを積みます。pinが無いポーズはskipされ、応答にその旨が残ります。idempotency
keyが上と同じなので、描画内容が同じ間の連打は積み直さず既存行を返します
（`created: false`）。

recipe_refが`REQUESTS_DEFAULT_RECIPE_REF`（既定`production`）のカタログを
`PUT /api/v1/catalogs/{recipe_ref}`で公開した直後にも、pin済みの全ポーズについて同じ描画をバックグラウンドで自動で
積みます。描画内容が変わったposeだけがcreatedになり、commitだけの変更や同じカタログの
再公開は何も積みません。失敗してもPUTは失敗しません。

queued / runningのrequestがある間は、ページが3秒ごとにrequestを取り直し、doneになればその行の結果を差し替えます（reload不要）。

絵柄チェックが書き込むのはplain renderのrequest行と、`good にして基準にする`によるratingとpinだけです。GUIはpromptを書きません
（pinの変更はGeneration Detailの「基準にする」と同じ窓口、[domain-model.md](domain-model.md#基準-render-の-pin)）。

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

Runsセクションの先頭には、Runが1件以上あるとき Compare セクション（`#experiment-compare`）を置きます。
Run（行）× seed（列）のマトリクスで、Experimentが描いた全Generationを並べます。

-   行はRunを`run_index`順に最大9件並べ、超えた分は「先頭 N 件の Run だけを表示しています
    （ほか M 件）」と注記します。行見出しは`variables.arm`があればその値、なければ`#<run_index>`です。
-   列はseedで、`base_parameters.seeds`の順に並べ、続けてRunのGenerationにだけ現れるseedを
    出現順に足します。seedは最大16個なので、幅が足りないときはマトリクスが横スクロールします。
-   セルは、そのRunの結果Requestのうち、その列のseedを持つGenerationです。
    Gallery / Bookmarks / Compareと同じ`GenerationCard`で描きます（サムネイル、安全性の細帯とピル、
    ホバー時の際どさ表示、short_idのコピー、ブックマーク、ratingボタン）。カードのデータは
    マトリクス全体のGenerationをまとめて`queryGenerations`で引いたもの（100件ごとに1回）です。
    そのseedのGenerationがまだ無い（生成中・失敗）セルは、カードと同じ外寸の「生成待ち」の破線枠にします。
-   Runが1件でも出します（1行×seed数のセル）。
-   pose sweep（全Runが`overrides.parameters.pose`を持つExperiment）は、Runごとにposeとseedが違うので、列をposeにした1行で出します。見出しはpose名、セルはそのRunの結果の最初のGeneration（pinのseedで描いたもの）です。

マトリクスの下に、seed別の詳細として、Runを列にした[Compare](#compare)の表
（`#experiment-compare-detail`）を、Runが2件以上あるときだけ置きます。
`/compare`と同じ`CompareView`（カード、全列同一バー、差分表、プロンプト全文の折りたたみ、
ヘッダのhoverプレビュー）を使います。

-   列はRunを`run_index`順に最大9件並べ、超えた分はマトリクスと同じ注記を出します。
    列見出しは`variables.arm`があればその値、なければ`#<run_index>`です。
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
黄系ハイライト（`exp-facts-diff`）し、表の下に「#<baseline run_index> と異なるセルを強調」という凡例を出します。テーブルの2番目のtbodyには、
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
（chagamaのpatch語彙、[domain-model.md](domain-model.md#experimentrun)参照）は
それ自体がbase recipeへの差分なので、leaf diffではなくRunのpatch一覧をそのまま出し、
`parent_run_id`（未指定なら直前の`run_index`）のRunが基準です。基準Runと同一のpatch
（JSON同値）はそのまま、基準Runになくこの Run で加わった patch は
`+`、基準Runにありこの Run で消えた patch は `-`
で印を付けます。override全文は折りたたみます。`overrides.patches`
の形を認識できないRunだけleaf diffを表示します。

``` text
#1  PASS なし
    初期 overrides
      prompt.positive  append  , light purple thighhigh socks

#2  FAIL
    #1 からの変更
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

投票は3つのボタン（A / 同等 / B）またはキーボードショートカット（`1` /
`←` = A、`2` / `→` = B、`0` / `t` = 同等）で行います。投票すると即座に次のペアへは進まず、
判定結果の reveal（PairwiseJudgment作成レスポンスの `reveal`、
[api.md](api.md#pairwisejudgment)参照）を1行で表示します：
`A = #<left.run_index> (<left.role>) · B = #<right.run_index> (<right.role>)`
に続けて、`render_diff` の各エントリを並べます。`delta`
を持つエントリ（`positive` / `negative`）は ` · <column>: <delta>`、
それ以外は ` · <column>: <baseline> → <arm>`（差分が無ければ
` · 事実の差なし`）です。すでに判定済み（409）の
場合は reveal の代わりに「already judged」とだけ出します。reveal表示中は投票
ボタンを無効化し、「Next」ボタン（キーボードは Enter / Space）を押すと次のペアへ
進んでreveal表示を隠します。全seedを判定し終えたペアでもreveal自体は表示され、
Nextを押すと完了メッセージとExperiment詳細への戻りリンクの状態に遷移します。
`baseline` / `arm` が未指定・不正・別Experiment・結果Requestの無いRunを指すときは、
ペア画面の代わりに警告文を表示します。

## 統計（/stats）

生成時間と生成数の集計ページです。`GET /api/v1/stats`（[api.md](api.md#timings)）と同じ集計を SSR し、表と素の SVG の折れ線で出します
（チャートライブラリは使いません）。ヘッダに期間リンク（7d / 14d / 30d / 90d / 全期間、既定 30d、`requests.created_at` の窓）と、
cold load の含める / 除くトグル（`?period=&cold=include|exclude`、既定は含める）を置きます。

-   件数: Generation 数、rating 別（good / neutral / bad / 未評価）、公開済み、kind / recipe / pose 別（pose は上位 10 件、残りは「その他」）、
    GPU 時間（v2 と comfy_history の実行時間の合計。計測行の無い Request は claim→完了の合計を「概算」として別表示）、
    Generation あたり平均、good 1 枚あたりの所要時間
-   kind 別の所要時間: 日別（JST）の median を v1 / v2 の 2 系列で
-   区間の内訳（v2）: kind ごとに 投入前 / 待ち / 実行 / 後処理 / 残り の median・p90・n
-   ノード role 別の実行時間: checkpoint と canvas（render facts 由来、無ければ unknown）ごとの median・p90・n。cached ノードは除く
-   サンプラーの step 別時間: role ごとの step index 別 median の折れ線と、step 1 と step 2..n の median の比較
-   環境別の実行時間（v2）: ComfyUI バージョン・attention・argv ごとの kind 別 execute median と n

## 写真（/photos）

納品の絵をアクスタのように立てる背景の写真（[worker-protocol.md](worker-protocol.md#photo)）を登録するページです。ナビの「その他」から入ります。

-   アップロード: ファイルを選ぶと、ブラウザが向き（EXIF）を直し、長辺 3072px まで縮めて PNG にしてから、既存の REST で
    `kind = import`（`status: done`、`created_by: gui`、`parameters: {kind: "photo"}`）の Request、Job 1 件、Generation 1 枚として登録します。
    idempotency_key は元ファイルの SHA-256 なので、同じ写真を送り直しても増えません
-   一覧: `parameters.kind = photo` の import の Generation を新しい順に最大 60 件、サムネイルと short_id（コピーボタン付き）で出します。
    この short_id を `photo_generation` の `photo` に渡します
-   GUI は写真を登録するだけで、photo request は積みません（MCP / REST から積む）。ワークベンチの背景フェーズからも同じ手順で登録できます

## 参考画像（/references）

参考画像を解析し、抽出したタグから選んで yukari に当てて描くページです（[worker-protocol.md「reference」「reference_render」](worker-protocol.md#reference)）。
ナビの「その他」から入ります。

### `/references`

-   アップロード欄はファイルだけで、補足文は置きません。ブラウザが写真と同じく向き（EXIF）を直し、長辺 3072px まで
    縮めて PNG にしてから、`POST /api/v1/references` で解析の `kind = reference` を積み、その reference のページへ移ります。
    idempotency_key はボタン押下ごとに `gui:reference:{uuid}` を 1 つ作り、同じ押下の再送に使い回します（ファイルを変えると作り直します）
-   ページ上でクリップボードの画像（png / jpeg / webp）を貼り付けると、ファイル欄に入り、選んだ画像の縮小表示が出ます
-   移る前に、長辺 768px の JPEG をこのタブの sessionStorage（`reference-preview:{request id}`）に置きます。参考画像のページはそれがあるときだけ
    参考画像を出します。サーバーは解析の後に画像を消すので、別のタブや端末では出ません。サーバーから参考画像を取ることはしません
-   一覧: reference を新しい順に最大 30 件。行は short_id（その reference のページへのリンク）・解析の状態・作成時刻・描いた回数で、failed なら error も出します

### `/references/{short_id}`

ワークベンチ（[/work/{short_id}](#workshort_id)）と同じ組み立てです。右の操作パネル（`wb-panel`）で選び、左（`wb-compare`）に描いた絵を出します。

-   解析が queued / running の間は、パネルに「解析待ち」「解析中」と worker の進捗（WorkerHub の progress）を出し、4 秒ごとに状態を確かめ、
    done になったらページを読み直してタグを出します。failed / cancelled なら error を出し、描く操作は出しません
-   タグ: 解析の candidates を part ごとのチップ（`wb-pill`）で出します。worker が既定で採用したもの（`applied: true`）は ON、
    そうでない候補は OFF で薄く（破線）出し、`score / d1`（d1 に聞いていなければ `–`）を添えます。どのチップも押すと ON / OFF が切り替わります。
    自由入力の欄はありません（選べるのは worker が抽出した候補だけ）
-   pose は `bust` / `coffee` / `stand` の select で、既定は worker の提案です。`bust` の間は legwear の part のチップを押せなくし、送りません
    （bust の絵には脚が入らない）
-   seed は空なら送らず、worker が乱数で決めます（placeholder `ランダム`）
-   「描く」は ON のチップを part ごとにまとめて `POST /api/v1/references/{id}/renders` に送り、`kind = reference_render` を積みます。
    idempotency_key は押下ごとに `gui:reference_render:{uuid}` を 1 つ作り、失敗した押下の再送に使い回します（チップ・pose・seed を変えると作り直します）。
    何度でも描けます
-   描いた絵: この reference の reference_render を新しい順に、render → generate → Generation と辿って [GenerationCard](#generationcard)（compact）で並べ、
    カードの下に pose・seed・当てたタグを出します。まだ Generation の無い render は状態のタイル（待機中 / 処理中 / 描画中 / 失敗）を出します。
    待つものがある間は 4 秒ごとに `?partial=renders`（一覧の HTML だけ）で差し替え、選んでいるチップはそのまま残します
-   GUI は prompt を書きません。part patch と prompt を組むのは worker です

## Bookmarks

ブックマークした対象を素早く呼び出します。

``` text
実験
Generations
```

BookmarkはFavoriteではなく再利用・再訪のための導線です。どの対象も🔖の1操作で切り替えます。
Generationはカードと Generation Detail、
ExperimentはExperiment一覧の行とExperiment詳細に🔖を置きます。

GenerationsセクションはGalleryと同じ3-way view switch（`納品以外` / `納品` /
`すべて`）を持ちますが、既定は`view=refined`（納品済みの出力）です。bad非表示の
トグルはありません。Experimentsセクションにはこの切り替えはありません。

Generationsセクションのカードは[GenerationCard](#gallery)でGalleryと共通です（bad非表示との
組み合わせは無いため、[Gallery pending changes](#gallery-pending-changes)のbadの扱いはありません）。

Generationsは48件ずつ読み込み、Galleryのタイムラインが無いときと同じ無限スクロール（末尾の`もっと見る`を
`partial=1`で取得して追記）と、詳細から戻ったときの復元（`until`）を使います。カードが下に伸び続けるので、
実験のセクションを上に置きます。

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
| `pose_reference.set` | `generation_id`, `from`（絵柄チェックのときだけ`style_check`） | Generation Detailの`基準にする`（`initPoseReference`）、絵柄チェックの`pin を差し替える` |
| `promote_profile.submit` | `generation_id`, `name`, `version` | Generation Detailの`profile に登録`（`initPromoteToProfile`） |
| `style_check.render` | `recipe` | 絵柄チェックの`今の既定で描く`（`initStyleCheck`） |
| `queue.open` | `counts` | [キュー状態](#キュー状態)pillを開く（`initNavQueue`） |
| `queue.group.click` | `kinds`, `has_request` | キュー状態パネルの行クリック（`navQueueRow`） |
| `judge.pick` | `experiment_id`, `verdict`, `seed`, `index`, `judged`, `duplicate`（既判定時のみ） | A/B judgeの投票（`initAbJudge`） |
| `compare.add` | `generation_id`, `count` | [Compare entry](#compare-entry)の`比較に追加`/`比較から外す`ボタン |
| `compare.remove` | `generation_id`, `count` | compareバーのチップで外す（`initCompareBar`） |
| `compare.clear` | `count` | compareバーの`すべて解除`（`initCompareBar`） |
| `compare.open` | `count` | Compareへ遷移（`initCompareBar`） |
| `gallery.filter` | filter-formの各入力値 | Galleryのfilter送信（`initGalleryFilter`） |
| `gallery.view` | `view`, `bad` | Gallery / Bookmarksのview切り替え・bad表示トグル（`initGalleryView`） |
| `gallery.pending_apply` | `new_count`, `hidden_count`, `source`（`strip` / `pill`） | [Gallery pending changes](#gallery-pending-changes)の反映（`applyGalleryPending`） |
| `ui.error` | `action`, `message`, `status`, 該当操作のprops | 上記操作の失敗時 |
