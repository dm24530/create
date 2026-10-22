<template>
  <BaseDialog
    :show="show"
    title="图片、视频与画布创作手册"
    width="extra-wide"
    body-class="manual-quick-modal-body"
    :close-on-click-outside="true"
    @close="emit('close')"
  >
    <div class="manual-quick-modal">
      <div class="manual-quick-modal__actions">
        <RouterLink
          :to="{ path: '/image-studio', query: { openApiKeys: '1' } }"
          class="manual-quick-modal__action manual-quick-modal__action--primary"
          @click="emit('close')"
        >
          <Icon name="key" size="sm" />
          创建创作密钥
        </RouterLink>
        <RouterLink :to="'/image-studio'" class="manual-quick-modal__action" @click="emit('close')">
          <Icon name="grid" size="sm" />
          生图工作台
        </RouterLink>
        <RouterLink :to="'/video-studio'" class="manual-quick-modal__action" @click="emit('close')">
          <Icon name="play" size="sm" />
          生视频工作台
        </RouterLink>
        <RouterLink :to="'/canvas'" class="manual-quick-modal__action" @click="emit('close')">
          <Icon name="grid" size="sm" />
          无限画布
        </RouterLink>
        <RouterLink :to="'/video-works'" class="manual-quick-modal__action" @click="emit('close')">
          <Icon name="bookmark" size="sm" />
          我的作品
        </RouterLink>
      </div>

      <div class="manual-quick-modal__grid">
        <section v-for="section in sections" :key="section.title" class="manual-quick-modal__section">
          <h4>{{ section.title }}</h4>
          <p>{{ section.description }}</p>
          <ul>
            <li v-for="item in section.items" :key="item">{{ item }}</li>
          </ul>
        </section>
      </div>

      <div class="manual-quick-modal__footer">
        <p>每次生成的费用和计费方式可以在顶栏“使用记录”中查看。</p>
        <RouterLink :to="'/docs/api'" class="manual-quick-modal__docs" @click="emit('close')">
          查看接口文档
          <Icon name="arrowRight" size="xs" />
        </RouterLink>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'

defineProps<{ show: boolean }>()

const emit = defineEmits<{ (event: 'close'): void }>()

const sections = [
  {
    title: '开始前',
    description: '先准备可用的创作密钥和余额，再进入工作台选择模型。',
    items: [
      '创建创作密钥，并确认所属分组开放了图片或视频模型。',
      '模型列表会按当前密钥过滤，没有模型时先检查分组权限。',
      '生成费用从账户余额扣除，可在“使用记录”查看每笔价格。',
    ],
  },
  {
    title: '生图工作台',
    description: '用提示词和参考图控制主体、构图、光线与风格。',
    items: [
      '先写主体，再补充场景、镜头、光线和画面风格。',
      '上传参考图可保持商品外观、角色身份或视觉风格。',
      '生成前设置质量、尺寸和数量，数量越多费用越高。',
      '结果先显示在工作台，点击保存后才进入“我的作品”。',
    ],
  },
  {
    title: '生视频工作台',
    description: '按一个镜头描述连续动作，并等待异步任务完成。',
    items: [
      '提示词按“主体 + 动作 + 场景 + 运镜 + 光线”描述。',
      '可添加参考图、参考视频或参考音频，具体能力以模型为准。',
      '先用较短时长验证动作，再生成正式高清版本。',
      '任务完成后预览、下载或保存，未保存的临时结果会过期。',
    ],
  },
  {
    title: '无限画布基础操作',
    description: '把图片、文字、视频和生成配置放到同一张可无限扩展的画布上，连续推演创作流程。',
    items: [
      '点击工具栏添加图片、文本、视频、音频、生成配置或组节点。',
      '拖动节点调整位置，从节点端口拖出连线，组合参考图和生成配置。',
      '滚轮缩放画布，中键拖动或按住空格再拖动画布，Ctrl/Cmd+Z 撤回、Ctrl/Cmd+Shift+Z 重做。',
      'Ctrl/Cmd+C 与 Ctrl/Cmd+V 可复制粘贴节点，也可以直接粘贴剪贴板中的文字或图片。',
      '生成配置节点可选择模型、填写提示词、连接参考素材并触发生成。',
    ],
  },
  {
    title: '画布资产与 Agent',
    description: '画布素材、生成结果和本地 Agent 分工使用，适合从单次生成扩展到完整工作流。',
    items: [
      '图片节点支持查看大图、复制提示词、局部编辑、裁剪、切图、放大和超分等快捷工具。',
      '生成结果可以存为资产，也能继续作为后续节点的参考图或参考视频。',
      '画布项目支持保存、重命名、导出和删除；编码结果会保留节点与连线。',
      '需要对话式协作时，在画布右侧连接本地 Agent，使用 / 调用 Skill、@ 引用当前画布素材。',
      '本站打开的托管画布会自动注入接口地址和创作密钥；连接 Agent 后，画布写入可选择手动确认或自动确认。',
    ],
  },
  {
    title: '作品与费用',
    description: '工作台结果和已保存作品分开管理，避免占用作品配额。',
    items: [
      '只有点击保存到“我的作品”的内容才会长期保留。',
      '取消收藏已保存作品时，系统会提示作品会被删除。',
      '图片和视频共用作品配额，达到上限后需要先删除旧作品。',
      '“使用记录”中的价格列显示每次请求的实际扣费。',
    ],
  },
]
</script>

