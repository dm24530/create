<template>
  <div class="api-docs-page">
    <header class="docs-topbar">
      <div class="docs-topbar__identity">
        <RouterLink to="/image-studio" class="docs-topbar__brand">
          {{ appStore.siteName || 'Create' }}
        </RouterLink>
        <span class="docs-topbar__separator">/</span>
        <span class="docs-topbar__current">接口文档</span>
      </div>
      <div class="docs-topbar__actions">
        <button
          type="button"
          class="docs-topbar__icon"
          :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
          :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
          @click="toggleTheme"
        >
          <Icon :name="isDark ? 'sun' : 'moon'" size="sm" :class="isDark ? 'text-amber-500' : ''" />
        </button>
        <RouterLink to="/image-studio" class="docs-topbar__back">
          <Icon name="arrowLeft" size="xs" />
          <span>返回工作台</span>
        </RouterLink>
      </div>
    </header>

    <div class="api-docs">
      <header class="docs-hero">
        <div class="docs-hero__copy">
          <p class="docs-eyebrow">CREATE API REFERENCE</p>
          <h1>接口文档</h1>
          <p>
            使用 API 生成图片、编辑图片、创建视频任务并下载结果。文档中的 Base URL、
            请求结构、异步任务流程和错误格式可以直接用于后端服务与自动化脚本。
            本文档无需登录即可阅读；实际调用接口仍需要有效的 API Key。
          </p>
        </div>
        <div class="docs-base">
          <span class="docs-base__label">你的 Base URL</span>
          <code>{{ apiBaseUrl }}</code>
          <button type="button" class="docs-base__copy" @click="copyBaseUrl">
            <Icon :name="baseCopied ? 'check' : 'copy'" size="xs" />
            <span>{{ baseCopied ? '已复制' : '复制' }}</span>
          </button>
        </div>
      </header>

      <div class="docs-layout">
        <aside class="docs-sidebar">
          <p class="docs-sidebar__title">目录</p>
          <nav aria-label="接口文档目录">
            <a v-for="item in navSections" :key="item.id" :href="`#${item.id}`">{{ item.label }}</a>
          </nav>
          <div class="docs-sidebar__links">
            <router-link :to="{ path: '/image-studio', query: { openApiKeys: '1' } }">创建 API 密钥</router-link>
            <router-link :to="{ path: '/image-studio', query: { openModelPlaza: '1' } }">查看模型价格</router-link>
            <button type="button" class="docs-sidebar__manual-link" @click="manualModalOpen = true">
              查看图片、视频与画布使用手册
            </button>
          </div>
        </aside>

        <main class="docs-main">
          <section id="overview" class="doc-section">
            <p class="doc-section__eyebrow">Overview</p>
            <h2>接口概览</h2>
            <p>
              Create 的图片统一使用 OpenAI Images 兼容入口，平台可以是 OpenAI、Gemini、
              Grok 或 Composite；视频使用 Grok Video 或 Seedance 异步任务接口。长图片任务
              建议使用异步接口，视频必须先创建任务，再轮询状态并下载内容。
            </p>
            <div class="docs-callout">
              <strong>先确认三件事</strong>
              <span>API Key 属于哪个分组、分组开放了哪些模型、客户端最终请求的是哪个端点。</span>
            </div>
            <div class="docs-grid docs-grid--three">
              <div class="docs-mini">
                <span>认证方式</span>
                <strong>Bearer / x-api-key</strong>
                <p>推荐始终使用 Authorization: Bearer。</p>
              </div>
              <div class="docs-mini">
                <span>数据格式</span>
                <strong>JSON + 异步任务</strong>
                <p>图片可能返回 URL 或 base64；视频通过 request_id/task_id 轮询。</p>
              </div>
              <div class="docs-mini">
                <span>计费方式</span>
                <strong>按实际请求结算</strong>
                <p>详见使用记录中的 Token、单价和实际费用。</p>
              </div>
            </div>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>分组平台</th>
                    <th>图片入口</th>
                    <th>常见返回</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>OpenAI / Grok / Composite</td>
                    <td><code>/images/generations</code>、<code>/images/edits</code></td>
                    <td><code>url</code> 或 <code>b64_json</code>，以实际模型为准。</td>
                  </tr>
                  <tr>
                    <td>Gemini</td>
                    <td><code>/images/generations</code>，或原生 <code>/v1beta/models/{model}:generateContent</code></td>
                    <td>
                      响应同时包含 URL 和 <code>inlineData</code> 时优先 URL；只有
                      <code>inlineData</code> 时返回 <code>b64_json</code>。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="quickstart" class="doc-section">
            <p class="doc-section__eyebrow">Quick Start</p>
            <h2>五分钟开始调用</h2>
            <ol class="docs-steps">
              <li>
                <span class="docs-steps__no">1</span>
                <div>
                  <strong>创建 API 密钥</strong>
                  <p>
                    打开
                    <router-link :to="{ path: '/image-studio', query: { openApiKeys: '1' } }">工作台 API 密钥弹窗</router-link>
                    ，创建密钥并复制完整的 <code>sk-...</code> 内容。不要把密钥写进前端代码或公开仓库。
                  </p>
                </div>
              </li>
              <li>
                <span class="docs-steps__no">2</span>
                <div>
                  <strong>选择可用模型</strong>
                  <p>
                    打开
                    <router-link :to="{ path: '/image-studio', query: { openModelPlaza: '1' } }">模型广场弹窗</router-link>
                    复制完整模型名。模型必须与密钥所属分组的能力匹配，否则会返回模型不存在或无权访问。
                  </p>
                </div>
              </li>
              <li>
                <span class="docs-steps__no">3</span>
                <div>
                  <strong>确认 Base URL</strong>
                  <p>
                    本站的 OpenAI 兼容 Base URL 是
                    <code>{{ apiBaseUrl }}</code>
                    。图片路径直接拼在它后面，例如 <code>{{ apiBaseUrl }}/images/generations</code>。
                  </p>
                </div>
              </li>
              <li>
                <span class="docs-steps__no">4</span>
                <div>
                  <strong>先校验图片模型</strong>
                  <p>先用一张简单图片确认认证、模型名和尺寸都正确，再接入图片编辑或视频异步任务。</p>
                </div>
              </li>
            </ol>
            <DocCodeBlock title="Check authentication" language="bash" :code="snippets.modelsCurl" />
          </section>

          <section id="authentication" class="doc-section">
            <p class="doc-section__eyebrow">Authentication</p>
            <h2>认证与请求头</h2>
            <p>图片、视频、模型和计费接口都需要创作 API Key，推荐统一使用 Bearer 请求头。</p>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>请求头</th>
                    <th>示例</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>Authorization</code></td>
                    <td><code>Bearer sk-...</code></td>
                    <td>OpenAI SDK 和大多数客户端的标准方式。</td>
                  </tr>
                  <tr>
                    <td><code>Content-Type</code></td>
                    <td><code>application/json</code></td>
                    <td>除文件上传和多段表单外，JSON 接口都需要。</td>
                  </tr>
                  <tr>
                    <td><code>x-api-key</code></td>
                    <td><code>sk-...</code></td>
                    <td>兼容部分客户端；与 Bearer 二选一。</td>
                  </tr>
                  <tr>
                    <td><code>x-goog-api-key</code></td>
                    <td><code>sk-...</code></td>
                    <td>Gemini 原生 SDK/CLI 兼容方式。</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="docs-callout docs-callout--warning">
              <strong>不要通过 URL 查询参数传递密钥</strong>
              <span>Query 中的 key/api_key 已被拒绝。请使用请求头，避免密钥进入访问日志、浏览器历史和代理记录。</span>
            </div>
            <DocCodeBlock title="Authentication headers" language="http" :code="snippets.authHeaders" />
          </section>

          <section id="base-url" class="doc-section">
            <p class="doc-section__eyebrow">Base URL</p>
            <h2>Base URL 与路径规则</h2>
            <p>
              服务端拼接请求地址时，统一使用 <code>{{ apiBaseUrl }}</code> 作为前缀。
              图片、视频和模型列表都从同一个 Base URL 派生。
            </p>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>客户端类型</th>
                    <th>填写方式</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>图片 API</td>
                    <td><code>{{ apiBaseUrl }}</code></td>
                  </tr>
                  <tr>
                    <td>只接受 Host 与 Path 的客户端</td>
                    <td>Host 填站点根地址，Path 填 <code>/v1</code></td>
                  </tr>
                  <tr>
                    <td>直接使用 curl / HTTP</td>
                    <td><code>{{ apiBaseUrl }}/images/generations</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="endpoints" class="doc-section">
            <p class="doc-section__eyebrow">Endpoints</p>
            <h2>端点一览</h2>
            <p>实际可用端点取决于 API Key 所属分组和平台能力。未开放的端点会返回明确的 404 或权限错误。</p>
            <div class="docs-table-wrap">
              <table class="docs-table docs-table--endpoints">
                <thead>
                  <tr>
                    <th>方法</th>
                    <th>路径</th>
                    <th>用途</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="endpoint in endpoints" :key="`${endpoint.method}-${endpoint.path}`">
                    <td><span class="docs-method">{{ endpoint.method }}</span></td>
                    <td><code>{{ endpoint.path }}</code></td>
                    <td>{{ endpoint.description }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="models" class="doc-section">
            <p class="doc-section__eyebrow">Models</p>
            <h2>获取图片与视频模型</h2>
            <p>
              使用模型列表确认当前密钥可访问的模型。返回格式兼容 OpenAI 的
              <code>object=data</code> 与 <code>data[]</code> 结构。请只选择名称中包含图片或视频能力的模型，
              并把完整模型名用于对应请求。
            </p>
            <DocCodeBlock title="GET /models" language="bash" :code="snippets.modelsCurl" />
            <DocCodeBlock title="Response" language="json" :code="snippets.modelsResponse" />
          </section>

          <section id="images" class="doc-section">
            <p class="doc-section__eyebrow">Images</p>
            <h2>文本生成图片</h2>
            <p>
              <code>POST /images/generations</code> 用于文生图。图片接口按 API Key
              所属平台开放，OpenAI、Gemini、Grok 和 Composite 分组均可根据模型能力使用；
              长任务或高并发任务建议使用异步接口。
            </p>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>model</code></td>
                    <td>图片模型完整名称，必须来自当前 API Key 可用的模型列表。</td>
                  </tr>
                  <tr>
                    <td><code>prompt</code></td>
                    <td>描述主体、场景、构图、光线和风格。</td>
                  </tr>
                  <tr>
                    <td><code>size</code></td>
                    <td>图片尺寸，例如 1024x1024。模型不支持的尺寸会返回参数错误。</td>
                  </tr>
                  <tr>
                    <td><code>quality</code></td>
                    <td>可选 low / medium / high / auto，实际支持范围取决于模型。</td>
                  </tr>
                  <tr>
                    <td><code>background</code></td>
                    <td>可选 transparent / opaque / auto，支持透明背景的模型才能生效。</td>
                  </tr>
                  <tr>
                    <td><code>n</code></td>
                    <td>生成数量。建议先设为 1 验证提示词。</td>
                  </tr>
                  <tr>
                    <td><code>response_format</code></td>
                    <td>
                      OpenAI/Grok 等原生图片模型可尝试 b64_json 或 url；Gemini
                      响应有 URL 时优先保留 URL，没有 URL 时使用 b64_json/inlineData；
                      response_format=url 不保证让 Google 强制返回 URL。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="docs-callout docs-callout--warning">
              <strong>客户端必须同时处理 URL 和 base64</strong>
              <span>
                不要假设 response_format=url 一定会返回 URL。若响应只有
                <code>b64_json</code>，请由客户端解码后保存；若只有 <code>url</code>，请立即下载，
                临时链接可能会过期。
              </span>
            </div>
            <DocCodeBlock title="Generate an image" language="bash" :code="snippets.imagesCurl" />
            <DocCodeBlock title="Image response" language="json" :code="snippets.imagesResponse" />
          </section>

          <section id="image-edits" class="doc-section">
            <p class="doc-section__eyebrow">Image Edits</p>
            <h2>参考图编辑</h2>
            <p>
              有参考图时使用 <code>POST /images/edits</code>，通常通过
              <code>multipart/form-data</code> 上传图片，再附带 prompt、model、size 等字段。
              提示词只描述需要改变的内容，并明确哪些主体、文字和构图必须保持不变。
            </p>
            <DocCodeBlock title="Edit an image" language="bash" :code="snippets.imageEditCurl" />
            <div class="docs-callout">
              <strong>异步与批量图片</strong>
              <span>
                长任务可提交到 <code>/images/generations/async</code> 或
                <code>/images/edits/async</code>，再查询 <code>/images/tasks/:task_id</code>。
                原图可通过 <code>/images/tasks/:task_id/content</code> 下载；批量任务使用
                <code>/images/batches</code>，再查询任务、条目和下载接口。异步图片依赖站点对象存储，
                未开启时端点可能返回 404。
              </span>
            </div>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>客户端处理</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>processing</code></td>
                    <td>继续轮询；不要立即重复提交。</td>
                  </tr>
                  <tr>
                    <td><code>preview_ready</code></td>
                    <td>可以先展示低清预览，同时继续轮询最终原图。</td>
                  </tr>
                  <tr>
                    <td><code>ready</code> / <code>completed</code></td>
                    <td>读取 result；原图可通过 result 中的 URL 或任务 content 端点获取。</td>
                  </tr>
                  <tr>
                    <td><code>failed</code></td>
                    <td>停止轮询并读取 error；不要无限重试同一个失败任务。</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <DocCodeBlock title="Async image task" language="bash" :code="snippets.imageAsyncCurl" />
            <DocCodeBlock title="Task response" language="json" :code="snippets.imageTaskResponse" />
            <div class="docs-callout">
              <strong>幂等提交</strong>
              <span>
                异步图片请求可以携带 <code>Idempotency-Key</code>。网络中断后可用
                <code>GET /images/tasks/by-idempotency/:key</code> 找回任务，避免重复扣费。
              </span>
            </div>
          </section>

          <section id="videos" class="doc-section">
            <p class="doc-section__eyebrow">Videos</p>
            <h2>创建视频任务</h2>
            <p>
              视频按模型族分为两条协议：Grok 使用
              <code>POST /videos/generations</code>；Seedance 使用
              <code>POST /contents/generations/tasks</code>。创建成功后保存返回的
              <code>request_id</code> 或 <code>task_id</code>，再轮询任务状态。
              参考图/视频字段要求使用服务端可访问的 URL；Create 当前没有面向外部客户的通用媒体上传端点，
              本地素材请先上传到你自己的对象存储或公网文件服务。
            </p>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>Grok</th>
                    <th>Seedance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>提示词</td>
                    <td><code>prompt</code></td>
                    <td><code>content[]</code> 中的 text 项</td>
                  </tr>
                  <tr>
                    <td>参考图</td>
                    <td><code>image[]</code>，每项为 <code>{ url }</code></td>
                    <td>content[] 中的 image_url 项，可带首帧/尾帧角色</td>
                  </tr>
                  <tr>
                    <td>时长</td>
                    <td><code>duration</code></td>
                    <td><code>duration</code></td>
                  </tr>
                  <tr>
                    <td>画质</td>
                    <td><code>resolution</code></td>
                    <td><code>resolution</code></td>
                  </tr>
                  <tr>
                    <td>画幅</td>
                    <td><code>aspect_ratio</code></td>
                    <td><code>ratio</code></td>
                  </tr>
                  <tr>
                    <td>生成音频</td>
                    <td>以模型能力为准</td>
                    <td><code>generate_audio</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <DocCodeBlock title="Grok video" language="bash" :code="snippets.grokVideoCurl" />
            <DocCodeBlock title="Seedance video" language="bash" :code="snippets.seedanceCurl" />
          </section>

          <section id="video-tasks" class="doc-section">
            <p class="doc-section__eyebrow">Video Tasks</p>
            <h2>轮询与下载视频</h2>
            <p>
              视频生成是异步任务。轮询直到状态为 succeeded/completed 或 failed。
              Grok 成功后可请求内容接口获取视频字节；Seedance 通常直接返回可访问的 video_url。
            </p>
            <DocCodeBlock title="Poll and download" language="bash" :code="snippets.videoTasksCurl" />
          </section>

          <section id="usage" class="doc-section">
            <p class="doc-section__eyebrow">Usage & Billing</p>
            <h2>用量与计费信息</h2>
            <p>
              可以用当前 API Key 查询自身用量和倍率信息。用量接口只做鉴权，不会因为余额耗尽而阻止查询历史记录。
            </p>
            <DocCodeBlock title="GET /usage" language="bash" :code="snippets.usageCurl" />
            <DocCodeBlock title="GET /sub2api/billing" language="bash" :code="snippets.billingCurl" />
          </section>

          <section id="errors" class="doc-section">
            <p class="doc-section__eyebrow">Errors</p>
            <h2>错误码与排查</h2>
            <p>
              网关错误通常返回 <code>error.type</code> 与 <code>error.message</code>。请记录响应头中的
              <code>X-Request-ID</code>，它可以帮助定位具体请求。
            </p>
            <DocCodeBlock title="Error response" language="json" :code="snippets.errorResponse" />
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>状态码</th>
                    <th>常见原因</th>
                    <th>处理方式</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in errorRows" :key="row.status">
                    <td><code>{{ row.status }}</code></td>
                    <td>{{ row.reason }}</td>
                    <td>{{ row.fix }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="best-practices" class="doc-section">
            <p class="doc-section__eyebrow">Best Practices</p>
            <h2>生产接入建议</h2>
            <ul class="docs-list">
              <li>API Key 只放在服务端环境变量或密钥管理服务中，不要提交到 Git。</li>
              <li>为不同业务创建独立密钥，便于统计用量、限制并发和单独禁用。</li>
              <li>对 429、500、502、503 使用指数退避重试；不要把 401、403、404 当成临时错误无限重试。</li>
              <li>视频任务要保存 request_id/task_id，处理轮询超时、失败状态和重复提交。</li>
              <li>图片数量和视频时长会直接影响费用，业务层应设置单次生成成本上限。</li>
              <li>上线前分别测试图片生成、图片编辑、视频创建、任务查询、余额不足和模型无权限。</li>
            </ul>
          </section>
        </main>
      </div>
    </div>
    <ManualQuickModal :show="manualModalOpen" @close="manualModalOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import DocCodeBlock from '@/components/docs/DocCodeBlock.vue'
import Icon from '@/components/icons/Icon.vue'
import ManualQuickModal from '@/components/docs/ManualQuickModal.vue'
import { useAppStore } from '@/stores/app'
import { resolveDocumentedApiBaseUrl } from '@/utils/apiEndpoint'
import { useClipboard } from '@/composables/useClipboard'
import { useTheme } from '@/composables/useTheme'

const appStore = useAppStore()
const { copyToClipboard } = useClipboard()
const { isDark, toggleTheme } = useTheme()
const apiBaseUrl = computed(() => resolveDocumentedApiBaseUrl(
  appStore.cachedPublicSettings?.api_base_url || appStore.apiBaseUrl,
  typeof window === 'undefined' ? '' : window.location.origin,
))
const baseCopied = ref(false)
const manualModalOpen = ref(false)
let baseTimer: ReturnType<typeof setTimeout> | null = null

const navSections = [
  { id: 'overview', label: '接口概览' },
  { id: 'quickstart', label: '五分钟开始' },
  { id: 'authentication', label: '认证与请求头' },
  { id: 'base-url', label: 'Base URL' },
  { id: 'endpoints', label: '端点一览' },
  { id: 'models', label: '图片/视频模型' },
  { id: 'images', label: '图片生成' },
  { id: 'image-edits', label: '图片编辑' },
  { id: 'videos', label: '视频生成' },
  { id: 'video-tasks', label: '视频任务' },
  { id: 'usage', label: '用量与计费' },
  { id: 'errors', label: '错误处理' },
  { id: 'best-practices', label: '生产建议' },
]

const endpoints = [
  { method: 'GET', path: '/models', description: '获取当前 API Key 可用的图片与视频模型。' },
  { method: 'POST', path: '/images/generations', description: '文本生成图片。' },
  { method: 'POST', path: '/images/edits', description: '参考图编辑图片。' },
  { method: 'POST', path: '/images/generations/async', description: '提交异步图片生成任务。' },
  { method: 'POST', path: '/images/edits/async', description: '提交异步图片编辑任务。' },
  { method: 'GET', path: '/images/tasks/:task_id', description: '查询异步图片任务。' },
  { method: 'GET', path: '/images/tasks/:task_id/content?index=0', description: '下载异步图片任务的原图。' },
  { method: 'GET', path: '/images/tasks/by-idempotency/:key', description: '用 Idempotency-Key 找回图片任务。' },
  { method: 'POST', path: '/images/batches', description: '提交批量图片任务。' },
  { method: 'GET', path: '/images/batches/:id', description: '查询批量图片任务。' },
  { method: 'GET', path: '/images/batches/:id/items', description: '查询批量图片任务条目。' },
  { method: 'GET', path: '/images/batches/:id/download', description: '下载批量图片结果压缩包。' },
  { method: 'POST', path: '/videos/generations', description: '创建视频生成任务，平台能力受限。' },
  { method: 'POST', path: '/contents/generations/tasks', description: '创建 Seedance 视频任务。' },
  { method: 'GET', path: '/videos/:request_id', description: '查询视频任务状态。' },
  { method: 'GET', path: '/contents/generations/tasks/:request_id', description: '查询 Seedance 视频任务。' },
  { method: 'GET', path: '/videos/:request_id/content', description: '下载 Grok 视频内容。' },
  { method: 'GET', path: '/usage', description: '查询当前 API Key 的用量。' },
  { method: 'GET', path: '/sub2api/billing', description: '查询当前 API Key 的计费信息。' },
]

const errorRows = [
  { status: '400', reason: '请求体缺失、JSON 格式错误、参数类型不对。', fix: '检查 Content-Type 和 JSON 字段，先发送最小合法请求。' },
  { status: '401', reason: 'API Key 缺失、无效、禁用或用户状态异常。', fix: '重新复制完整密钥，确认没有空格并检查密钥状态。' },
  { status: '403', reason: 'IP 限制、分组权限或客户端限制。', fix: '检查密钥 IP 白名单、分组能力和客户端限制配置。' },
  { status: '404', reason: '模型不存在、端点未开放或分组不支持该能力。', fix: '从模型页复制模型名，并确认分组支持对应端点。' },
  { status: '429', reason: '并发、RPM/TPM 或上游限流。', fix: '降低并发，读取 Retry-After，并使用指数退避。' },
  { status: '500', reason: '网关内部错误。', fix: '保留 X-Request-ID，稍后重试并联系管理员。' },
  { status: '502', reason: '上游响应异常或不可达。', fix: '换模型或稍后重试；持续出现时提供请求 ID。' },
  { status: '503', reason: '服务暂时不可用或认证服务过载。', fix: '延迟后重试，避免短时间高频重试。' },
]

const snippets = computed(() => {
  const base = apiBaseUrl.value
  return {
    authHeaders: `Authorization: Bearer $CREATE_API_KEY
Content-Type: application/json`,
    modelsCurl: `curl "${base}/models" \\
  -H "Authorization: Bearer $CREATE_API_KEY"`,
    modelsResponse: `{
  "object": "list",
  "data": [
    {
      "id": "your-model-name",
      "object": "model",
      "owned_by": "create"
    }
  ]
}`,
    imagesCurl: `curl "${base}/images/generations" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-image-model",
    "prompt": "一只白色陶瓷杯放在木质桌面上，清晨窗边柔光，商业摄影",
    "size": "1024x1024",
    "quality": "high",
    "background": "auto",
    "n": 1,
    "response_format": "b64_json"
  }'`,
    imagesResponse: `{
  "created": 1794473204,
  "data": [
    {
      "url": "https://your-site.example/api/v1/public/image-assets/...",
      "preview_url": "data:image/jpeg;base64,...",
      "mime_type": "image/jpeg",
      "width": 1024,
      "height": 1024
    }
  ]
}`,
    imageEditCurl: `curl "${base}/images/edits" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  -F "model=your-image-model" \\
  -F "prompt=保持商品外观不变，将背景替换为浅灰色摄影棚" \\
  -F "image=@reference.png" \\
  -F "size=1024x1024" \\
  -F "n=1"`,
    imageAsyncCurl: `curl "${base}/images/generations/async" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-20261112-001" \\
  -d '{
    "model": "your-image-model",
    "prompt": "一只白色陶瓷杯放在木质桌面上",
    "size": "1024x1024",
    "quality": "high",
    "n": 1
  }'

curl "${base}/images/tasks/TASK_ID" \\
  -H "Authorization: Bearer $CREATE_API_KEY"`,
    imageTaskResponse: `{
  "task_id": "imgtask_...",
  "status": "preview_ready",
  "result": {
    "data": [
      {
        "url": "data:image/jpeg;base64,...",
        "preview_url": "data:image/jpeg;base64,..."
      }
    ]
  }
}`,
    grokVideoCurl: `curl "${base}/videos/generations" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-grok-video-model",
    "prompt": "镜头缓慢推近一杯热咖啡，窗边自然光，电影感",
    "duration": 8,
    "resolution": "720p",
    "aspect_ratio": "16:9",
    "image": [
      { "url": "https://example.com/reference.png" }
    ]
  }'`,
    seedanceCurl: `curl "${base}/contents/generations/tasks" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-seedance-model",
    "content": [
      { "type": "text", "text": "人物从门口走进庭院，镜头缓慢跟随" },
      {
        "type": "image_url",
        "role": "first_frame",
        "image_url": { "url": "https://example.com/first-frame.png" }
      }
    ],
    "duration": 8,
    "resolution": "720p",
    "ratio": "16:9",
    "generate_audio": false
  }'`,
    videoTasksCurl: `# Grok
curl "${base}/videos/REQUEST_ID" \\
  -H "Authorization: Bearer $CREATE_API_KEY"

curl "${base}/videos/REQUEST_ID/content" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  --output result.mp4

# Seedance
curl "${base}/contents/generations/tasks/REQUEST_ID" \\
  -H "Authorization: Bearer $CREATE_API_KEY"`,
    usageCurl: `curl "${base}/usage" \\
  -H "Authorization: Bearer $CREATE_API_KEY"`,
    billingCurl: `curl "${base}/sub2api/billing" \\
  -H "Authorization: Bearer $CREATE_API_KEY"`,
    errorResponse: `{
  "error": {
    "type": "invalid_request_error",
    "message": "model is required"
  }
}`,
  }
})

async function copyBaseUrl() {
  const ok = await copyToClipboard(apiBaseUrl.value, 'Base URL 已复制')
  if (!ok) return
  baseCopied.value = true
  if (baseTimer) clearTimeout(baseTimer)
  baseTimer = setTimeout(() => {
    baseCopied.value = false
    baseTimer = null
  }, 1600)
}

onBeforeUnmount(() => {
  if (baseTimer) clearTimeout(baseTimer)
})
</script>

<style scoped>
.api-docs-page {
  min-height: 100dvh;
  width: 100%;
  background: rgb(247 247 246);
  color: rgb(30 41 59);
}

.docs-topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  height: 3.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid rgb(229 231 235);
  background: rgb(255 255 255 / 0.92);
  padding: 0 clamp(1rem, 4vw, 3rem);
  backdrop-filter: blur(14px);
}

.docs-topbar__identity,
.docs-topbar__actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
}

