import { Menu } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { CreateAccountActions } from "@/components/create-account/create-account-actions";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { isManagedMode } from "@/lib/managed-mode";
import { isCreateProductMode } from "@/lib/create-product";

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const visibleNavigationTools = navigationTools.filter((tool) => tool.slug !== "config" || (!isManagedMode() && !isCreateProductMode()));
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    if (isManagedMode()) return null;

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="relative mx-auto flex h-full max-w-none items-stretch justify-between gap-5 px-6">
                        <div className="flex items-center gap-1">
                            <VersionReleaseModal />
                            <div className="flex items-center md:hidden">
                                <button
                                    type="button"
                                    className="inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"
                                    onClick={() => setMobileNavOpen(true)}
                                    aria-label={t("topNav.openMenu")}
                                    title={t("topNav.menu")}
                                >
                                    <Menu className="size-5" />
                                </button>
                            </div>
                        </div>

                        <nav className="hide-scrollbar absolute left-1/2 top-0 hidden h-14 -translate-x-1/2 items-center gap-7 overflow-x-auto md:flex">
                                {visibleNavigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="truncate">{t(`navigation.${tool.slug}`)}</span>
                                        </Link>
                                    );
                                })}
                        </nav>

                        <div className="my-auto ml-auto flex h-9 min-w-0 items-center justify-end gap-2 whitespace-nowrap">
                            {isCreateProductMode() ? <CreateAccountActions /> : <UserStatusActions />}
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}


