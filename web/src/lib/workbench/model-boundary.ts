import type { WorkbenchModelGroup } from "@/components/workbench/model-select";
import { workbenchModelDetailKey } from "@/hooks/use-model-plaza-details";
import { encodeChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

/**
 * Build workbench model options with a strict capability boundary. A channel
 * that has no model for the requested capability must remain empty rather than
 * exposing unrelated text, image, or video models.
 */
export function buildCapabilityModelGroups(
    channels: ModelChannel[],
    capability: ModelCapability,
): WorkbenchModelGroup[] {
    return channels
        .map((channel) => ({
            id: channel.id,
            name: channel.name,
            models: channel.models
                .filter((model) => model.capability === capability)
                .map((model) => ({
                    value: encodeChannelModel(channel.id, model.name),
                    label: model.name,
                    detailKey: workbenchModelDetailKey(channel.name, model.name),
                })),
        }))
        .filter((group) => group.models.length > 0);
}