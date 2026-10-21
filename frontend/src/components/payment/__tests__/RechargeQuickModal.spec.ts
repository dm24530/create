import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RechargeQuickModal from '../RechargeQuickModal.vue'

const PaymentViewStub = {
  name: 'PaymentView',
  props: ['embedded'],
  emits: ['open-redeem'],
  template: '<div data-testid="recharge-panel">recharge</div>',
}

const RedeemViewStub = {
  name: 'RedeemView',
  props: ['embedded'],
  template: '<div data-testid="redeem-panel">redeem</div>',
}

const stubs = {
  BaseDialog: {
    props: {
      show: Boolean,
      title: String,
      width: String,
      bodyClass: String,
      headerless: Boolean,
      closeOnClickOutside: Boolean,
    },
    emits: ['close'],
    template:
      '<div v-if="show"><button v-if="closeOnClickOutside" data-testid="recharge-backdrop" @click="$emit(\'close\')">backdrop</button><slot /></div>',
  },
  PaymentView: PaymentViewStub,
  RedeemView: RedeemViewStub,
}

describe('RechargeQuickModal', () => {
  it('opens on recharge by default and switches to redeem inside the modal', async () => {
    const wrapper = mount(RechargeQuickModal, {
      props: { show: true },
      global: { stubs },
    })

    expect(wrapper.findComponent(stubs.BaseDialog).props('headerless')).toBe(true)
    expect(wrapper.findComponent(stubs.BaseDialog).props('closeOnClickOutside')).toBe(true)
    expect(wrapper.find('[data-testid="recharge-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="redeem-panel"]').exists()).toBe(false)

    wrapper.findComponent(PaymentViewStub).vm.$emit('open-redeem')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="recharge-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="redeem-panel"]').exists()).toBe(true)
  })

  it('can open directly on the redeem tab', () => {
    const wrapper = mount(RechargeQuickModal, {
      props: { show: true, initialTab: 'redeem' },
      global: { stubs },
    })

    expect(wrapper.find('[data-testid="redeem-panel"]').exists()).toBe(true)
  })

  it('closes when the backdrop is clicked', async () => {
    const wrapper = mount(RechargeQuickModal, {
      props: { show: true },
      global: { stubs },
    })

    await wrapper.get('[data-testid="recharge-backdrop"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
