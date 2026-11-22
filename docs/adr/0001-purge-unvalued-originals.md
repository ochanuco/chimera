---
status: accepted
date: 2026-11-22
decision-makers:
  - ochanuco
---

# 価値の印が無い Generation の original と asset を消す

## 要約

R2 `chimera-images` が月 8GB 前後増える状況に対して、価値の印（good / neutral、bookmark、Publication）が無く作業中でもない Generation の original と asset を、印のある絵の祖先を除いて 14 日の後に消す方式を選び、すべて残す方式と lossless WebP への再圧縮を退けた。捨てた下書きと加工が容量の大半を占めるのを止めるためで、印を付け忘れた絵を 14 日で redraw / deliver の元にできなくなることは受け入れる。

## 背景と課題

original は redraw / deliver が読むため、すべて残していた。容量の大半は、評価されないまま残る generate の下書きと、完成に至らなかった加工の出力が占める（2026-11 時点で 20.8GB のうち約 12GB）。Generation の行は物理削除しないので、消してよいのは R2 の画像だけ。何を残せば後の作業が壊れないかを決める必要があった。

## 判断の決め手

- 残すと決めた絵と、その絵への操作が読む祖先は失わない（dof は deliver の下の絵を、saturation への deliver はその下の絵を worker が読む）
- 作業中の木（最近の出力、触られたワークベンチ、進行中の Request）には触らない
- 消したものも一覧と詳細で見えるように preview を残す
- 変換の課金を増やさない

## 検討した選択肢

1. すべて残す
2. lossless WebP に再圧縮して残す
3. 価値の印が無いものを消す。印のある絵の祖先はすべて残す
4. 価値の印が無いものを消す。印のある絵の元絵だけを残し、途中の絵は消す

## 決定

選択肢 3。残すかどうかは利用者が付ける印（good / neutral、bookmark、Publication）で決め、印のある絵の祖先も残す。import の写真、pin や Experiment などの記録が指す絵も残す。

### 結果

- 良い点: 捨てた枝の分（月 6GB 前後）が溜まらなくなる。残る増加は、印のある絵とその祖先、import、preview の分で、月 2GB 前後
- 良い点: 消した Generation も行と preview が残り、一覧・詳細・MCP から見える
- 悪い点: 印を付け忘れた絵は 14 日で original を失い、redraw / deliver の元にできなくなる（409 `original_purged`）
- 悪い点: 増加は止まらないので、無料枠（10GB）はいずれ超える
- 悪い点: preview が無い Generation は消す前に preview を作るので、その分の変換が一度かかる

## 選択肢ごとの良い点と悪い点

- すべて残す: 何も壊れないが、使わない画像の容量が増え続ける
- lossless WebP: 減るのは 2〜3 割だけで、RGBA の絵は透明部分の下の RGB が変わるため対象にできない。変換の課金が浮く R2 代を上回る
- 元絵だけを残す: 消せる量は約 2GB 増えるが、印のある絵への dof と、印のある saturation への deliver が worker で失敗する
