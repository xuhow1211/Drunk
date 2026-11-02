---
name: diagnose-live-instance
description: 使用者回報功能異常時，要實際開啟他正在執行的服務做診斷，不要只憑推論或只跑自己的測試
metadata:
  type: feedback
---

使用者回報「功能沒作用／沒聲音／沒顯示」時，先找出他實際開著的服務
（`netstat` 看監聽埠位、對應到專案的 dev server），再用瀏覽器實際開那個
網址蒐集證據：console 訊息、network 請求與回應碼、頁面未捕捉例外、
`performance.getEntriesByType('resource')`、localStorage／sessionStorage 內容。

**Why:** 使用者看到的是症狀，不是原因。同一個「沒聲音」在推論上可能是音訊
沒 autoplay、串流被擋、AudioContext 沒 resume、靜音狀態沒存下來…，
每一種的修法完全不同。只靠自己的推論很容易修錯地方。
本專案就曾因為「降級計時器把提示卡片換成離線模式」而讓使用者完全看不到
該點擊的提示，而合成音又因 AudioContext suspended 而靜默無聲。

**How to apply:**
- 先診斷再動手，不要先猜原因就先改程式
- 診斷要能重現使用者的情境：用他正在跑的那個服務、預設瀏覽器設定
  （不要加 `--autoplay-policy` 之類的測試特例，那會讓結論失真）
- 同時檢查「我的測試是不是本來就沒測到東西」：本專案的離線測試用
  `**/*.mp3` 攔截串流，但實際網址結尾是 `-128-mp3`，規則從未匹配，
  測試是連到真實電台才碰巧通過的
- 修完要在他的實例上再驗一次，不只是在測試裡綠
