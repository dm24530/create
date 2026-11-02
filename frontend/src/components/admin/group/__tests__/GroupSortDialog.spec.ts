import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import GroupSortDialog from "../GroupSortDialog.vue";
import { adminAPI } from "@/api/admin";
import type { AdminGroup } from "@/types";

const { getAll, updateSortOrder, showSuccess, showError } = vi.hoisted(() => ({
  getAll: vi.fn(),
  updateSortOrder: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/api/admin", () => ({
  adminAPI: {
    groups: {
      getAll,
      updateSortOrder,
    },
  },
}));

vi.mock("@/stores/app", () => ({
  useAppStore: () => ({ showSuccess, showError }),
}));

vi.mock("vue-i18n", async () => {
  const actual = await vi.importActual<typeof import("vue-i18n")>("vue-i18n");
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  };
});

const BaseDialogStub = defineComponent({
  props: {
    show: { type: Boolean, default: false },
  },
  template: '<div v-if="show"><slot /><slot name="footer" /></div>',
});

const VueDraggableStub = defineComponent({
  props: {
    modelValue: { type: Array, default: () => [] },
  },
  template: "<div><slot /></div>",
});

const group = (id: number, name: string, sortOrder: number): AdminGroup =>
  ({
    id,
    name,
    sort_order: sortOrder,
    platform: "openai",
  }) as AdminGroup;

describe("GroupSortDialog", () => {
  beforeEach(() => {
    getAll.mockResolvedValue([
      group(2, "Second", 20),
      group(1, "First", 10),
    ]);
    updateSortOrder.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads all groups in sort order and submits normalized positions", async () => {
    const wrapper = mount(GroupSortDialog, {
      props: { show: true },
      global: {
        stubs: {
          BaseDialog: BaseDialogStub,
          VueDraggable: VueDraggableStub,
          Icon: true,
        },
      },
    });
    await flushPromises();

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(wrapper.text().indexOf("First")).toBeLessThan(
      wrapper.text().indexOf("Second"),
    );

    await wrapper.get('[data-testid="group-sort-save"]').trigger("click");
    await flushPromises();

    expect(updateSortOrder).toHaveBeenCalledWith([
      { id: 1, sort_order: 0 },
      { id: 2, sort_order: 10 },
    ]);
    expect(showSuccess).toHaveBeenCalledWith("admin.groups.sortOrderUpdated");
    expect(wrapper.emitted("saved")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
