import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#171717",
        primaryHover: "#000000",
        primaryText: "#ffffff",
        elevatedBg: "#ffffff",
        itemHoverBg: "rgba(23, 23, 23, 0.06)",
        itemSelectedBg: "rgba(23, 23, 23, 0.1)",
        itemSelectedHoverBg: "rgba(23, 23, 23, 0.14)",
        itemText: "#171717",
        tableSelectedBg: "rgba(17, 17, 17, 0.05)",
        tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
    },
    dark: {
        primary: "#fafafa",
        primaryHover: "#ffffff",
        primaryText: "#171717",
        elevatedBg: "#1c1917",
        itemHoverBg: "rgba(250, 250, 249, 0.08)",
        itemSelectedBg: "rgba(250, 250, 249, 0.12)",
        itemSelectedHoverBg: "rgba(250, 250, 249, 0.16)",
        itemText: "#fafafa",
        tableSelectedBg: "rgba(255, 255, 255, 0.08)",
        tableSelectedHoverBg: "rgba(255, 255, 255, 0.12)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgElevated: color.elevatedBg,
            controlItemBgHover: color.itemHoverBg,
            controlItemBgActive: color.itemSelectedBg,
            controlItemBgActiveHover: color.itemSelectedHoverBg,
        },
        components: {
            Button: {
                primaryShadow: "none",
                primaryColor: color.primaryText,
                defaultColor: dark ? "#e7e5e4" : "#292524",
                defaultBg: dark ? "rgba(255, 255, 255, 0.04)" : "#ffffff",
                defaultBorderColor: dark ? "rgba(255, 255, 255, 0.12)" : "#d6d3d1",
                defaultHoverBg: dark ? "rgba(255, 255, 255, 0.10)" : "#f5f5f4",
                defaultHoverColor: dark ? "#ffffff" : "#0c0a09",
                defaultHoverBorderColor: dark ? "rgba(255, 255, 255, 0.20)" : "#a8a29e",
                textTextColor: dark ? "#d6d3d1" : "#57534e",
                textTextHoverColor: dark ? "#ffffff" : "#0c0a09",
                textTextActiveColor: dark ? "#ffffff" : "#0c0a09",
                textHoverBg: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
            },
            Segmented: {
                itemColor: dark ? "#d6d3d1" : "#57534e",
                itemHoverColor: dark ? "#ffffff" : "#0c0a09",
                itemHoverBg: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
                itemActiveBg: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.10)",
                itemSelectedBg: dark ? "#292524" : "#ffffff",
                itemSelectedColor: dark ? "#fafaf9" : "#171717",
                trackBg: dark ? "rgba(255, 255, 255, 0.05)" : "#f5f5f4",
            },
            Tooltip: {
                colorBgSpotlight: dark ? "#292524" : "#ffffff",
                colorTextLightSolid: dark ? "#fafaf9" : "#171717",
            },
            Dropdown: {
                colorBgElevated: color.elevatedBg,
                colorText: color.itemText,
                controlItemBgHover: color.itemHoverBg,
                controlItemBgActive: color.itemSelectedBg,
                controlItemBgActiveHover: color.itemSelectedHoverBg,
            },
            Menu: {
                popupBg: color.elevatedBg,
                itemActiveBg: color.itemSelectedBg,
                itemHoverBg: color.itemHoverBg,
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: color.itemText,
                darkPopupBg: neutral.dark.elevatedBg,
                darkItemHoverBg: neutral.dark.itemHoverBg,
                darkItemSelectedBg: neutral.dark.itemSelectedBg,
                darkItemSelectedColor: neutral.dark.itemText,
            },
            Select: {
                optionActiveBg: color.itemHoverBg,
                optionSelectedBg: color.itemSelectedBg,
                optionSelectedColor: color.itemText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
