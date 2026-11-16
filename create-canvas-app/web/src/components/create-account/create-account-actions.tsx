import { App, Button, Dropdown, Tooltip } from "antd";
import { BarChart3, KeyRound, LogOut, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { CreateApiKeysModal } from "@/components/create-account/create-api-keys-modal";
import { CreateUsageModal } from "@/components/create-account/create-usage-modal";
import { createLogout } from "@/services/create-auth";
import { listCreateManagedKeys, type CreateManagedKey } from "@/services/create-managed-channel";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

export function CreateAccountActions() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const session = useUserStore((state) => state.session);
    const clearSession = useUserStore((state) => state.clearSession);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const [keys, setKeys] = useState<CreateManagedKey[]>([]);
    const [keysLoading, setKeysLoading] = useState(false);
    const [keysOpen, setKeysOpen] = useState(false);
    const [usageOpen, setUsageOpen] = useState(false);

    const refreshKeys = async () => {
        if (!session) return;
        setKeysLoading(true);
        try {
            setKeys(await listCreateManagedKeys(session));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载 API 密钥失败");
        } finally {
            setKeysLoading(false);
        }
    };

    useEffect(() => {
        void refreshKeys();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.accessToken]);

    const logout = () => {
        if (!session) return;
        void createLogout(session).finally(() => {
            clearSession();
            window.location.reload();
        });
    };

    const initials = (user?.display_name || user?.username || user?.email || "U").slice(0, 2).toUpperCase();
    const iconClass = "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white";
    const menuItems = [
        ...(user?.email ? [{ key: "email", label: user.email, disabled: true }] : []),
        { key: "keys", label: "API 密钥" },
        { key: "usage", label: "使用记录" },
        { type: "divider" as const },
        { key: "logout", label: "退出登录", icon: <LogOut className="size-4" /> },
    ];

    return (
        <>
            <div className="inline-flex shrink-0 items-center gap-1">
                {user ? <button type="button" className="rounded-md px-2 py-1 text-sm font-medium tabular-nums text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30" title="可用余额" onClick={() => setUsageOpen(true)}>${Number(user.balance || 0).toFixed(2)}</button> : null}
                <Tooltip title="API 密钥">
                    <button type="button" className={iconClass} aria-label="API 密钥" onClick={() => { setKeysOpen(true); void refreshKeys(); }}>
                        <KeyRound className="size-4" />
                    </button>
                </Tooltip>
                <Tooltip title="使用记录">
                    <button type="button" className={iconClass} aria-label="使用记录" onClick={() => setUsageOpen(true)}>
                        <BarChart3 className="size-4" />
                    </button>
                </Tooltip>
                <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={iconClass} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: menuItems,
                        onClick: ({ key }) => {
                            if (key === "keys") { setKeysOpen(true); void refreshKeys(); }
                            if (key === "usage") setUsageOpen(true);
                            if (key === "logout") logout();
                        },
                    }}
                >
                    <button type="button" className="inline-flex size-8 items-center justify-center rounded-full border border-stone-200 bg-stone-100 text-xs font-semibold text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200" aria-label="账户菜单">
                        {initials || <UserRound className="size-4" />}
                    </button>
                </Dropdown>
            </div>
            <CreateApiKeysModal open={keysOpen} onClose={() => setKeysOpen(false)} session={session} keys={keys} loading={keysLoading} onRefresh={refreshKeys} />
            <CreateUsageModal open={usageOpen} onClose={() => setUsageOpen(false)} session={session} keys={keys} />
        </>
    );
}
