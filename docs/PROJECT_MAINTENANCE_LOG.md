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

### v0.2.40 - 2026-11-05

标签：`[图片工作台]` `[GIF]` `[使用记录]` `[图片链接]`

需求：

- 从右上角使用记录打开的图片链接必须展示原始动态 GIF，不能返回 JPEG 静态预览。

实现：

- 异步图片任务记录使用记录图片链接时，若原图或对象键为 GIF，则保存原始链接而不是 `preview_data_url`。
- 使用记录图片接口在返回静态预览前，优先读取本地原始 GIF。
- 新增按对象键查找本地图片元数据，历史记录无需重新生成即可恢复原始 GIF。
- 非 GIF 图片仍保留原有 JPEG 预览快速打开行为。

涉及文件：

- `backend/internal/handler/image_task_handler.go`
- `backend/internal/handler/image_task_handler_test.go`
- `backend/internal/handler/usage_handler.go`
- `backend/internal/handler/usage_handler_image_link_test.go`
- `backend/internal/handler/wire.go`
- `backend/internal/service/local_image_asset_store.go`
- `backend/cmd/server/VERSION`

验证：

- `go test ./internal/handler -count=1` 通过。
- `GET /api/v1/usage-images/6c45a1a00c8e4cde97ca56412d3cc030` 返回 `image/gif`。
- 返回文件大小 `869556` 字节，文件头为 `GIF89a`，共 `9` 帧。

迁移：

- 无数据库 schema 变更。
- 历史记录通过 `object_key` 回查本地原始文件，无需历史数据回填。

### v0.2.39 - 2026-11-05

标签：`[图片工作台]` `[GIF]` `[gpt-image-2-6]` `[数据库]` `[临时作品]`

需求：

- 图片工作台需要支持 `gpt-image-2-6` 的 GIF 输出，避免结果始终显示为静图。
- PostgreSQL 临时作品过期时间清理不应出现 `text * interval` 类型错误。

实现：

- 仅当模型名包含 `gpt-image-2-6` 时显示 GIF 格式选项，切换其他模型时自动回退 PNG。
- OpenAI Images 请求继续透传 `output_format: gif`。
- 同步图片响应可从 `output_format` 识别 GIF，并用 `image/gif` 构造 Base64 数据 URL。
- GIF 结果卡片优先展示原图，不再使用后端 JPEG 静态缩略图；GIF 跳过本地 Canvas 尺寸处理，避免动图被压成首帧。
- 后端 OpenAI 图片 MIME 映射补充 `gif`，图片存储保留 GIF 字节与 `.gif` 对象键。
- `studio_works` 临时过期时间 SQL 为保留时长参数显式添加 `::bigint`，修复 PostgreSQL 无法执行 `text * interval` 的问题。

涉及文件：

- `frontend/src/features/image-studio/ImageStudioView.vue`
- `frontend/src/features/image-studio/__tests__/ImageStudioView.spec.ts`
- `backend/internal/service/openai_images_responses.go`
- `backend/internal/service/openai_images_test.go`
- `backend/internal/service/image_storage.go`
- `backend/internal/service/image_storage_test.go`
- `backend/internal/repository/studio_works_store.go`
- `backend/internal/repository/studio_works_store_test.go`
- `backend/cmd/server/VERSION`

验证：

- 前端图片工作台测试 `107` 项通过。
- `vue-tsc --noEmit` 通过。
- 前端生产构建通过。
- `go test ./internal/service` 全量通过。
- `go test ./internal/handler -run Image` 通过。
- PostgreSQL 临时作品过期时间参数类型测试通过。
- `9897` 容器替换后健康检查、公开设置接口和管理员登录均通过。

迁移：

- 无数据库 schema 变更，无需历史数据回填。

遗留：

- 若使用第三方网关的 `gpt-image-2.6`，需要在管理员端把公开模型 `gpt-image-2-6` 映射到实际上游模型名并加入创作分组。

### v0.2.38 - 2026-11-05

标签：`[Gemini]` `[请求头覆写]` `[GPT图片]` `[图片工作台]` `[Docker]`

需求：

- GPT 图片模型选择高、中、低质量时，同步切换到 4K、2K、1K 尺寸档位。
- Gemini API Key 账号需要支持第三方网关所需的 Header Override。
- 本地 Docker 启动应显示当前发布版本，不能回退到旧 `VERSION`。

实现：

- GPT 图片质量与尺寸联动：
  - 高 → 4K 档
  - 中 → 2K 档
  - 低 → 1K 档
- `1:1` 高画质受上游总像素上限约束，实际为 `2880x2880`。
- `16:9` 高画质实际为 `3840x2160`。
- GPT 尺寸预设反向同步质量按钮。
- Gemini API Key 账号加入 Header Override 资格。
- Gemini Chat Completions、Messages、原生 GET 和上游模型同步都会应用自定义请求头。
- 管理员同步模型预览支持传入 Header Override。
- 前端 Gemini API Key 账号支持提交 Header Override。
- Docker 构建参数 `VERSION/COMMIT/DATE` 移到最终编译步骤，避免改版本导致依赖层重建。
- Alpine 软件源切换为阿里云镜像。
- `backend/cmd/server/VERSION` 与发布 tag 同步。

涉及文件：

- `frontend/src/features/image-studio/ImageStudioView.vue`
- `frontend/src/features/image-studio/__tests__/ImageStudioView.spec.ts`
- `backend/internal/service/account_header_override.go`
- `backend/internal/service/gemini_chat_completions_compat_service.go`
- `backend/internal/service/gemini_messages_compat_service.go`
- `backend/internal/service/upstream_models.go`
- `backend/internal/handler/admin/account_handler.go`
- `frontend/src/components/account/CreateAccountModal.vue`
- `frontend/src/components/account/credentialsBuilder.ts`
- `Dockerfile`
- `backend/cmd/server/VERSION`

验证：

- 图片工作台测试 `106` 项通过。
- Gemini Header Override 服务测试通过。
- 管理员同步上游模型请求头测试通过。
- 前端凭据构建测试 `72` 项通过。
- `vue-tsc --noEmit` 通过。
- 本地 `0.2.37` 验证完成后升级到 `0.2.38` 发布。

遗留：

- BotCF 视频仍需专用接口适配。
- Dockerfile 和 VERSION 的本地修复需要随本版本发布。

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
