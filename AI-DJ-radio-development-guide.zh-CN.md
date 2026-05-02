# Claudio / AI DJ 电台项目开发文档

> 当前版本是一个本地优先的 AI DJ 电台 MVP：React + Vite 前端、Node.js + Express + Socket.io 后端、SQLite 本地存储、NeteaseCloudMusicApi 音乐接口、OpenAI-compatible AI 选曲/文案、ElevenLabs / MiniMax / Edge TTS / none 降级。

---

## 0. 当前快照

| 项 | 当前值 |
|---|---|
| 更新时间 | 2026-05-02 10:17:14 +08:00 Asia/Shanghai |
| 工作目录 | `E:\GPT\deep-radio` |
| Git 状态 | 当前目录不是 Git 仓库，commit hash: N/A |
| 后端版本 | `claudio-ai-dj-backend@1.0.0` |
| 前端版本 | `claudio-radio-frontend@0.0.1` |
| NeteaseCloudMusicApi | `4.8.9` |
| 当前数据状态 | 正确从 `backend` 目录解析数据库时：`favorites=2663`、`user_profile=1`、`play_history=147`、`dj_sessions=105`、`radio_queue=14`、`session_messages=59` |
| 最近运行迹象 | 后端日志显示曾在 `4000` 启动并成功选中过 `Current Joys - A Different Age`；网易云 API 日志显示曾在 `3010` 启动 |

---

## 1. 项目目标与边界

### 1.1 最终目标

Claudio 是一个个人 AI DJ 电台：用户点击进入电台后，系统读取网易云红心歌单，生成音乐偏好档案，再结合时间段、最近播放、聊天内容和新歌探索策略，持续选择可播放歌曲，并用 AI DJ 的中文主持词和可选 TTS 做歌曲前播报。

### 1.2 MVP 已覆盖范围

- 本地前端、后端、NeteaseCloudMusicApi 三服务联调。
- 网易云账号 Cookie / Cookie 文件接入。
- 红心歌单同步到 SQLite。
- 基于红心歌单生成 `music_profile`。
- 根据用户画像、最近播放、红心样本、用户消息和时间段选曲。
- 网易云搜索、可播放链接验证、试听片段/短音频过滤。
- 歌曲前 AI DJ 文案生成。
- TTS 生成与失败降级。
- Socket 电台会话、聊天、下一首、暂停、继续。
- 前端播放顺序：开场/播报音频优先，失败或缺失时直接播放歌曲。

### 1.3 暂不覆盖

- 多用户账号系统。
- 生产级鉴权、权限隔离、计费、监控。
- 歌曲音频长期存储或转载分发。
- 正式 migrations 和数据库版本管理。
- 线上部署自动化。

---

## 2. 当前目录结构

```text
E:\GPT\deep-radio
  package.json
  start-local.ps1
  AI-DJ-radio-development-guide.zh-CN.md
  scripts/
    local-control.js
  backend/
    package.json
    .env.example
    src/
      index.js
      config.js
      db.js
      errors.js
      socket.js
      routes/
        health.js
        profile.js
        radio.js
        debug.js
      services/
        ai.js
        audioCleaner.js
        djAgent.js
        netease.js
        radioEngine.js
        radioQueue.js
        tts.js
      scripts/
        syncFavorites.js
        analyzeProfile.js
      data/
        claudio.db
        netease.cookies.txt
      temp_audio/
  frontend/
    package.json
    .env.example
    src/
      App.jsx
      main.jsx
      components/
      hooks/useRadioPlayback.js
      lib/
      styles/app.css
  NeteaseCloudMusicApi/
    package.json
    app.js
    module/
    docs/
```

说明：`backend/src/data/*.db*`、`backend/src/data/netease.cookies.txt`、`backend/src/temp_audio/*.mp3` 已在 `backend/.gitignore` 中忽略。

---

## 3. 服务与启动方式

### 3.1 默认端口与单一事实来源

| 服务 | 默认端口 | 当前说明 |
|---|---:|---|
| NeteaseCloudMusicApi | `3000` | 最终以 `backend/.env` 中 `NETEASE_API_URL` 为准 |
| 后端 API + Socket | `4000` | Express + Socket.io |
| 前端 Vite | `5173` | React UI |

