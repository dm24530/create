<template>
  <AppLayout>
    <div class="manual">
      <header class="manual-hero">
        <div class="manual-hero__copy">
          <p class="manual-eyebrow">IMAGE & VIDEO STUDIO</p>
          <h1>图片与视频创作手册</h1>
          <p>
            从这里开始使用图片工作台、视频工作台和灵感库。手册覆盖提示词、参考素材、
            尺寸与时长、作品保存，以及通过 API 接入图片和视频生成的方法。
          </p>
        </div>
        <div class="manual-hero__actions">
          <router-link to="/image-studio" class="manual-action manual-action--primary">
            <Icon name="grid" size="sm" />
            打开图片工作台
          </router-link>
          <router-link to="/video-studio" class="manual-action">
            <Icon name="play" size="sm" />
            打开视频工作台
          </router-link>
          <router-link to="/docs/api" class="manual-action">
            <Icon name="book" size="sm" />
            接口文档
          </router-link>
        </div>
      </header>

      <section class="manual-quick">
        <router-link v-for="item in quickLinks" :key="item.to" :to="item.to" class="manual-quick__item">
          <span>{{ item.step }}</span>
          <strong>{{ item.title }}</strong>
          <p>{{ item.description }}</p>
        </router-link>
      </section>

      <div class="manual-layout">
        <aside class="manual-sidebar">
          <p>目录</p>
          <nav aria-label="创作手册目录">
            <a v-for="item in sections" :key="item.id" :href="`#${item.id}`">{{ item.label }}</a>
          </nav>
        </aside>

        <main class="manual-main">
          <section id="prepare" class="manual-section">
            <p class="manual-section__eyebrow">Preparation</p>
            <h2>开始前准备</h2>
            <ol class="manual-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>创建创作密钥</strong>
                  <p>
                    进入
                    <router-link to="/keys">创作密钥</router-link>
                    页面创建密钥。图片和视频工作台会使用这把密钥调用模型，生成费用从账户余额中扣除。
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>确认图片或视频能力</strong>
                  <p>
                    API 密钥所属通道决定可用模型。若工作台没有模型，先检查该密钥的通道是否开放图片或视频生成能力。
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>确认余额与作品配额</strong>
                  <p>
                    图片和视频按实际模型与参数计费。保存到“我的作品”的内容会占用图片与视频共用的作品配额，
                    临时结果则有保留期限。
                  </p>
                </div>
              </li>
            </ol>
          </section>

          <section id="image" class="manual-section">
            <p class="manual-section__eyebrow">Image Studio</p>
            <h2>使用图片工作台</h2>
            <ol class="manual-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>选择 API 密钥和图片模型</strong>
                  <p>右上角选择支持图片生成的密钥与模型。模型列表会按当前密钥通道过滤。</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>输入提示词</strong>
                  <p>
                    描述主体、场景、构图、光线和风格。需要保持商品或角色一致时，把约束写在提示词中，
                    并配合参考图使用。
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>调整生成参数</strong>
                  <p>设置尺寸、质量、格式、背景和数量。当前一次最多生成 4 张，最终可用尺寸以页面校验结果为准。</p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>生成、预览并保存</strong>
                  <p>
                    生成完成后点击图片预览。临时结果可下载或存到“我的作品”；已保存的作品会长期保留并计入配额。
                  </p>
                </div>
              </li>
            </ol>
            <div class="manual-table-wrap">
              <table class="manual-table">
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>建议</th>
                    <th>注意</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>提示词</td>
                    <td>先写主体，再写环境、镜头、光线和风格。</td>
                    <td>一次只解决一个主要视觉目标，效果更稳定。</td>
                  </tr>
                  <tr>
                    <td>参考图</td>
                    <td>用于保持商品外观、角色身份或画面风格。</td>
                    <td>参考图越清晰，主体一致性通常越稳定。</td>
                  </tr>
                  <tr>
                    <td>尺寸</td>
                    <td>根据发布渠道选择横图、竖图或方图。</td>
                    <td>当前模型不支持的尺寸会在生成前提示。</td>
                  </tr>
                  <tr>
                    <td>质量 / 格式 / 背景</td>
                    <td>正式物料优先高质量；需要透明背景时选择对应选项。</td>
                    <td>最终能力取决于当前模型，无法生效时换模型测试。</td>
                  </tr>
                  <tr>
                    <td>数量</td>
                    <td>先用 1 张验证提示词，再批量生成。</td>
                    <td>数量越多，成本和等待时间越高。</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="manual-callout">
              <strong>图片编辑</strong>
              <span>
                上传参考图后，工作台会自动使用图片编辑接口。提示词只描述需要改变的内容，
                并明确哪些主体、文字、构图和风格必须保持不变。
              </span>
            </div>
          </section>

          <section id="video" class="manual-section">
            <p class="manual-section__eyebrow">Video Studio</p>
            <h2>使用视频工作台</h2>
            <ol class="manual-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>选择视频模型</strong>
                  <p>
                    支持 Seedance、Grok Video 以及通道开放的其他视频模型。模型名称决定创建任务使用的协议和能力。
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>写清镜头动作</strong>
                  <p>
                    建议按“主体 + 动作 + 场景 + 运镜 + 光线 + 结尾状态”描述。视频提示词越具体，
                    动作漂移和场景变化的概率通常越低。
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>添加参考素材</strong>
                  <p>
                    可以添加参考图、参考视频和参考音频。参考图还可指定首帧、尾帧或普通参考图；
                    不同模型支持的素材数量和组合方式不同。
                  </p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>设置时长、画幅和画质</strong>
                  <p>
                    时长、分辨率与画幅会直接影响生成成本和可用性。先用较低成本参数验证动作，
                    确认后再生成高质量版本。
                  </p>
                </div>
              </li>
              <li>
                <span>5</span>
                <div>
                  <strong>提交并等待任务</strong>
                  <p>
                    视频是异步任务。工作台会持续轮询状态；成功后可预览、下载或保存到“我的作品”。
                    任务失败时保留提示词和参数，换模型或减少参考素材后重试。
                  </p>
                </div>
              </li>
            </ol>
            <div class="manual-table-wrap">
              <table class="manual-table">
                <thead>
                  <tr>
                    <th>参数</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>提示词</td>
                    <td>描述连续动作，不要写成多段互不相关的镜头；一个任务尽量只做一个镜头。</td>
                  </tr>
                  <tr>
                    <td>参考图</td>
                    <td>支持首帧、尾帧或参考图时，优先上传主体清晰、构图完整的图片。</td>
                  </tr>
                  <tr>
                    <td>参考视频</td>
                    <td>用于参考运动、镜头节奏或风格。不要同时上传互相冲突的运镜参考。</td>
                  </tr>
                  <tr>
                    <td>参考音频</td>
                    <td>用于节奏或氛围参考。最终是否生成音频取决于模型和“生成音频”开关。</td>
                  </tr>
                  <tr>
                    <td>时长 / 画质 / 画幅</td>
                    <td>先用低时长与低画质试动作，再生成正式版本；比例按发布渠道选择。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="inspiration" class="manual-section">
            <p class="manual-section__eyebrow">Inspiration</p>
            <h2>从灵感库开始</h2>
            <p>
              打开
              <router-link to="/image-inspiration">图片灵感库</router-link>
              寻找构图、配色和材质参考，或打开
              <router-link to="/video-inspiration">视频灵感库</router-link>
              浏览镜头结构。点击图片可以查看大图和完整提示词，再复制提示词或直接带入对应工作台。
              正式生成前仍要按自己的主体和素材调整提示词。
            </p>
            <div class="manual-grid">
              <div>
                <strong>图片灵感</strong>
                <p>按模型和分类浏览图片作品，查看构图、配色、尺寸与完整提示词。</p>
              </div>
              <div>
                <strong>视频灵感</strong>
                <p>浏览视频提示词和镜头模板，快速带入视频工作台。</p>
              </div>
              <div>
                <strong>在线灵感</strong>
                <p>查看社区热门图片与视频；外部源暂不可用时会显示明确提示。</p>
              </div>
            </div>
          </section>

          <section id="works" class="manual-section">
            <p class="manual-section__eyebrow">Works</p>
            <h2>保存与管理作品</h2>
            <p>
              临时生成结果会出现在工作台和“我的作品”中，但可能按保留期限自动清理。
              需要长期使用时，请点击保存或置顶到“我的作品”。图片与视频共用作品配额，达到上限后需要先删除旧作品。
            </p>
            <router-link to="/video-works" class="manual-inline-link">打开我的作品</router-link>
          </section>

          <section id="api" class="manual-section">
            <p class="manual-section__eyebrow">API</p>
            <h2>通过 API 生成图片和视频</h2>
            <p>
              图片使用 OpenAI Images 兼容接口；视频根据模型族使用 Grok Video 或 Seedance 异步任务接口。
              下面的示例使用你的当前 Base URL，完整参数和错误说明见
              <router-link to="/docs/api">接口文档</router-link>。
            </p>
            <DocCodeBlock title="Generate an image" language="bash" :code="snippets.image" />
            <DocCodeBlock title="Grok video" language="bash" :code="snippets.grokVideo" />
            <DocCodeBlock title="Seedance video" language="bash" :code="snippets.seedanceVideo" />
            <DocCodeBlock title="Poll and download" language="bash" :code="snippets.videoPoll" />
          </section>

          <section id="troubleshooting" class="manual-section">
            <p class="manual-section__eyebrow">Troubleshooting</p>
            <h2>常见问题</h2>
            <div class="manual-faq">
              <div v-for="item in faqs" :key="item.title">
                <strong>{{ item.title }}</strong>
                <p>{{ item.answer }}</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import DocCodeBlock from '@/components/docs/DocCodeBlock.vue'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores/app'
