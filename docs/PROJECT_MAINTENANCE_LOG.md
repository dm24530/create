# Create 项目维护日志

本文件记录项目当前技术栈、用户需求、实现结果、验证方式、迁移和遗留问题。
后续维护时优先在本文搜索功能标签、模型名、接口路径或版本号。

## 使用约定

- 每次功能提交增加一条记录。
- 每条记录必须包含：需求、实现、涉及文件、迁移、验证、遗留问题。
- 标签使用方括号，例如 `[图片成本]`、`[SEO]`、`[图片工作台]`。
- 已发布版本使用 Git tag；不要修改已经发布的日志结论。
- 历史数据是否需要回填必须明确写出。

## 当前技术栈

| 模块 | 技术 |
| --- | --- |
| 后端 | Go 1.27.2、Gin、Ent、Wire |
| 前端 | Vue 3、Vite、Pinia、TailwindCSS、vue-i18n |
| Canvas | React、Vite、Ant Design、Zustand、React Router |
| 数据库 | PostgreSQL |
| 缓存与队列 | Redis |
| 媒体存储 | S3 / Cloudflare R2 / OSS / MinIO |
| 容器部署 | Docker、Docker Compose、Caddy |
| 后端测试 | Go testing、testify |
| 前端测试 | Vitest、Vue Test Utils、Playwright（按需） |
| 包管理 | pnpm / npm |

## 关键入口

- `backend/cmd/server`：服务启动和 Wire 依赖图。
- `backend/internal/server/routes`：公开 API、用户 API 和管理端路由。
- `backend/internal/service`：网关、计费、调度、图片、视频和业务逻辑。
- `backend/internal/repository`：PostgreSQL、Redis、对象存储和上游请求。
- `backend/migrations`：数据库 schema 的唯一权威来源。
- `frontend/src/features/image-studio`：图片工作台和异步图片任务。
- `frontend/src/features/video-studio`：视频工作台和视频作品。
- `frontend/src/views/admin`：管理后台。
- `backend/internal/web`：内嵌前端、SEO、静态资源和 HTML 缓存。

## 当前支持的主要协议

| 协议 | 入口 |
| --- | --- |
| OpenAI Chat Completions | `/v1/chat/completions` |
| OpenAI Responses | `/v1/responses` |
| OpenAI Images | `/v1/images/generations`、`/v1/images/edits` |
| 异步图片任务 | `/v1/images/generations/async`、`/v1/images/tasks/{id}` |
| Grok / OpenAI 兼容视频 | `/v1/videos`、`/v1/videos/generations` |
| Seedance 自定义视频 | `/v1/video/generations`、`/v1/videos/{id}` |
| Seedance/Ark 原生任务 | `/api/v3/contents/generations/tasks` |
| Anthropic | `/v1/messages`、`/v1/messages/count_tokens` |
| Gemini | `/v1beta/models/*` |

## 变更记录

### v0.2.37 - 2026-11-03

标签：`[图片工作台]` `[轮询]` `[错误处理]` `[运维日志]`

需求：

- 图片生成时，前端前期轮询不应比后期更频繁。
- 5～10 秒内通常不会返回 2K 图片，前期应低频，接近常见完成时间后再加密。
- 修复后台错误记录中假 500、重复错误、空请求体继续请求上游的问题。

实现：

- 新增图片任务轮询策略 `imagePolling.ts`。
- 0～5 秒等待 5 秒，5～15 秒每 2.5 秒，15～30 秒每 1.5 秒。
- 30～60 秒每 1 秒，60 秒后每 0.75 秒。
- 预览已经出现后，以 0.75 秒检查最终原图。
- 网络错误保持最多 2 秒重试一次，避免故障时等待过久。
- 前端网关任务错误改为 `ImageGatewayTaskError`，保留真实 HTTP 状态码。
- 服务端已经记录的异步任务失败，不再由浏览器重复上报。
- 参考图快照丢失只显示用户警告，不再记录为 HTTP 500。
- 客户端超时记为 504，网络错误记为 499，普通客户端校验记为 400。
- 异步图片任务恢复时，如果请求 Body 为空，本地直接失败并记 400，不再请求上游。

涉及文件：

