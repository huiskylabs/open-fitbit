# 我的健康（Fitbit 自用 iPhone app）

一个只给自己用的主屏幕网页 app，直接从 Google Health API 读取 Fitbit 数据：

- **今天**：昨晚睡眠、静息心率、今日步数、最近运动
- **睡眠**：每晚的分期图（清醒 / REM / 浅睡 / 深睡，点色块看时间段）、各阶段占比、入睡用时、清醒次数、最近 14 晚对比
- **运动**：Fitbit 自动识别的运动 + 手表上开始的运动，时长、距离、配速、消耗、平均心率、心率区间；点开看运动中的心率曲线
- **心率**：全天心率（每 5 分钟平均 + 最高/最低范围）、静息心率 30 天趋势、HRV 30 天趋势

没连接之前显示示例数据，可以先看界面。

## 架构

纯静态网页（HTML/CSS/JS，无依赖、无服务器）。手机上的浏览器直接用 Google OAuth（授权码 + PKCE）登录，再直接调用 `https://health.googleapis.com/v4`。
Client ID / Secret 和登录令牌只存在这台 iPhone 的本地存储里，代码仓库里没有任何密钥，所以仓库公开也没关系。

用到的权限（都是只读）：

- `googlehealth.sleep.readonly`
- `googlehealth.activity_and_fitness.readonly`
- `googlehealth.health_metrics_and_measurements.readonly`

## 安装步骤

1. **放到网上**：把这个文件夹推到一个公开的 GitHub 仓库（例如 `open-fitbit`），在仓库 Settings → Pages 里选 `main` 分支根目录。网址会是 `https://huiskylabs.github.io/open-fitbit/`。
2. **Google Cloud 里加回调地址**：打开 Google Cloud Console → APIs & Services → Credentials → 你的 OAuth 客户端（Web application），在 *Authorized redirect URIs* 里加上上面那个网址（结尾的 `/` 也要一致），保存。
   同时确认 *OAuth consent screen → Data Access* 里勾了上面三个 Google Health API 权限，*Audience → Test users* 里有你自己的 Gmail。
3. **装到 iPhone**：用 Safari 打开网址 → 分享按钮 → **添加到主屏幕**。
4. **连接 Fitbit**：从主屏幕打开 app → 右上角 ⚙︎ → 填 Client ID 和 Client Secret → **保存并连接 Fitbit** → 用你的 Google 账号授权。
   - 如果授权后跳到了 Safari 而不是回到 app：复制 Safari 地址栏里的完整网址，回到 app 的设置里，展开"登录后跳回了 Safari…"，粘贴后点"完成连接"。
5. **保持一直连着**：Google 项目在"测试"状态下登录令牌 7 天过期。想一直连着：Google Cloud → Google Auth Platform → Audience → **Publish app**（不用提交审核），然后在 app 里重新连接一次，遇到"Google 尚未验证此应用"点 高级 → 继续。之后令牌不再 7 天过期。
   如果 Google 不允许未审核的正式应用使用 Health 权限，就切回"测试"，每 7 天在设置里点"重新连接"即可。

## 文件

- `index.html` / `styles.css` / `app.js`：界面
- `js/auth.js`：Google 登录
- `js/api.js`：Google Health API 调用和数据整理
- `js/charts.js`：睡眠分期图、柱状图、折线图（纯 SVG）
- `js/demo.js`：示例数据
- `sw.js` / `manifest.webmanifest` / `icons/`：主屏幕 app 和离线打开