import { resolveDocumentedApiBaseUrl } from '@/utils/apiEndpoint'

const appStore = useAppStore()
const apiBaseUrl = computed(() => resolveDocumentedApiBaseUrl(
  appStore.cachedPublicSettings?.api_base_url || appStore.apiBaseUrl,
  typeof window === 'undefined' ? '' : window.location.origin,
))

const quickLinks = [
  { step: '图片', title: '图片工作台', description: '文生图、参考图编辑、尺寸与作品保存。', to: '/image-studio' },
  { step: '视频', title: '视频工作台', description: '图生视频、文生视频、多模态参考和异步任务。', to: '/video-studio' },
  { step: '灵感', title: '图片灵感库', description: '浏览图片作品与完整提示词，一键带入图片工作台。', to: '/image-inspiration' },
  { step: '灵感', title: '视频灵感库', description: '浏览持续更新的镜头提示词，一键带入工作台。', to: '/video-inspiration' },
  { step: '接口', title: '接口文档', description: '查看图片与视频 API 的完整请求和错误说明。', to: '/docs/api' },
]

const sections = [
  { id: 'prepare', label: '开始前准备' },
  { id: 'image', label: '图片工作台' },
  { id: 'video', label: '视频工作台' },
  { id: 'inspiration', label: '灵感库' },
  { id: 'works', label: '保存与管理' },
  { id: 'api', label: 'API 接入' },
  { id: 'troubleshooting', label: '常见问题' },
]