.docs-topbar__brand {
  overflow: hidden;
  color: rgb(15 23 42);
  font-size: 0.88rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docs-topbar__brand:hover {
  color: rgb(173 74 41);
}

.docs-topbar__separator {
  color: rgb(203 213 225);
}

.docs-topbar__current {
  color: rgb(100 116 139);
  font-size: 0.8rem;
  white-space: nowrap;
}

.docs-topbar__icon {
  display: inline-flex;
  height: 2rem;
  width: 2rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.45rem;
  color: rgb(100 116 139);
}

.docs-topbar__icon:hover {
  background: rgb(241 245 249);
  color: rgb(15 23 42);
}

.docs-topbar__back {
  display: inline-flex;
  height: 2rem;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.45rem;
  background: rgb(255 255 255);
  padding: 0 0.65rem;
  color: rgb(71 85 105);
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
}

.docs-topbar__back:hover {
  border-color: rgb(203 213 225);
  color: rgb(15 23 42);
}

.api-docs {
  display: flex;
  width: 100%;
  max-width: 90rem;
  margin: 0 auto;
  flex-direction: column;
  gap: 1.5rem;
  padding: 2rem clamp(1rem, 4vw, 3rem) 5rem;
  color: rgb(30 41 59);
}

.docs-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  border-bottom: 1px solid rgb(226 232 240);
  padding: 0.25rem 0 1.5rem;
}

