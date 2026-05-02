# Deep Radio

AI DJ 电台项目。目标是把「推荐歌曲 + DJ 主持词 + 语音播报 + 实时互动」做成可持续运行的本地产品原型，而不是一次性 Demo。

## 项目亮点

- 多服务闭环：前端实时交互、后端编排、音乐能力、AI 决策、TTS 播报。
- 本地一键启动：根目录 `npm run dev` 统一拉起服务。
- 可观测性增强：`/api/debug/status` + `npm run status/doctor`，快速定位环境与数据状态。
- 低成本策略：用户画像持久化复用，按需刷新，减少无效模型调用。

## 架构概览

- 前端（React + Vite）：展示播放状态、DJ Feed、聊天输入、音频播放控制。
- 后端（Express + Socket.io）：会话状态机、选曲编排、异常降级、调试接口。
- 音乐层（NeteaseCloudMusicApi）：曲目检索、播放链接、登录态依赖。
- AI 层（OpenAI-compatible）：画像分析、候选选曲、DJ 文案、聊天响应。
- TTS 层（MiniMax / ElevenLabs / Edge / none）：支持多 provider 和失败降级。

## 大模型应用方式

这个项目不是把大模型当“问答机器人”，而是把模型放进业务链路：

- 长期偏好建模：基于红心歌单生成 `music_profile`。
- 实时选曲决策：结合时间段、历史播放、用户消息生成候选歌曲。
- 主持词生成：在歌曲可播放校验后生成可播报 DJ 文案。
- 对话驱动播放：用户聊天可触发下一首方向调整。

## 快速开始

### 1) 先准备配置

后端配置文件：`backend/.env`

至少确认：

- `NETEASE_API_URL`（例如 `http://localhost:3000`）
- `FAVORITE_PLAYLIST_ID`
- `NETEASE_COOKIE` 或 `NETEASE_COOKIE_FILE`
- `AI_API_KEY`

### 2) 安装依赖（首次）

```bash
cd NeteaseCloudMusicApi && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

### 3) 一键启动

```bash
cd E:\GPT\deep-radio
npm run dev
```

启动后访问：

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:4000/health`

## 常用命令

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
npm run sync:favorites
npm run profile:analyze
```

前端：

```bash
cd frontend
npm run build
```

## 调试与诊断

- `GET /api/debug/status`：聚合返回 backend / netease / data / tts 状态。
- `GET /api/debug/netease-auth`：检查网易云登录态与 cookie 摘要。
- `GET /api/debug/radio-queue`：查看 session 队列状态。

推荐排障顺序：

1. `npm run doctor`
2. 看 `netease reachable` / `netease login`
3. 看 `favorites`、`music profile` 是否可用

## 数据与安全

- 本地数据库：SQLite（默认在 `backend/src/data/`）。
- 不要提交 `.env`、cookie、数据库文件和临时音频。
- 根目录 `.gitignore` 已包含常见敏感/产物规则。

## 现阶段定位

当前是“可本地反复使用的 AI 电台原型”，优先目标是稳定可用与低调试成本。下一步建议方向是容器化编排（Docker Compose）、自动化测试和推荐策略增强。