### 3.2 推荐启动方式

日常本地使用优先走根目录统一入口：

```bash
cd E:\GPT\deep-radio
npm run dev
```

或直接：

```powershell
cd E:\GPT\deep-radio
.\start-local.ps1
```

这两个入口都会在启动前检查依赖目录、关键端口占用和后端核心配置。

### 3.3 手动启动顺序

```bash
cd NeteaseCloudMusicApi
npm start
```

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

访问：

```text
http://localhost:5173
```

### 3.4 常用脚本

根目录：

```bash
npm run dev
npm run status
npm run doctor
```

后端：

```bash
cd backend
npm run dev
npm run start
npm run sync:favorites
npm run profile:analyze
```

前端：

```bash
cd frontend
npm run dev
npm run build
npm run preview
```

---

## 4. 环境变量

### 4.1 backend/.env.example

当前字段：

```env
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:5173

NETEASE_API_URL=http://localhost:3000
NETEASE_COOKIE=
NETEASE_COOKIE_FILE=
FAVORITE_PLAYLIST_ID=

AI_PROVIDER=deepseek
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=
AI_MODEL=deepseek-chat
AI_DJ_COPY_MODEL=deepseek-v4-pro
AI_MODEL_FLASH=deepseek-chat
AI_MODEL_PRO=deepseek-v4-pro

TTS_PROVIDER=auto
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
EDGE_TTS_VOICE=zh-CN-XiaoxiaoNeural
MINIMAX_API_BASE_URL=https://api.minimaxi.com
MINIMAX_API_KEY=
MINIMAX_TTS_MODEL=speech-2.6-turbo
MINIMAX_TTS_VOICE_ID=female-shaonv
MINIMAX_TTS_LANGUAGE_BOOST=auto

DATABASE_PATH=./src/data/claudio.db
TEMP_AUDIO_DIR=./src/temp_audio
MAX_TRACK_RETRY=3
INTRO_AUDIO_TTL_SECONDS=3600
```

### 4.2 frontend/.env.example

```env
VITE_BACKEND_URL=http://localhost:4000
```

### 4.3 解析约定与安全要求

- 后端现在固定从 `backend/.env` 读取配置，不再依赖当前 shell 所在目录。
- `DATABASE_PATH`、`TEMP_AUDIO_DIR`、`NETEASE_COOKIE_FILE` 的相对路径都按 `backend/` 根目录解析。
- 根目录脚本会把 `backend/.env` 里的 `NETEASE_API_URL` 视为网易云 API 的单一事实来源。

- 不要把 `.env`、网易云 Cookie、API Key、手机号、密码写入文档或提交记录。
- `NETEASE_COOKIE_FILE` 可指向 `backend/src/data/netease.cookies.txt`，该文件已忽略。
- 生产环境不要裸露 NeteaseCloudMusicApi。

---

## 5. 数据库设计

SQLite 入口：`backend/src/db.js`。

### 5.1 已初始化表

| 表 | 用途 |
|---|---|
| `favorites` | 缓存网易云红心歌单歌曲 |
| `user_profile` | 保存 `music_profile` JSON |
| `play_history` | 记录已播放歌曲，避免重复 |
| `dj_sessions` | 记录 Socket 会话状态 |
| `radio_queue` | 预取队列，保存 checking/ready/failed/played 状态与 track payload |
| `session_messages` | 保存用户与 DJ 的最近聊天/开场记忆 |

### 5.2 当前数据检查结果

本次按后端实际启动目录 `backend` 读取 SQLite，结果如下：

```text
favorites: 2663
user_profile: 1
play_history: 147
dj_sessions: 105
radio_queue: 14
session_messages: 59
profile_updated_at: 1777609881
profile_updated_at_iso: 2026-05-01T04:31:21.000Z
```

数据已存在，可以直接用于真实推荐。当前后端已修正为稳定路径解析：即使从项目根目录启动，也会固定解析到 `backend/src/data/claudio.db`，不再误读到 `E:\GPT\deep-radio\src\data\claudio.db`。

---

## 6. 后端实现状态

### 6.1 入口与中间件

已实现：