.docs-hero__copy {
  max-width: 52rem;
}

.docs-eyebrow,
.doc-section__eyebrow {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(173 74 41);
}

.docs-hero h1 {
  margin-top: 0.45rem;
  font-size: 2.1rem;
  font-weight: 750;
  letter-spacing: 0;
  color: rgb(15 23 42);
}

.docs-hero__copy > p:last-child {
  margin-top: 0.7rem;
  font-size: 0.92rem;
  line-height: 1.8;
  color: rgb(100 116 139);
}

.docs-base {
  display: grid;
  min-width: min(100%, 23rem);
  gap: 0.4rem;
  border-left: 3px solid rgb(232 121 78);
  padding: 0.15rem 0 0.15rem 0.9rem;
}

.docs-base__label {
  font-size: 0.72rem;
  color: rgb(100 116 139);
}

.docs-base code {
  overflow-wrap: anywhere;
  font-size: 0.86rem;
  font-weight: 600;
  color: rgb(15 23 42);
}

.docs-base__copy {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.35rem;
  padding: 0.2rem 0.4rem;
  font-size: 0.72rem;
  color: rgb(173 74 41);
}

.docs-base__copy:hover {
  background: rgb(255 244 238);
}

.docs-layout {
  display: grid;
  grid-template-columns: 13.5rem minmax(0, 1fr);
  align-items: start;
  gap: 3rem;
}