<style scoped>
:global(.manual-quick-modal-body) {
  overflow: hidden;
}

.manual-quick-modal {
  display: flex;
  max-height: calc(90vh - 8rem);
  min-height: 0;
  flex-direction: column;
  gap: 1rem;
}

.manual-quick-modal__actions {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 0.5rem;
}

.manual-quick-modal__action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid rgb(229 231 235);
  border-radius: 0.5rem;
  padding: 0.55rem 0.8rem;
  color: rgb(63 63 70);
  font-size: 0.8rem;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.manual-quick-modal__action:hover {
  border-color: rgb(212 212 216);
  background: rgb(250 250 250);
}

.manual-quick-modal__action--primary {
  border-color: rgb(234 88 12);
  background: rgb(234 88 12);
  color: white;
}

.manual-quick-modal__action--primary:hover {
  border-color: rgb(194 65 12);
  background: rgb(194 65 12);
}

.manual-quick-modal__grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.manual-quick-modal__section {
  border: 1px solid rgb(229 231 235);
  border-radius: 0.5rem;
  padding: 1rem;
}

.manual-quick-modal__section h4 {
  margin: 0;
  color: rgb(24 24 27);
  font-size: 0.95rem;
  font-weight: 700;
}

.manual-quick-modal__section p {
  margin: 0.35rem 0 0.75rem;
  color: rgb(82 82 91);
  font-size: 0.82rem;
  line-height: 1.55;
}

.manual-quick-modal__section ul {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding-left: 1.1rem;
  color: rgb(63 63 70);
  font-size: 0.8rem;
  line-height: 1.55;
}

.manual-quick-modal__footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid rgb(229 231 235);
  padding-top: 0.8rem;
  color: rgb(113 113 122);
  font-size: 0.78rem;
}

.manual-quick-modal__docs {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.25rem;
  color: rgb(194 65 12);
  font-weight: 600;
}

:global(.dark .manual-quick-modal__action),
:global(.dark .manual-quick-modal__section) {
  border-color: rgb(63 63 70);
}

:global(.dark .manual-quick-modal__action) {
  color: rgb(228 228 231);
}

:global(.dark .manual-quick-modal__action:hover) {
  border-color: rgb(82 82 91);
  background: rgb(39 39 42);
}

:global(.dark .manual-quick-modal__action--primary) {
  border-color: rgb(234 88 12);
  background: rgb(234 88 12);
  color: white;
}

:global(.dark .manual-quick-modal__section h4) {
  color: rgb(244 244 245);
}

:global(.dark .manual-quick-modal__section p) {
  color: rgb(161 161 170);
}

:global(.dark .manual-quick-modal__section ul) {
  color: rgb(212 212 216);
}

:global(.dark .manual-quick-modal__footer) {
  border-color: rgb(63 63 70);
  color: rgb(161 161 170);
}

@media (max-width: 768px) {
  .manual-quick-modal {
    max-height: calc(95vh - 8rem);
  }

  .manual-quick-modal__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .manual-quick-modal__footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