const faqs = [
  {
    title: '提示没有可用模型',
    answer: '先确认 API 密钥所属通道是否开放了图片或视频生成能力。图片和视频使用不同的模型列表，文本模型不能直接用于生成图片或视频。',
  },
  {
    title: '图片尺寸不可用',
    answer: '不同模型支持的尺寸范围不同。按页面提示调整尺寸；如果仍然不可用，换一个图片模型测试。',
  },
  {
    title: '视频一直处于生成中',
    answer: '视频任务通常比图片慢。保持页面打开等待轮询；如果长时间失败，减少参考素材、缩短时长或降低画质后重试。',
  },
  {
    title: '参考素材没有生效',
    answer: '检查当前模型是否支持该类型参考素材，以及素材数量、格式和大小是否在限制内。不同模型的参考图角色和组合能力不同。',
  },
  {
    title: '生成成功但作品不见了',
    answer: '临时作品有保留期限。需要长期保留时，请在生成完成后保存到“我的作品”，并检查图片与视频共用的作品配额。',
  },
  {
    title: 'API 返回 401 或 403',
    answer: '401 通常是密钥无效或已禁用；403 通常是通道权限、IP 限制或客户端限制。确认使用创作密钥，而不是登录密码。',
  },
]

const snippets = computed(() => {
  const base = apiBaseUrl.value
  return {
    image: `curl "${base}/images/generations" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "your-image-model",
    "prompt": "白色陶瓷杯放在木质桌面，清晨窗边柔光，商业摄影",
    "size": "1024x1024",
    "quality": "high",
    "n": 1,
    "response_format": "b64_json"
  }'`,
    grokVideo: `curl "${base}/videos/generations" \\
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
    seedanceVideo: `curl "${base}/contents/generations/tasks" \\
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
    videoPoll: `# Grok
curl "${base}/videos/REQUEST_ID" \\
  -H "Authorization: Bearer $CREATE_API_KEY"

curl "${base}/videos/REQUEST_ID/content" \\
  -H "Authorization: Bearer $CREATE_API_KEY" \\
  --output result.mp4

# Seedance
curl "${base}/contents/generations/tasks/REQUEST_ID" \\
  -H "Authorization: Bearer $CREATE_API_KEY"`,
  }
})
</script>