.docs-sidebar {
  position: sticky;
  top: 5.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.docs-sidebar__title {
  font-size: 0.72rem;
  font-weight: 700;
  color: rgb(148 163 184);
}

.docs-sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.docs-sidebar nav a {
  border-radius: 0.35rem;
  padding: 0.32rem 0.5rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
}

.docs-sidebar nav a:hover {
  background: rgb(248 250 252);
  color: rgb(173 74 41);
}

.docs-sidebar__links {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border-top: 1px solid rgb(226 232 240);
  padding-top: 0.8rem;
  font-size: 0.76rem;
}

.docs-sidebar__links a,
.docs-sidebar__manual-link {
  color: rgb(173 74 41);
}

.docs-sidebar__manual-link {
  padding: 0;
  text-align: left;
}

.docs-sidebar__manual-link:hover {
  text-decoration: underline;
}

.docs-main {
  min-width: 0;
}

.doc-section {
  padding: 1.4rem 0 2.2rem;
  border-bottom: 1px solid rgb(226 232 240);
  scroll-margin-top: 5.25rem;
}

.doc-section:first-child {
  padding-top: 0.2rem;
}

.doc-section h2 {
  margin-top: 0.3rem;
  font-size: 1.35rem;
  font-weight: 720;
  color: rgb(15 23 42);
}

.doc-section > p {
  margin-top: 0.65rem;
  font-size: 0.88rem;
  line-height: 1.8;
  color: rgb(71 85 105);
}

.doc-section a {
  color: rgb(173 74 41);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.doc-section code {
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-size: 0.82em;
  color: rgb(30 41 59);
}

.docs-grid {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.docs-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.docs-mini {
  border-left: 2px solid rgb(232 121 78);
  padding: 0.15rem 0 0.15rem 0.75rem;
}

.docs-mini > span {
  display: block;
  font-size: 0.7rem;
  color: rgb(148 163 184);
}

.docs-mini strong {
  display: block;
  margin-top: 0.18rem;
  font-size: 0.88rem;
  color: rgb(15 23 42);
}

.docs-mini p {
  margin-top: 0.18rem;
  font-size: 0.76rem;
  line-height: 1.55;
  color: rgb(100 116 139);
}

.docs-callout {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  margin-top: 1rem;
  border: 1px solid rgb(191 219 254);
  border-radius: 0.55rem;
  background: rgb(239 246 255);
  padding: 0.7rem 0.85rem;
  font-size: 0.8rem;
  line-height: 1.65;
  color: rgb(30 64 175);
}

.docs-callout strong {
  font-weight: 650;
}

.docs-callout--warning {
  border-color: rgb(253 230 138);
  background: rgb(254 252 232);
  color: rgb(146 64 14);
}

.docs-steps {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}

.docs-steps li {
  display: grid;
  grid-template-columns: 1.8rem minmax(0, 1fr);
  gap: 0.7rem;
}

.docs-steps__no {
  display: inline-flex;
  height: 1.8rem;
  width: 1.8rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: rgb(232 121 78);
  font-size: 0.72rem;
  font-weight: 700;
  color: rgb(28 18 13);
}

.docs-steps strong {
  font-size: 0.88rem;
  color: rgb(15 23 42);
}

.docs-steps p {
  margin-top: 0.18rem;
  font-size: 0.8rem;
  line-height: 1.7;
  color: rgb(71 85 105);
}

.docs-table-wrap {
  overflow-x: auto;
  margin-top: 1rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.55rem;
}

.docs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.docs-table th,
.docs-table td {
  border-bottom: 1px solid rgb(226 232 240);
  padding: 0.58rem 0.7rem;
  text-align: left;
  vertical-align: top;
}

.docs-table th {
  background: rgb(248 250 252);
  font-weight: 650;
  color: rgb(51 65 85);
  white-space: nowrap;
}

.docs-table td {
  line-height: 1.6;
  color: rgb(71 85 105);
}

.docs-table tbody tr:last-child td {
  border-bottom: 0;
}

.docs-method {
  display: inline-flex;
  min-width: 3rem;
  justify-content: center;
  border-radius: 0.3rem;
  background: rgb(255 244 238);
  padding: 0.14rem 0.35rem;
  font-size: 0.65rem;
  font-weight: 700;
  color: rgb(173 74 41);
}

.docs-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: 1rem;
  padding-left: 1.1rem;
  list-style: disc;
  font-size: 0.82rem;
  line-height: 1.7;
  color: rgb(71 85 105);
}

.doc-section :deep(.doc-code) {
  margin-top: 0.9rem;
}

:global(.dark .api-docs) {
  color: rgb(227 219 208);
}

:global(.dark .api-docs-page) {
  background: rgb(18 18 20);
}

:global(.dark .docs-topbar) {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27 / 0.94);
}

:global(.dark .docs-topbar__brand) {
  color: rgb(244 244 245);
}

:global(.dark .docs-topbar__brand:hover) {
  color: rgb(245 161 127);
}

:global(.dark .docs-topbar__separator) {
  color: rgb(82 82 91);
}

:global(.dark .docs-topbar__current),
:global(.dark .docs-topbar__icon) {
  color: rgb(167 159 148);
}

:global(.dark .docs-topbar__icon:hover) {
  background: rgb(39 39 42);
  color: rgb(244 244 245);
}

:global(.dark .docs-topbar__back) {
  border-color: rgb(63 63 70);
  background: rgb(39 39 42);
  color: rgb(212 212 216);
}

:global(.dark .docs-topbar__back:hover) {
  border-color: rgb(82 82 91);
  color: rgb(250 250 250);
}

:global(.dark .docs-hero),
:global(.dark .doc-section),
:global(.dark .docs-sidebar__links) {
  border-color: rgb(66 61 55);
}

:global(.dark .docs-hero h1),
:global(.dark .doc-section h2),
:global(.dark .docs-mini strong),
:global(.dark .docs-steps strong),
:global(.dark .docs-base code) {
  color: rgb(242 237 229);
}

:global(.dark .docs-hero__copy > p:last-child),
:global(.dark .doc-section > p),
:global(.dark .docs-steps p),
:global(.dark .docs-list) {
  color: rgb(167 159 148);
}

:global(.dark .docs-sidebar nav a) {
  color: rgb(201 193 182);
}

:global(.dark .docs-sidebar nav a:hover) {
  background: rgb(44 41 37);
  color: rgb(245 161 127);
}

:global(.dark .doc-section code) {
  color: rgb(227 219 208);
}

:global(.dark .docs-table-wrap) {
  border-color: rgb(66 61 55);
}

:global(.dark .docs-table th),
:global(.dark .docs-table td) {
  border-color: rgb(66 61 55);
}

:global(.dark .docs-table th) {
  background: rgb(44 41 37);
  color: rgb(227 219 208);
}

:global(.dark .docs-table td) {
  color: rgb(201 193 182);
}

:global(.dark .docs-callout) {
  border-color: rgb(30 64 175 / 0.55);
  background: rgb(30 58 138 / 0.2);
  color: rgb(191 219 254);
}

:global(.dark .docs-callout--warning) {
  border-color: rgb(146 64 14 / 0.55);
  background: rgb(120 53 15 / 0.18);
  color: rgb(253 230 138);
}

@media (max-width: 1023px) {
  .docs-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
  }

  .docs-sidebar {
    position: static;
  }

  .docs-sidebar nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .docs-sidebar nav a {
    border: 1px solid rgb(226 232 240);
  }

  .docs-sidebar__links {
    flex-direction: row;
    flex-wrap: wrap;
  }
}

@media (max-width: 639px) {
  .docs-topbar {
    gap: 0.5rem;
  }

  .docs-topbar__back {
    width: 2rem;
    justify-content: center;
    padding: 0;
  }

  .docs-topbar__back span {
    display: none;
  }

  .docs-hero h1 {
    font-size: 1.75rem;
  }

  .docs-grid--three {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