- `backend/src/index.js` 创建 Express app、HTTP server、Socket.io。
- CORS 按 `FRONTEND_URL` 白名单校验，并自动兼容 `localhost` / `127.0.0.1`。
- JSON body 限制 `1mb`。
- 统一错误格式：`{ ok:false, error:{ code,message,detail? } }`。
- 启动时创建数据库目录、临时音频目录并执行 `initDb()`。
- 启动后台音频清理器。

### 6.2 HTTP API

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| `GET` | `/health` | Done | 返回 `{ status:'ok', time }` |
| `GET` | `/api/profile` | Done | 返回当前 `music_profile` 或 null |
| `POST` | `/api/profile/analyze` | Done | 可选 `forceSync/forceAnalyze/playlistId`，同步并生成画像 |
| `POST` | `/api/radio/next` | Done | HTTP 调试用，直接选一首可播放歌曲 |
| `GET` | `/api/radio/audio/:filename` | Done | 返回临时 TTS mp3，包含路径穿越防护 |
| `GET` | `/api/debug/status` | Done | 聚合返回后端、网易云、数据和 TTS 状态 |
| `GET` | `/api/debug/netease-auth` | Done | 调试 Cookie、登录态和歌曲访问情况 |
| `GET` | `/api/debug/radio-queue` | Done | 查看指定 session 队列统计和最近队列项 |

### 6.3 Socket 事件

Client -> Server：

- `listener:start`
- `listener:message`
- `track:ended`
- `playback:pause`
- `playback:resume`

Server -> Client：

- `session:ready`
- `radio:state`
- `dj:message`
- `track:new`
- `radio:error`
- `radio:status`

当前行为：

- `listener:start` 会创建/恢复 session，清空该 session 队列，发送即时 fallback 开场白，并开始选曲。
- 开场白目前主要走本地时间段 fallback，同时异步尝试为开场白生成 TTS；`ai.js` 中有 `generateOpeningMessage()`，但当前 Socket 主流程未直接调用它。
- 非请求下一首的聊天会进入 `djAgent.respond()`，保存会话记忆，并可由 AI 判断是否触发下一首。
- 请求下一首会 `forceFresh`：清空队列并立即按用户消息重新选曲。
- 歌曲结束后自动推下一首。

### 6.4 本地诊断入口

- `GET /api/debug/status`：聚合返回 backend、Netease API、登录态、`favorites` 数量、`music_profile` 是否存在、`play_history` 数量、TTS readiness 和真实数据库路径。
- `npm run status`：请求后端状态接口，输出简版状态。
- `npm run doctor`：在 `status` 基础上输出更详细的本地配置摘要。

---

## 7. 推荐与队列流程

### 7.1 选曲上下文

`backend/src/services/radioEngine.js` 会读取：

- `music_profile`
- 最近 20 首播放历史
- 最近 10 个艺人
- 随机 80 首红心歌单样本
- 当前时间段
- 用户最新消息
- 推荐方向：`favorite_revisit` 或 `new_discovery`
- 用户约束强度：`normal` / `hard` / `strict-hard`

### 7.2 选曲步骤

1. `selectTrackCandidate()` 让 AI 返回候选歌曲。
2. `searchSong()` 通过网易云搜索候选歌曲。
3. 批量调用 `/song/url/v1` 验证可播放性。
4. 过滤无 URL、试听片段、过短音频、疑似 preview URL。
5. 确认可播放后，再调用 `generateTrackIntroCopy()` 生成播报文案。
6. 调用 `generateIntroAudio()` 生成 TTS，失败不阻断播放。
7. 写入 `play_history`。
8. 返回 `track:new` payload。

### 7.3 队列预取

`backend/src/services/radioQueue.js` 已实现每个 session 的 ready 队列：

- 默认目标 ready 数：2。
- 后台填充候选，逐个验证可播放。
- 队列项状态：`checking` / `ready` / `failed` / `played`。
- `track:new` 发送后会异步补齐队列。

注意：当前 `fillReadyQueue()` 在预取时未传入用户选择的 `ttsProvider`，因此预取歌曲的 TTS 使用全局默认配置；如果用户在前端临时指定了 provider，实时选曲会生效，但预取队列不一定跟随。

---

## 8. AI 模块