<style scoped>
.manual {
  display: flex;
  width: 100%;
  max-width: 90rem;
  margin: 0 auto;
  flex-direction: column;
  gap: 1.5rem;
}

.manual-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  border-bottom: 1px solid rgb(226 232 240);
  padding: 0.25rem 0 1.5rem;
}

.manual-hero__copy {
  max-width: 53rem;
}

.manual-eyebrow,
.manual-section__eyebrow {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgb(173 74 41);
}

.manual-hero h1 {
  margin-top: 0.45rem;
  font-size: 2.1rem;
  font-weight: 750;
  color: rgb(15 23 42);
}

.manual-hero__copy > p:last-child {
  margin-top: 0.7rem;
  font-size: 0.92rem;
  line-height: 1.8;
  color: rgb(100 116 139);
}

.manual-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.manual-action {
  display: inline-flex;
  height: 2.35rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: rgb(255 255 255);
  padding: 0 0.75rem;
  font-size: 0.78rem;
  color: rgb(71 85 105);
}

.manual-action:hover {
  border-color: rgb(232 121 78);
  color: rgb(173 74 41);
}

.manual-action--primary {
  border-color: rgb(232 121 78);
  background: rgb(232 121 78);
  color: rgb(28 18 13);
}

.manual-quick {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.manual-quick__item {
  border-left: 2px solid rgb(232 121 78);
  padding: 0.35rem 0 0.35rem 0.8rem;
}

.manual-quick__item span {
  font-size: 0.68rem;
  color: rgb(148 163 184);
}

.manual-quick__item strong {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.9rem;
  color: rgb(15 23 42);
}

.manual-quick__item p {
  margin-top: 0.2rem;
  font-size: 0.76rem;
  line-height: 1.55;
  color: rgb(100 116 139);
}

.manual-layout {
  display: grid;
  grid-template-columns: 12.5rem minmax(0, 1fr);
  align-items: start;
  gap: 3rem;
}

.manual-sidebar {
  position: sticky;
  top: 5.25rem;
}

.manual-sidebar > p {
  font-size: 0.7rem;
  font-weight: 700;
  color: rgb(148 163 184);
}

.manual-sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin-top: 0.6rem;
}

.manual-sidebar a {
  border-radius: 0.35rem;
  padding: 0.32rem 0.5rem;
  font-size: 0.8rem;
  color: rgb(71 85 105);
}

.manual-sidebar a:hover {
  background: rgb(248 250 252);
  color: rgb(173 74 41);
}

.manual-main {
  min-width: 0;
}

.manual-section {
  border-bottom: 1px solid rgb(226 232 240);
  padding: 1.4rem 0 2.2rem;
  scroll-margin-top: 5.25rem;
}

.manual-section:first-child {
  padding-top: 0.2rem;
}

.manual-section h2 {
  margin-top: 0.3rem;
  font-size: 1.35rem;
  font-weight: 720;
  color: rgb(15 23 42);
}

.manual-section > p {
  margin-top: 0.65rem;
  font-size: 0.88rem;
  line-height: 1.8;
  color: rgb(71 85 105);
}

