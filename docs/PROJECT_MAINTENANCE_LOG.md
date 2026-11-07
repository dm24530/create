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

### v0.2.43 - 2026-11-07

标签：`[图片工作台]` `[画布]` `[即时预览]` `[上游图片]`

需求：

- 上游已经返回图片后，用户不应继续等待后端下载完整原图、转码或本地保存。
- 画布不应在主线程下载并重新编码远程原图后才显示结果。
- 预览 URL 后续应能被稳定的本地预览替换，不能停留在一次性上游地址。

实现：

- 异步图片任务收到上游图片 JSON 后，若其中存在安全的外网图片 URL，立即发布为 `preview_ready`。
- 前端先显示上游预览，后端继续下载、校验、转码、保存本地原图并上传对象存储。
- 允许图片任务最多发布两次预览更新：第一次为上游临时 URL，第二次为生成的本地轻量预览。
- 外网预览仅允许 `http/https`，拒绝本地、私网、云元数据和包含凭据的地址，并移除对象键等内部字段。
- 画布检测到已有 `preview_data_url` 时直接渲染，不再先下载完整原图并重新编码；远程原图也不再阻塞节点显示。

涉及文件：

- `backend/internal/service/image_storage.go`
- `backend/internal/service/image_storage_test.go`
- `backend/internal/service/image_task.go`
- `canvas-app/src/services/api/image.ts`
- `canvas-app/src/lib/image-normalization-policy.ts`
- `frontend/src/features/infinite-canvas/__tests__/imageNormalization.spec.ts`
- `backend/cmd/server/VERSION`

验证：

- 图片服务与 Handler 相关 Go 测试通过。
- 画布图片规范化单元测试通过。
- 画布 `tsc --noEmit` 和生产构建通过。
- 图片工作台 `vue-tsc --noEmit` 通过。

迁移：

- 无数据库 schema 变更，无需历史数据回填。

遗留：

- 已部署环境需要重新构建并发布 `v0.2.43` 才会生效。

### v0.2.42 - 2026-11-07

标签：`[图片工作台]` `[本地预览]` `[任务轮询]` `[首屏显示]`

需求：

- 上游图片已经返回后，用户不应继续等待原图转码、本地落盘或 R2 上传完成。
- 图片任务完成后应尽快显示预览，而不是继续停留在“正在生成”状态。
- 减少异步图片任务轮询造成的固定额外等待时间。

实现：

- 收到上游图片字节并生成轻量预览后，立即发布 `preview_ready`，前端可直接显示预览图。
- 原图转码、本地保存和后续 R2 上传继续在后台进行，不再阻塞首张预览显示。
- 预览任务结果主动移除 `display_url`、`local_asset_id`、`object_key` 和原始 `b64_json`，避免泄露本地地址或携带大体积原始数据。
- 异步图片轮询从 5 秒渐进加速改为固定 750 毫秒；瞬时错误重试使用 1 秒间隔。

涉及文件：

- `backend/internal/service/image_storage.go`
- `backend/internal/service/image_storage_test.go`
- `frontend/src/features/image-studio/imagePolling.ts`
- `frontend/src/features/image-studio/__tests__/imagePolling.spec.ts`
- `backend/cmd/server/VERSION`

验证：

- `go test ./internal/service -run Image -count=1` 通过。
- 前端图片工作台测试 `136` 项通过。
- `vue-tsc --noEmit` 通过。
- 本地 `create-dev` 重新构建并由健康检查确认可用。

迁移：

- 无数据库 schema 变更，无需历史数据回填。

遗留：

- R2 凭证仍返回 `401 Unauthorized`；即时预览不受影响，但云端持久化和本地文件过期后的原图回源仍需更新凭证。

### v0.2.41 - 2026-11-06

标签：`[图片工作台]` `[本地预览]` `[原图下载]` `[R2]` `[视频工作台]` `[MiniMax H3]` `[静态资源]`

需求：

- 图片生成后需要立即显示，前端普通展示只使用轻量预览图，下载时才读取原图。
- 原图上传 R2 成功前不能向公开任务结果暴露本地地址或未发布链接。
- R2 鉴权失败不能造成后台重试风暴，GIF 预览必须继续保留动画。
- 视频工作台需要支持 MiniMax H3 的 OpenAI 兼容异步视频任务。
- 首页和静态资源需要减少传输体积和首屏等待时间。

实现：

- 异步图片任务先保存本地原图并返回 `preview_data_url`；任务状态区分本地可用的 `ready` 和 R2 已发布的 `completed`。
- 新增需要用户或 API Key 鉴权的原图接口；本地原图过期后可按任务元数据回源 R2。
- 公开任务结果隐藏 `local_asset_id`、`display_url` 和 R2 发布前的 `url`，避免泄露本地地址。
- 原图上传 R2 后保留十分钟本地宽限；R2 401/403 暂停十分钟，普通失败使用指数退避。
- GIF 预览改为缩放后的多帧动画 GIF，保留帧延迟和循环次数；普通透明图片输出 PNG，其余输出 JPEG。
- Gallery 待上传作品优先读取本地原图，避免 R2 未完成时缩略图不可用。
- 增加 MiniMax H3 视频任务创建、状态和内容接口，并在视频工作台接入参考图、参考视频、参考音频和时长参数。
- 对嵌入式 JS、CSS、JSON、SVG、XML 增加 Brotli/Gzip 缓存响应，为首页 Hero 图片增加预加载和稳定资源缓存策略。

涉及文件：

- `backend/internal/handler`
- `backend/internal/service`
- `backend/internal/repository`
- `backend/internal/server/routes`
- `backend/internal/web`
- `frontend/src/features/image-studio`
- `frontend/src/features/video-studio`
- `frontend/src/utils/imageGenerationWorker.ts`
- `backend/cmd/server/VERSION`

验证：

- `go test ./internal/service ./internal/handler ./internal/repository ./internal/web` 通过。
- `go test ./internal/handler -run 'Image|Usage'` 通过。
- `go test ./internal/repository -run ImageTask` 通过。
- 前端类型检查、图片工作台与视频工作台共 `113` 项测试通过。
- 前端生产构建通过。

迁移：

- 无数据库 schema 变更，无需历史数据回填。
- 已发布版本的旧任务继续按原有 R2 链接读取；新任务使用本地原图加预览流程。

遗留：

- 需要更新无效的 R2 凭证；仅剩 R2 地址且凭证无效的历史图片仍会返回 401。

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