入口：`backend/src/services/ai.js` 和 `backend/src/services/djAgent.js`。

### 8.1 模型分层

| 任务 | 默认模型层级 |
|---|---|
| 偏好分析 | `AI_MODEL_PRO` |
| 歌曲播报文案 | `AI_MODEL_PRO` |
| 开场文案 | `AI_MODEL_PRO` |
| 选曲 | `AI_MODEL_FLASH` |
| DJ 聊天回复 | `AI_MODEL_FLASH` |

### 8.2 JSON 解析策略

- 清理 ```json code fence。
- `JSON.parse` 失败后最多重试 1 次。
- 仍失败则抛出 `AI_JSON_PARSE_FAILED`。

### 8.3 当前画像持久化与刷新

用户画像保存在 SQLite 的 `user_profile` 表中，`key = music_profile`。默认行为是长期持久化复用，不按天自动重算。`/api/profile/analyze` 在已有画像且未传 `forceAnalyze=true` 时会直接返回 `reused: true`，不调用 AI。`npm run profile:analyze` 是明确的手动刷新命令，会强制重新分析。`npm run profile:analyze` 会：

- 读取最近 200 首红心。
- 读取随机 200 首红心。
- 调用 AI 生成：`genres/moods/avoid/artists_style/favorite_patterns/discovery_note/recommendation_strategy`。
- 写入 `user_profile.key = music_profile`。
- 日常启动和普通接口调用不会重新分析画像；只有首次没有画像、`forceAnalyze=true`，或手动运行 `npm run profile:analyze` 时才会消耗画像分析 token。

---

## 9. 网易云接入

入口：`backend/src/services/netease.js`。

已实现：

- `getAccount()`
- `getLoginStatus()`
- `getUserPlaylists(uid)`
- `getPlaylistTracks(playlistId, limit, offset)`
- `listAllPlaylistTracks(playlistId)`
- `searchSong(songName, artist)`
- `getSongUrl(songId)`
- `getSongUrls(songIds)`
- `probeSongAccess(songId)`
- `getResolvedCookieMeta()`
- `getLyric(songId)`

匹配策略：

- 搜索关键词为 `songName + artist`。
- 歌名完全匹配优先。
- 艺人包含匹配加分。
- 批量验证候选是否有可播放 URL。
- 过滤 `freeTrialInfo`、过短音频、疑似试听链接。

---

## 10. TTS 与临时音频

入口：`backend/src/services/tts.js` 和 `backend/src/services/audioCleaner.js`。

### 10.1 provider

支持：

- `none`
- `edge`
- `elevenlabs`
- `minimax`
- `auto`

`auto` 顺序：MiniMax -> ElevenLabs -> Edge。

### 10.2 音频文件

- 输出目录：`TEMP_AUDIO_DIR`，默认 `backend/src/temp_audio`。
- 文件名：`intro_{songId}_{timestamp}_{nanoid}.mp3`。
- 公开 URL：`/api/radio/audio/:filename`。
- TTL：`INTRO_AUDIO_TTL_SECONDS`，默认 3600 秒。
- 清理器每 10 分钟扫描一次过期 mp3。

### 10.3 风险点

- MiniMax 默认 API Base 当前是 `https://api.minimaxi.com`，需要确认是否与实际账号服务域名一致。
- Edge TTS 依赖外部服务可用性，网络受限时可能失败。
- TTS 失败会降级为无播报音频，但文案仍可显示。

---

## 11. 前端实现状态

### 11.1 技术栈

- React 18
- Vite 5
- socket.io-client
- axios
- lucide-react

### 11.2 当前 UI

已实现：

- `JOIN RADIO` / `LIVE` 入口按钮。
- Socket 连接状态和健康检查。
- 双视觉风格切换：`classic` / `claudio`，保存到 `localStorage`。
- 当前播放：黑胶唱片、封面、歌名、艺人/专辑、进度条。
- 播放控制：播放/暂停、下一首、静音。
- DJ Feed：展示最新 DJ/用户消息，状态消息轮播。
- 聊天输入：发送后默认 `requestNext: true`。
- 音频律动：AudioContext analyser，失败时 fallback 动画。

### 11.3 播放逻辑

`frontend/src/hooks/useRadioPlayback.js`：

