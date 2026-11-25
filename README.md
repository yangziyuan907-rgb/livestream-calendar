# 直播排期日历看板（钉钉 AI 表格自动同步 + GitHub Pages）

一套**零服务器成本、国内访问秒开（无外部 CDN 依赖）**的直播排期日历系统：
* 自动定时从你的**钉钉 AI 表格（多维表）**同步最新排期，生成清爽美观的网页日历（**月历总览 / 周·直播间并行泳道 / 日程与冲突排查**）；
* 同时自动生成标准 **`.ics` 订阅源**（`calendar.ics`），可一键订阅到 Apple 日历、钉钉日历、Google 日历、Notion Calendar；
* 内置**同直播间 / 同视频号账号 / 同主持人时段重叠自动预警**，以及缺日期、未填主题、未分配直播间提醒；
* 未配置钉钉 API 前也可开箱即用（自动读取 `data/schedule.csv`，且网页右上角支持临时导入 CSV 预演）。

---

## 一、5 分钟部署上线（GitHub Pages）

### 第 1 步：把本项目推送到你的 GitHub 仓库
1. 在 GitHub 新建一个仓库（建议命名为 `livestream-calendar`；公开仓库可免费使用 GitHub Pages，若想仅团队内部可见也可部署到 Cloudflare Pages / Vercel 或使用私有仓库 + GitHub Pro）。
2. 在本目录执行：
   ```bash
   git init -b main
   git add .
   git commit -m "init: DingTalk livestream calendar"
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

### 第 2 步：开启 GitHub Pages
1. 进入 GitHub 仓库 → **Settings** → **Pages**。
2. **Build and deployment → Source** 选择 **GitHub Actions**。
3. 稍等 30 秒，即可通过 `https://<你的用户名>.github.io/<仓库名>/` 打开日历看板（此时已默认加载你提供的 75 条排期）。

---

## 二、接通钉钉 AI 表格全自动同步（核心配置）

你的表格链接已经预填在工作流中：
* `baseId`: `MNDoBb60VLrYNqLqInx6PzPA8lemrZQ3`
* `sheetId`: `AEFsFrm`

只需在钉钉开发者后台建一个内部应用，让 GitHub Actions 有权读取该表即可：

### 1. 在钉钉开放平台创建企业内部应用
1. 打开 [钉钉开发者后台](https://open-dev.dingtalk.com/) → **应用开发 → 企业内部应用 → 钉钉应用 → 创建应用**。
2. 进入该应用的 **凭证与基础信息**，复制：
   * `Client ID`（即 `AppKey`）
   * `Client Secret`（即 `AppSecret`）
3. 进入 **权限管理**，搜索并开通以下权限：
   * **AI表格（多维表）读权限**（如 `Notable.Document.Read` / 钉钉 AI 表格读权限）
   * *(可选)* 如果你不想手动查 `unionId`，而是希望填手机号自动换取，再额外开通通讯录的 **根据手机号获取成员** 和 **成员信息读权限**。
4. 进入 **版本管理与发布** → 发布一个线上版本（必须发布，权限才会生效）。
5. **重要权限检查**：你提供的表格位于个人空间（`utm_scene=person_space`），请确保下面填写的 `DINGTALK_OPERATOR_ID`（或手机号）对应的钉钉账号**是这张表的创建者或协作者**，否则钉钉接口会返回 `403`。

### 2. 获取你的 `unionId`（二选一）
* **最简方式**：直接在钉钉开放平台 **API 调试台** 调用通讯录「根据手机号获取 userid」+「查询用户详情」，即可看到自己的 `unionid`。
* **免查方式**：跳过 `DINGTALK_OPERATOR_ID`，直接把你的钉钉手机号填到下面的 `DINGTALK_MOBILE` Secret 里，脚本会自动帮你换取 `unionId`。

### 3. 在 GitHub 仓库填写 Secrets
进入 GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret 名称 | 是否必填 | 说明 |
| :--- | :---: | :--- |
| `DINGTALK_APP_KEY` | 必填 | 钉钉应用的 Client ID / AppKey |
| `DINGTALK_APP_SECRET` | 必填 | 钉钉应用的 Client Secret / AppSecret |
| `DINGTALK_OPERATOR_ID` | 二选一 | 有权查看该表的钉钉用户 `unionId`（推荐） |
| `DINGTALK_MOBILE` | 二选一 | 若未填 `OPERATOR_ID`，填该用户手机号自动换取 |

*(可选)* 若以后换了新表格，可在 **Settings → Secrets and variables → Actions → Variables** 里覆盖 `DINGTALK_BASE_ID`、`DINGTALK_SHEET_ID`、`DINGTALK_SOURCE_URL`，无需改代码。

### 4. 手动测试首次同步
进入 GitHub 仓库 → **Actions** → 点击 **Sync DingTalk Schedule & Deploy Calendar** → **Run workflow**。
运行成功后：
* 之后每 **30 分钟** 会自动拉取一次钉钉表格并更新日历网页和 `calendar.ics`；
* 如果你希望**改完钉钉表格 1 分钟内立刻刷新**，可在钉钉多维表右上角 **「自动化」** 中新增一条规则：「当记录新增/修改时 → 发送 HTTP 请求」：
  * **URL**: `https://api.github.com/repos/<你的用户名>/<仓库名>/dispatches`
  * **Method**: `POST`
  * **Headers**:
    * `Authorization`: `Bearer <你的 GitHub Fine-grained PAT（仅需 Actions / Contents 写权限）>`
    * `Accept`: `application/vnd.github+json`
  * **Body**: `{"event_type": "dingtalk-updated"}`

---

## 三、把排期订阅到手机 / 电脑日历（`.ics`）

部署完成后，你的专属订阅链接为：
```text
https://<你的用户名>.github.io/<仓库名>/calendar.ics
```
* **Apple 日历（Mac / iPhone）**：文件 → 新建日历订阅 → 粘贴链接（刷新频率选每 15/30 分钟）。
* **钉钉日历 / Google 日历 / Notion Calendar**：添加订阅日历 → 通过 URL 订阅 → 粘贴上述链接即可。

---

## 四、本地运行与开发测试

本项目 Python 脚本**零第三方依赖**（仅使用 Python 3.9+ 标准库）：

```bash
# 1. 使用当前 CSV 生成日历数据与 .ics
python3 scripts/sync_dingtalk.py

# 2. 运行单元测试
python3 -m unittest discover -s tests -v

# 3. 直接用浏览器打开 docs/index.html 即可本地预览（支持 file:// 直接双击）
open docs/index.html

# 4. 本地测试连接钉钉 API（复制 .env.example 为 .env 并填入凭证后运行）
cp .env.example .env
python3 scripts/sync_dingtalk.py
```