.manual-section a {
  color: rgb(173 74 41);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.manual-section code {
  border-radius: 0.25rem;
  background: rgb(241 245 249);
  padding: 0.08rem 0.3rem;
  font-size: 0.82em;
}

.manual-steps {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}

.manual-steps li {
  display: grid;
  grid-template-columns: 1.8rem minmax(0, 1fr);
  gap: 0.7rem;
}

.manual-steps li > span {
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

.manual-steps strong {
  font-size: 0.88rem;
  color: rgb(15 23 42);
}

.manual-steps p {
  margin-top: 0.18rem;
  font-size: 0.8rem;
  line-height: 1.7;
  color: rgb(71 85 105);
}

.manual-table-wrap {
  overflow-x: auto;
  margin-top: 1rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.55rem;
}

.manual-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.manual-table th,
.manual-table td {
  border-bottom: 1px solid rgb(226 232 240);
  padding: 0.58rem 0.7rem;
  text-align: left;
  vertical-align: top;
}

.manual-table th {
  background: rgb(248 250 252);
  font-weight: 650;
  color: rgb(51 65 85);
}

.manual-table td {
  line-height: 1.65;
  color: rgb(71 85 105);
}

.manual-table tbody tr:last-child td {
  border-bottom: 0;
}

.manual-callout {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 1rem;
  border: 1px solid rgb(253 230 138);
  border-radius: 0.55rem;
  background: rgb(254 252 232);
  padding: 0.7rem 0.85rem;
  font-size: 0.8rem;
  line-height: 1.65;
  color: rgb(146 64 14);
}

.manual-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}

.manual-grid > div {
  border-left: 2px solid rgb(232 121 78);
  padding-left: 0.75rem;
}

.manual-grid strong {
  font-size: 0.85rem;
  color: rgb(15 23 42);
}

.manual-grid p {
  margin-top: 0.2rem;
  font-size: 0.77rem;
  line-height: 1.6;
  color: rgb(100 116 139);
}

.manual-inline-link {
  display: inline-flex;
  margin-top: 0.8rem;
  font-size: 0.82rem;
  font-weight: 600;
}

.manual-faq {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.manual-faq strong {
  font-size: 0.85rem;
  color: rgb(15 23 42);
}

.manual-faq p {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  line-height: 1.7;
  color: rgb(71 85 105);
}

.manual-section :deep(.doc-code) {
  margin-top: 0.9rem;
}

:global(.dark .manual-hero),
:global(.dark .manual-section) {
  border-color: rgb(66 61 55);
}

:global(.dark .manual-hero h1),
:global(.dark .manual-section h2),
:global(.dark .manual-quick__item strong),
:global(.dark .manual-steps strong),
:global(.dark .manual-grid strong),
:global(.dark .manual-faq strong) {
  color: rgb(242 237 229);
}

:global(.dark .manual-hero__copy > p:last-child),
:global(.dark .manual-section > p),
:global(.dark .manual-steps p),
:global(.dark .manual-faq p) {
  color: rgb(167 159 148);
}

:global(.dark .manual-action) {
  border-color: rgb(66 61 55);
  background: rgb(35 33 30);
  color: rgb(227 219 208);
}

:global(.dark .manual-action--primary) {
  border-color: rgb(232 121 78);
  background: rgb(232 121 78);
  color: rgb(28 18 13);
}

:global(.dark .manual-sidebar a) {
  color: rgb(201 193 182);
}

:global(.dark .manual-sidebar a:hover) {
  background: rgb(44 41 37);
  color: rgb(245 161 127);
}

:global(.dark .manual-section code) {
  background: rgb(44 41 37);
  color: rgb(227 219 208);
}

:global(.dark .manual-table-wrap) {
  border-color: rgb(66 61 55);
}

:global(.dark .manual-table th),
:global(.dark .manual-table td) {
  border-color: rgb(66 61 55);
}

:global(.dark .manual-table th) {
  background: rgb(44 41 37);
  color: rgb(227 219 208);
}

:global(.dark .manual-table td) {
  color: rgb(201 193 182);
}

:global(.dark .manual-callout) {
  border-color: rgb(146 64 14 / 0.55);
  background: rgb(120 53 15 / 0.18);
  color: rgb(253 230 138);
}

@media (max-width: 1100px) {
  .manual-quick {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .manual-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 1.25rem;
  }

  .manual-sidebar {
    position: static;
  }

  .manual-sidebar nav {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .manual-sidebar a {
    border: 1px solid rgb(226 232 240);
  }

  .manual-grid,
  .manual-faq {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 639px) {
  .manual-hero h1 {
    font-size: 1.75rem;
  }

  .manual-quick {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
