import { Select } from "antd";

export type WorkbenchModelGroup = {
    id: string;
    name: string;
    models: Array<{ value: string; label: string }>;
};

type WorkbenchModelSelectProps = {
    label: string;
    value: string;
    groups: WorkbenchModelGroup[];
    onChange: (value: string) => void;
    onEmptyOpen?: () => void;
};

export function WorkbenchModelSelect({ label, value, groups, onChange, onEmptyOpen }: WorkbenchModelSelectProps) {
    const options = groups.map((group) => ({
        label: group.name,
        options: group.models,
    }));

    return (
        <Select
            aria-label={label}
            className="workbench-model-select w-full"
            value={value || undefined}
            placeholder="请先配置模型"
            options={options}
            showSearch
            optionFilterProp="label"
            popupMatchSelectWidth={false}
            notFoundContent="暂无云端模型"
            getPopupContainer={() => document.body}
            onOpenChange={(open) => {
                if (open && !groups.length) onEmptyOpen?.();
            }}
            onChange={onChange}
            styles={{ popup: { root: { zIndex: 1400, minWidth: 280, maxWidth: 440 } } }}
        />
    );
}