- `frontend/src/features/image-studio/ImageStudioView.vue`
- `frontend/src/features/image-studio/imagePolling.ts`
- `frontend/src/features/image-studio/__tests__/ImageStudioView.spec.ts`
- `frontend/src/features/image-studio/__tests__/imagePolling.spec.ts`
- `backend/internal/handler/image_task_handler.go`
- `backend/internal/handler/image_task_handler_test.go`

验证：

```powershell
cd backend
go test ./internal/handler -run 'TestBuildClientImageErrorEntry|TestNewImageTaskContext|TestReportClientImageError|TestAsyncImageHandler'

cd ../frontend
npm run test -- --run src/features/image-studio/__tests__/imagePolling.spec.ts src/features/image-studio/__tests__/ImageStudioView.spec.ts
npm run typecheck
```

遗留：

- 数据库中的历史错误不会自动修改，只影响修复后的新请求。
- 旧错误仍可能显示假 500，需要单独清理或按时间筛选。
- 普通网络错误的去重仍依赖前端内存，页面刷新后可能再次上报。
- BotCF 视频接口仍需专用适配，见下方“已知限制”。

### v0.2.36 - 2026-11-02

标签：`[图片成本]` `[利润]` `[模型广场]` `[SEO]` `[管理后台]`

需求：

- 管理员需要为 1K、2K、4K 图片分别设置成本价，并与售价、利润、利润率一起查看。
- 普通用户不能看到成本价。
- 模型广场点击模型名或复制按钮可以复制完整模型名。
- 站点主品牌保持 Create，同时支持 `libTV`、`CreateAI` 等搜索别名。
- 提升 Google/Bing 对首页和模型广场的抓取能力。

实现：

- 分组增加 `image_cost_price_1k`、`image_cost_price_2k`、`image_cost_price_4k`。
- 管理员分组界面增加成本价以及售价、成本、利润、利润率预览。
- 新图片用量按配置成本计算账号成本，支持混合分辨率。
- 管理员用量明细显示“成本 $x”，普通用户接口不返回成本字段。
- API Key 鉴权缓存加入成本字段并升级缓存版本。
- 模型广场的模型名和复制按钮都支持复制。
- GroupsView 拆出组合路由弹窗和排序弹窗。
- 站点设置增加 SEO 品牌别名，默认 `libTV,LibTV,libtv,CreateAI`。
- 首页、模型广场的 title、description、keywords、JSON-LD 使用动态站名和别名。
- 增加服务端可抓取正文，`/` canonical 统一到 `/home`。
- sitemap 移除重复根路径。

迁移：

- `backend/migrations/270_group_image_cost_pricing.sql`
- 用户明确要求不做历史成本回填。

验证：

- 后端 service、handler、DTO、Web SEO 测试通过。
- 前端类型检查、设置页、模型广场、用量表、i18n 和 SEO 测试通过。
- 前端生产构建通过，并确认内嵌 HTML 包含品牌别名和可抓取正文。

### v0.2.35 - 2026-11-02

标签：`[图片工作台]` `[作品持久化]` `[余额重试]`

实现：

- 图片生成结果持久化到作品存储。
- 停止不安全的余额重试行为。

## 已知限制

### BotCF Seedance 视频

状态：暂未支持直接接入。

BotCF 文档使用：

- `POST /v1/video/generate`
- `GET /v1/video/tasks/{id}`
- `GET /v1/videos/{id}/content`

当前项目使用：

- `POST /v1/video/generations`
- `GET /v1/videos/{id}`

创建和查询路径不同，不能只填写 Base URL 和 API Key。接入时需要增加 BotCF
专用适配：

- 创建路径映射。
- 状态值归一化。
- `task.outputs[0]` 结果解析。
- `(token)` 与 `(time)` 模型计费映射。

### OpenCode 相关配置

API Key 只保存在浏览器本地，不要提交到仓库或写入文档。

## 维护检查清单

功能修改：

- `git status --short --branch`
- `git diff --check`
- 后端相关包测试。
- 前端 `npm run typecheck`。
- 前端相关 Vitest。
- 涉及生产资源时执行前端构建。

数据库：

- 新 schema 必须使用新的 `backend/migrations` 文件。
- 不修改已发布迁移。
- 明确是否回填历史数据。

发布：

- 提交代码。
- 创建连续 Git tag。
- 打包并记录 SHA256。
- 在服务器校验 checksum 后升级。
- 验证首页、模型广场、图片任务和错误日志。
