# 待辦清單（活躍）

> 完成的項目移至 todo_done.md。格式：[來源] 內容。

## 進行中

- [雲端部署-階段A] Cloudflare Pages 上架：等使用者授權（儀表板串接 GitHub 或 Pages 權限的 API token）；建置指令 `npm run build`、輸出目錄 `dist`；需設定環境變數 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
- [雲端部署-階段A] Supabase Auth 設定：部署後把 Site URL 改為正式網域、Redirect URLs 加入正式網域（Email 模板連結會跟著走）；Dashboard → Authentication → URL Configuration
- [安全] Supabase 存取 token（sbp_...）已貼進對話，部署完成後應至 Dashboard → Access Tokens 輪替作廢

## 程式審查遺留（中級，未修）

- tests/e2e：/auth 頁與資料載入失敗畫面（DataGate/DataError）尚無情境測試
- ci.yml：e2e 只跑靜態模式；Supabase 模式可在 CI 加一組帶測試專案 env 的 job（建議日後用另一個 Supabase 專案避免污染正式環境）
- useOwnedIngredients.ts:111：多分頁 storage 事件不觸發雲端同步監聽（冪等重送可收斂，非實害）
- 報告宣稱首頁 JS 約 40 KB，實測 React runtime 即約 340 KB；要再縮需路由級程式碼分割（新決策，未做）
- 資料載入失敗 / /auth 的 e2e 情境補上後，可考慮移除 CI e2e retries（playwright.config.ts）
