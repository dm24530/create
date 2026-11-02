import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import GroupCompositeRoutesDialog from "../GroupCompositeRoutesDialog.vue";
import { adminAPI } from "@/api/admin";
import type {
  AdminGroup,
  CompositeModelRoute,
  CompositeRouteDecision,
} from "@/types";

const {
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  previewRoute,
  showSuccess,
  showError,
} = vi.hoisted(() => ({
  listRoutes: vi.fn(),
  createRoute: vi.fn(),
  updateRoute: vi.fn(),
  deleteRoute: vi.fn(),
  previewRoute: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/api/admin", () => ({
  adminAPI: {
    groups: {
      listCompositeRoutes: listRoutes,
      createCompositeRoute: createRoute,
      updateCompositeRoute: updateRoute,
      deleteCompositeRoute: deleteRoute,
      previewCompositeRoute: previewRoute,
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

const group = {
  id: 7,
  name: "Composite",
} as AdminGroup;

const route = (overrides: Partial<CompositeModelRoute> = {}): CompositeModelRoute => ({
  id: 11,
  group_id: 7,
  public_model: "public/model",
  match_type: "exact",
  target_platform: "openai",
  upstream_model: "upstream/model",
  endpoint: "any",
  priority: 100,
  enabled: true,
  notes: "",
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  ...overrides,
});

function mountDialog() {
  return mount(GroupCompositeRoutesDialog, {
    props: {
      show: true,
      group,
    },
    global: {
      stubs: {
        BaseDialog: BaseDialogStub,
        Select: defineComponent({
          props: ["modelValue", "options"],
          emits: ["update:modelValue"],
          template: '<select><slot /></select>',
        }),
        PlatformIcon: true,
        Icon: true,
      },
    },
  });
}

describe("GroupCompositeRoutesDialog", () => {
  beforeEach(() => {
    listRoutes.mockResolvedValue([route()]);
    createRoute.mockResolvedValue(route({ id: 12 }));
    updateRoute.mockResolvedValue(route());
    deleteRoute.mockResolvedValue(undefined);
    previewRoute.mockResolvedValue({
      matched: true,
      source: "route",
      target_platform: "openai",
      upstream_model: "upstream/model",
      endpoint: "any",
    } satisfies CompositeRouteDecision);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads the selected group's routes when opened", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    expect(listRoutes).toHaveBeenCalledWith(7);
    expect(wrapper.findAll('[data-testid="composite-route-row"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("public/model");
  });

  it("creates and edits routes with the same form", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    await wrapper.get('[data-testid="composite-route-public-model"]').setValue("new/model");
    await wrapper.get('[data-testid="composite-route-upstream-model"]').setValue("new/upstream");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(createRoute).toHaveBeenCalledWith(7, {
      public_model: "new/model",
      match_type: "exact",
      target_platform: "openai",
      upstream_model: "new/upstream",
      endpoint: "any",
      priority: 100,
      enabled: true,
      notes: "",
    });

    await wrapper.get('[data-testid="composite-route-edit"]').trigger("click");
    await wrapper.get('[data-testid="composite-route-upstream-model"]').setValue("edited/upstream");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(updateRoute).toHaveBeenCalledWith(
      7,
      11,
      expect.objectContaining({ upstream_model: "edited/upstream" }),
    );
  });

  it("deletes and previews routes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mountDialog();
    await flushPromises();

    await wrapper.get('[data-testid="composite-route-delete"]').trigger("click");
    await flushPromises();
    expect(deleteRoute).toHaveBeenCalledWith(7, 11);

    await wrapper.get('[data-testid="composite-route-preview-model"]').setValue("public/model");
    await wrapper.get('[data-testid="composite-route-preview-button"]').trigger("click");
    await flushPromises();

    expect(previewRoute).toHaveBeenCalledWith(7, {
      model: "public/model",
      endpoint: "any",
    });
    expect(
      wrapper.get('[data-testid="composite-route-preview-result"]').text(),
    ).toContain("admin.groups.compositeRoutes.matched");
  });
});
