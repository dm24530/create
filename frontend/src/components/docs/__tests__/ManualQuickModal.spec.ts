import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ManualQuickModal from '../ManualQuickModal.vue'

const stubs = {
  BaseDialog: {
    props: ['show', 'title', 'width', 'bodyClass', 'closeOnClickOutside'],
    emits: ['close'],
    template:
      '<div v-if="show"><span>{{ title }}</span><button data-testid="close" @click="$emit(\'close\')">close</button><slot /></div>',
  },
  RouterLink: {
    props: ['to'],
    template: '<a><slot /></a>',
  },
  Icon: true,
}

describe('ManualQuickModal', () => {
  it('shows the current studio workflow and closes without using the retired manual page', async () => {
    const wrapper = mount(ManualQuickModal, {
      props: { show: true },
      global: { stubs },
    })

    expect(wrapper.text()).toContain('图片与视频创作手册')
    expect(wrapper.text()).toContain('使用记录')
    expect(wrapper.text()).toContain('只有点击保存到“我的作品”的内容才会长期保留')
    expect(wrapper.text()).not.toContain('/manual')

    await wrapper.get('[data-testid="close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