- 切歌时停止旧 intro/music 音频。
- 如果 `introAudioUrl` 存在，先播 intro，再播 music。
- intro 播放失败时直接播放 music。
- music 结束后触发 `track:ended`。
- 接近结尾发生音频错误时视作自然结束，避免过早断流导致不能进入下一首。

### 11.4 当前前端注意点

- CSS 顶部引入 Google Fonts；如果离线运行，字体会回退到本地字体。
- `NowPlaying.jsx` 中艺人/专辑分隔符显示为 `路`，疑似编码或占位符问题，建议后续改为 `·` 或 ` / `。
- `StatePanel.jsx`、`RadioClock.jsx`、`RhythmFlow.jsx`、`WaveformProgress.jsx` 当前存在但主 `App.jsx` 未全部使用。

---

## 12. 当前部署状态

### Done

- 本地项目骨架完整。
- 根目录统一入口已补齐：`package.json`、`start-local.ps1`、`npm run status`、`npm run doctor`。
- 后端 HTTP、Socket、DB、AI、网易云、TTS、队列模块基本闭环。
- 前端控制台 UI 与音频播放逻辑基本闭环。
- `.env.example` 已覆盖当前代码使用的主要字段。
- 本地日志显示后端曾成功选曲。

### In Progress

- 网易云登录态与端口配置仍需要用户确认；根目录启动脚本已经统一以 `backend/.env` 中的 `NETEASE_API_URL` 为准。
- 开场白 AI 生成函数已存在，但 Socket 当前用本地 fallback 开场白。
- 预取队列的 per-request TTS provider 传递还不完整。

### Pending

- 自动化测试尚未建立。
- 生产部署尚未配置。
- 数据库 migrations 尚未引入。
- 前端若要正式上线，需要处理外部字体、移动端细节和编码小问题。

---

## 13. 已知问题与风险

| 优先级 | 问题 | 影响 | 建议 |
|---|---|---|---|
| P0 | Netease 端口和登录态依赖本地实际配置 | 服务可能启动成功但网易云不可用 | 统一通过 `backend/.env` 管理 `NETEASE_API_URL`，并用 `npm run doctor` / `/api/debug/status` 自检 |
| P1 | `listener:start` 未使用 AI 开场白生成函数 | 开场白个性化不足 | 将 `generateOpeningMessage()` 接入 Socket 主流程，并保留 fallback |
| P1 | 预取队列未透传用户临时 `ttsProvider` | 用户切换 provider 后，预取歌曲可能不一致 | 给 `fillReadyQueue()` 增加 `ttsProvider` 参数并传入 `resolveCandidateToPlayableTrack()` |
| P1 | 缺少测试 | 改动后容易回归 | 增加后端单元测试/集成 smoke test，至少覆盖 health、profile、audio path、queue |
| P2 | 前端部分未使用组件和 CSS 遗留 | 维护成本上升 | 后续 UI 稳定后再小步清理，不要现在大重构 |
| P2 | 前端字体依赖 Google Fonts | 离线或网络差时视觉不稳定 | 本地化字体或接受 fallback |

---

## 14. 下一步优化计划

### P0：稳住真实数据闭环

1. 检查 `backend/.env` 中 `NETEASE_API_URL`、`NETEASE_COOKIE` / `NETEASE_COOKIE_FILE`、`FAVORITE_PLAYLIST_ID`。
2. 日常启动优先运行：

```bash
cd E:\GPT\deep-radio
npm run dev
```

3. 启动后用下面任一命令快速确认状态：

```bash
cd E:\GPT\deep-radio
npm run status
```

```bash
cd E:\GPT\deep-radio
npm run doctor
```

4. 如需只启动后端，仍可运行：

```bash
cd backend
npm run dev
```

5. 只有在红心歌单明显变化，或你明确想刷新长期画像时，才运行：

```bash
cd backend
npm run sync:favorites
npm run profile:analyze
```

6. 前端启动后点击 `JOIN RADIO`，确认能收到 `track:new` 并播放。

### P1：提高体验稳定性

- 接入 AI 个性化开场白。
- 修复预取队列 TTS provider 透传。
- 增加一条后端 smoke test：调用 `/health`、检查 profile 状态、用 `/api/debug/netease-auth` 验证登录态。
- 前端修复 `路` 分隔符。

