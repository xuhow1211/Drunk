# 待辦清單（活躍）

> 完成的項目移至 todo_done.md。格式：[來源] 內容。

## 進行中

- [安全] Supabase 存取 token（sbp_...）已貼進對話，部署已完成，應至 Dashboard → Account → Access Tokens 產生新的並作廢舊的（使用者動手）
- [驗證] 使用者以自己的 email 實測註冊→收信→登入→勾材料→跨裝置同步（Supabase 內建 SMTP 有每小時 2 封的寄信上限，測試時留意）

## 已完成（2026-11-13∼14）

- 部署主線全通：GitHub（xuhow1211/Drunk）＋ CI 綠、Supabase（孟買 ap-south-1）schema/RLS/392 杯資料、前端 Supabase 模式＋靜態降級、email 登入、手邊材料同步；程式審查通過並已修正全部[高][中]可修項
- 正式站：https://drunk.leo537537.workers.dev（Cloudflare Workers 靜態建置；深層連結、/data 快照、Supabase 模式皆驗證通過）
- Supabase Auth 已指向正式網域：site_url 與 uri_allow_list 設定完成（確認信、密碼重設信連結會指到正式站）

## 程式審查遺留（中級，未修）

- tests/e2e：/auth 頁與資料載入失敗畫面（DataGate/DataError）尚無情境測試
- ci.yml：e2e 只跑靜態模式；Supabase 模式可在 CI 加一組帶測試專案 env 的 job（建議日後用另一個 Supabase 專案避免污染正式環境）
- useOwnedIngredients.ts:111：多分頁 storage 事件不觸發雲端同步監聽（冪等重送可收斂，非實害）
- 報告宣稱首頁 JS 約 40 KB，實測 React runtime 即約 340 KB；要再縮需路由級程式碼分割（新決策，未做）
- 資料載入失敗 / /auth 的 e2e 情境補上後，可考慮移除 CI e2e retries（playwright.config.ts）
