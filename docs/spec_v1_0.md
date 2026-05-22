# decide-spinner (きめてルーレット) 仕様書 v1_0
## ゴール
選択肢を入れてランダムに1つ選ぶChrome拡張。ルーレット演出。完全オフライン。
## 絶対制約
外部API・通信なし/chrome.storage.localのみ/権限storageのみ/MV3・TS・Vite/UIはpopup内で完結。
## 機能
選択肢リストCRUD/CSSアニメのルーレットでランダム選択/リスト複数保存・切替/履歴表示/起動時復元/i18n ja-en/無料はリスト1つ、Premium($3買い切り7日トライアル)で複数リスト+重み付け。
## 完了条件
npm run build成功・dist生成・_locales ja/en・icons16/48/128・release/decide-spinner.zip生成。
