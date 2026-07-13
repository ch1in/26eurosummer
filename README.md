# 26eurosummer — 德瑞義 16 日鐵道行

單頁旅遊規劃 App(行事曆／待辦／每日行程／記帳／穿搭),由 GitHub Pages 託管,並透過一個 Cloudflare Worker 中繼站做跨裝置資料同步。

**網址**:https://ch1in.github.io/26eurosummer/(需要帳號密碼才能檢視內容)

## 架構

```mermaid
flowchart TB
    subgraph Device["使用者裝置（手機／電腦，可多台）"]
        Browser["瀏覽器<br/>index.html + JS"]
        LS[("localStorage<br/>離線快取")]
    end

    subgraph CF["Cloudflare Worker"]
        Worker["trip-sync-relay<br/>驗證密碼雜湊 AUTH_HASH"]
    end

    subgraph GH["GitHub repo · ch1in/26eurosummer"]
        Pages["GitHub Pages<br/>託管 index.html"]
        Data[("data/trip-data.json<br/>記帳／飯店／待辦／穿搭…")]
    end

    Browser -- "開啟網頁" --> Pages
    Browser -- "讀寫" --> LS
    Browser -- "① 帶密碼雜湊 GET/POST" --> Worker
    Worker -- "② 用 GITHUB_TOKEN 讀寫" --> Data
    Worker -. "③ 回傳最新資料" .-> Browser
```

- **前端(`index.html`)**:純靜態頁面,登入時用 `SHA-256(帳號:密碼)` 跟頁面裡寫死的雜湊比對;資料先存進瀏覽器 `localStorage`,每次變更後 1.2 秒自動打一次同步請求。
- **Cloudflare Worker(`worker.js`)**:唯一保存 GitHub 寫入權杖(`GITHUB_TOKEN`)的地方,前端只會把「密碼雜湊」當 Bearer Token 送過來，Worker 驗證通過才會代為讀寫 GitHub 上的資料檔。**`GITHUB_TOKEN` 不會出現在任何前端程式碼裡**。
- **GitHub repo**:同時扮演兩個角色 —— 用 GitHub Pages 靜態託管 `index.html`,並用 Contents API 存放 `data/trip-data.json` 當作跨裝置的資料庫。

## 已知限制

- 密碼鎖是純前端檢查,原始碼本身(含密碼雜湊)在 public repo 裡任何人都看得到,只能擋住不知道帳密的一般訪客,擋不住願意讀原始碼的人。
- `data/trip-data.json` 透過 GitHub Contents API 讀寫,單檔上限約 1MB,穿搭照片上傳時會自動壓縮以避免超過。