### P2：交付与部署准备

- 增加 README 快速启动版。
- 增加 `.env.example` 字段说明。
- 梳理生产部署方案：前端 Vercel，后端 VPS/Railway/Render，NeteaseCloudMusicApi 内网或带鉴权反代。
- 增加 SQLite 备份与迁移策略。

---

## 15. 联调验收清单

### 基础服务

- [ ] `GET http://localhost:4000/health` 返回 ok。
- [ ] `GET /api/debug/status` 返回 ok，且包含真实数据库路径、TTS 状态、网易云状态摘要。
- [ ] `GET /api/debug/netease-auth` 显示 Cookie 可用、账号已登录。
- [ ] `favorites` 表有歌曲数据。
- [ ] `GET /api/profile` 返回非空 `profile`。

### 播放闭环

- [ ] 前端打开 `http://localhost:5173`。
- [ ] 点击 `JOIN RADIO` 后 Socket 连接成功。
- [ ] 收到 `session:ready`。
- [ ] 收到 `dj:message` 开场或状态。
- [ ] 收到 `track:new`，包含 `song_name/artist/songUrl/intro`。
- [ ] 有 `introAudioUrl` 时先播 DJ 语音；没有时直接播歌。
- [ ] 音乐结束后自动触发下一首。
- [ ] 发送“想听点雨天的”后，下一首方向发生变化。

### 降级场景

- [ ] TTS 失败不阻断播放。
- [ ] 网易云歌曲不可播放时自动换候选。
- [ ] AI JSON 解析失败最多重试一次，并返回可恢复错误。
- [ ] Socket 断线后前端显示状态，并尝试重连。

---

## 16. 给后续开发者的关键交接 notes

- 当前目录不是 Git 仓库，无法用 commit hash 追踪版本；建议后续先初始化 Git 或放入已有仓库。
- 不要直接提交 `backend/.env`、`backend/src/data/netease.cookies.txt`、SQLite 数据库和临时音频。
- 真实推荐体验依赖三件事：网易云登录态、红心歌单同步、AI Key。任何一个缺失都会降级或失败。
- 一键启动默认读取 `backend/.env`，不要再把端口信息分散记在多个地方。
- `TTS_PROVIDER=none` 是最稳的调试模式；先跑通选曲和音乐播放，再打开 `auto/edge/minimax/elevenlabs`。
- 队列预取能提高切歌速度，但也会提前消耗 AI/TTS 调用；调试成本敏感时可以先走 `/api/radio/next` 或减少预取。
- 前端发送聊天目前默认 `requestNext: true`，也就是每句话都会影响下一首；如果想支持纯聊天，需要调整 `sendMessage()` 行为。

---

## 17. Docker 预备约定

- 当前轮次不交付完整 `docker-compose.yml`，但代码和启动入口已经按容器化友好方向整理。
- 后续 Compose 推荐拓扑：
  - `frontend`
  - `backend`
  - `netease-api`
- 推荐挂载目录：
  - `backend/src/data`
  - `backend/src/temp_audio`
- 环境变量约定：
  - 前端只关心 `VITE_BACKEND_URL`
  - 后端只关心 `NETEASE_API_URL`
  - SQLite 与临时音频目录继续通过 `DATABASE_PATH`、`TEMP_AUDIO_DIR` 控制
- 如果后续发现 Vite dev server 不适合作为容器常驻入口，下一步应切换到 `vite build + preview` 或静态托管，不在这一轮强行解决。

---

## 18. 更新规则

以后每次更新本文档时：

1. 先读取当前文档完整内容，再修改。
2. 先核对 `backend/package.json`、`frontend/package.json`、关键入口和日志，不凭记忆更新。
3. 明确区分 `Done`、`In Progress`、`Pending`。
4. 未验证的事项写 `To Be Confirmed`，不要写成已完成。
5. 如果改了代码，至少运行相关构建或测试；如果只改文档，至少确认文档中时间、版本、路径、命令准确。
6. 不写入真实密钥、Cookie、手机号或私有账号信息。

---

*Claudio — Your mood is my prompt. I hate algorithm. I have taste.*


