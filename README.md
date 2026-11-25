# 直播排期日历看板（AES-256 加密保护 + 钉钉自动同步 + GitHub Pages）

一套**零服务器成本、国内秒开、端到端 AES-256-GCM 加密保护**的团队直播排期日历：
* **访问密码保护（输入一次，下次直接看）**：排期数据全部通过 `PBKDF2-HMAC-SHA256 (200,000 次迭代) + AES-256-GCM` 加密成 `docs/data/schedule.enc.json` 后才发布到 GitHub Pages，公开仓库里**不含任何明文排期或钉钉链接**；成员首次输一次密码后由本地浏览器记住，下次打开自动解锁，右上角随时可一键「锁定」。
* **清晰多视图**：月历总览 / 周·直播间并行泳道（19楼 vs 21楼）/ 日程与冲突排查，内置同直播间、同视频号账号、同主持人时段冲突自动告警。
* **解锁后一键导出 `.ics`**：无需公开暴露明文 `.ics`，解锁进入网页后点击右上角「下载 .ics」即可导入 Apple / 钉钉 / Google 日历。

---

## 一、如何更新排期

### 方式 A：未接钉钉 API 前（本地加密后更新 1 个密文文件）
1. 从钉钉多维表导出最新 CSV，覆盖保存到本地 `data/schedule.csv`（已被 `.gitignore` 忽略，不会被上传到公开仓库）。
2. 在项目根目录执行（把密码替换成你的团队密码，或写进本地 `.env` 文件的 `CALENDAR_PASSWORD`）：
   ```bash
   CALENDAR_PASSWORD="你的团队密码" python3 scripts/sync_dingtalk.py
   ```
3. 将新生成的加密文件 `docs/data/schedule.enc.json` 推送或上传到 GitHub 仓库的 `docs/data/` 目录，GitHub Actions 会自动重新部署网页。

### 方式 B：接通钉钉 AI 表格 API 后（每 30 分钟全自动加密更新）
在 GitHub 仓库 → **Settings → Secrets and variables → Actions** 中添加以下 Secrets：

| Secret 名称 | 说明 |
| :--- | :--- |
| `CALENDAR_PASSWORD` | 网页解锁密码（GitHub Actions 会用它加密每次拉取到的最新排期） |
| `DINGTALK_APP_KEY` | 钉钉企业内部应用的 Client ID / AppKey |
| `DINGTALK_APP_SECRET` | 钉钉企业内部应用的 Client Secret / AppSecret |
| `DINGTALK_OPERATOR_ID` | 有权查看该表的钉钉用户 `unionId`（或改填 `DINGTALK_MOBILE` 手机号自动换取） |

配置完成后，GitHub Actions 每 30 分钟自动从钉钉拉取最新排期 → 内存加密生成 `docs/data/schedule.enc.json` → 自动发布上线，**全程不落明文到公开仓库**。

### 更换团队密码
* 修改 `CALENDAR_PASSWORD`（本地 `.env` 或 GitHub Secret）并重新生成/运行一次同步即可；旧设备本地记住的旧密码会自动失效并提示输入新密码。

---

## 二、本地预览与测试

```bash
# 1. 运行单元测试（含 AES-256-GCM 加解密、密码校验与轮换测试）
python3 -m unittest discover -s tests -v

# 2. 本地加密生成测试
CALENDAR_PASSWORD="你的密码" python3 scripts/sync_dingtalk.py

# 3. 本地启动静态服务预览（Web Crypto API 需要 HTTPS 或 localhost）
python3 -m http.server -d docs 8000
# 浏览器打开 http://localhost:8000
```
