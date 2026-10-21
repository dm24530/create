<template>
  <BaseDialog
    :show="show"
    title="个人资料"
    width="normal"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <section class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-dark-700 dark:bg-dark-800">
        <p class="text-sm font-semibold text-gray-900 dark:text-white">
          {{ user?.username || user?.email?.split('@')[0] || '用户' }}
        </p>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {{ user?.email }}
        </p>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          余额：${{ Number(user?.balance || 0).toFixed(2) }}
        </p>
      </section>

      <ProfileAvatarCard :user="user" embedded />
      <ProfileEditForm :initial-username="user?.username || ''" embedded />
    </div>

    <template #footer>
      <div class="flex justify-end">
        <button type="button" class="btn btn-primary" @click="emit('close')">
          完成
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import ProfileAvatarCard from '@/components/user/profile/ProfileAvatarCard.vue'
import ProfileEditForm from '@/components/user/profile/ProfileEditForm.vue'
import { useAuthStore } from '@/stores/auth'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const authStore = useAuthStore()
const user = computed(() => authStore.user)
</script>
