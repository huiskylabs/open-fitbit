# 我的健康（Fitbit 自用 iPhone app）

一个只给自己用的主屏幕网页 app，直接从 Google Health API 读取 Fitbit 数据，图为主、字为辅。
五个页面共用一个 **日 / 周 / 月 / 3月** 切换，左右滑动看更早或更近的时间段。

- **今天**：睡眠分、恢复分、身体状态（静息心率、HRV、呼吸率、皮温和你的正常范围）、待确认的训练、步数、近 7 天
- **睡眠**：一晚的分期图叠夜间心率；一周 / 一月的睡眠条形码；3 个月的日历热力图、作息漂移、每周分期；夜间体征
- **运动**：每次运动的心率区间；一周的时间网格；一月的日历；3 个月的每周时长、篮球强度、VO2 max、运动时间习惯
- **训练**：练完不用点开始结束。app 从心率和步数里找出力量训练，猜你练了什么（按上次 + 轮换），打开就能确认；
  不对就按住说话（“深蹲 100 公斤 5 组 5 个，引体 4 组 8 个，最后一组很吃力”）或手动改。
  还有“下次练什么”、每个动作的进度、部位热力图、训练日历、每周组数
- **心率**：全天曲线和心率区间；静息心率、HRV 的趋势和你的正常范围；每日心率范围

没连接之前显示示例数据，可以先把每个页面都看一遍。

## 分数怎么算

- **睡眠分**（0–100）= 时长 50（4 小时 0 分，8 小时满分）+ 规律 25（上床和起床时间跟前 7 晚的中位数比）+ 深睡和 REM 占比 25（40% 以上满分）
- **恢复分**（0–100）= HRV 跟你 30 天基线比 35 + 静息心率跟基线比 30 + 睡眠分 35；呼吸率或皮温明显偏高各扣 8 分
- **正常范围** = 前 30 天的平均值 ± 1 个标准差；API 直接给了个人范围时用 API 的

## 架构

纯静态网页（HTML/CSS/JS，无依赖、无构建、无服务器）。手机上的浏览器直接用 Google OAuth（授权码 + PKCE）登录，再直接调用 `https://health.googleapis.com/v4`。
最近 120 天的数据存在手机的 IndexedDB 里，打开时只更新最近几天，每周完整重新下载一次。

密钥都只存在这台 iPhone 上，代码仓库里没有任何密钥，所以仓库公开也没关系：

- Google 的 Client ID / Secret 和登录令牌
- Anthropic API 密钥（只用来把语音识别出的文字变成组数和重量）

用到的 Google 权限：

- `googlehealth.sleep.readonly`
- `googlehealth.activity_and_fitness.readonly`
- `googlehealth.health_metrics_and_measurements.readonly`
- `drive.file`（只在打开“自动备份到 Google Drive”时才申请；只能看到这个 app 自己建的那一个备份文件）

训练记录不会写回 Google Health。

## 安装步骤

1. **放到网上**：仓库 Settings → Pages 里选 `main` 分支根目录。网址是 `https://huiskylabs.github.io/open-fitbit/`。
2. **Google Cloud 里加回调地址**：Google Cloud Console → APIs & Services → Credentials → 你的 OAuth 客户端（Web application），在 *Authorized redirect URIs* 里加上上面那个网址（结尾的 `/` 也要一致）。
   同时确认 *OAuth consent screen → Data Access* 里勾了上面三个 Google Health API 权限，*Audience → Test users* 里有你自己的 Gmail。
3. **装到 iPhone**：用 Safari 打开网址 → 分享按钮 → **添加到主屏幕**。
4. **连接 Fitbit**：从主屏幕打开 app → 右上角设置 → 填 Client ID 和 Client Secret → **保存并连接** → 用你的 Google 账号授权。
   - 如果授权后跳到了 Safari 而不是回到 app：复制 Safari 地址栏里的完整网址，回到 app 的设置里，展开“登录后跳回了 Safari？”，粘贴后点“完成连接”。
5. **语音记录训练**（可选）：在 [console.anthropic.com](https://console.anthropic.com) 建一个 API 密钥，填到设置 → 语音记录（Claude），点“保存并试一下”。
   没有密钥也能用：确认卡上点“改”，用加减按钮改组数和重量。
6. **训练记录备份到 Google Drive**（可选）：先在 Google Cloud 项目的 APIs & Services → Library 里启用 **Google Drive API**，
   然后在 app 设置里打开“自动备份到我的 Google Drive”，按提示再授权一次。之后每次保存训练都会更新 Drive 里的“我的健康 训练记录备份.json”；
   换手机时连接后打开同一个开关，会自动恢复。设置里也可以随时导出 JSON 文件。
7. **保持一直连着**：Google 项目在“测试”状态下登录令牌 7 天过期，到时 app 顶部会提示，点“重新连接”即可（手机上的数据不会丢）。
   想不再过期：Google Cloud → Google Auth Platform → Audience → **Publish app**（不用提交审核），然后在 app 里重新连接一次。

## 文件

- `index.html` / `styles.css` / `app.js`：外壳（标签页、日 / 周 / 月 / 3月 切换、同步、设置）
- `js/pages/`：五个页面（today、sleep、workouts、trainpage、heart）和共用部分
- `js/charts.js` / `js/tcharts.js`：所有图（纯 SVG，颜色跟随浅色 / 深色模式）
- `js/data.js` / `js/store.js`：本机缓存、同步、基线
- `js/scores.js`：睡眠分、恢复分、心率区间
- `js/training.js`：训练识别、猜测、进度计算
- `js/trainui.js` / `js/voice.js`：训练编辑和语音（手机语音识别 + Claude 解析）
- `js/drive.js`：Google Drive 备份
- `js/auth.js` / `js/api.js`：Google 登录和 Google Health API
- `js/demo.js`：示例数据
- `sw.js` / `manifest.webmanifest` / `icons/`：主屏幕 app 和离线打开
