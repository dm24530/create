import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { setManagedMode } from "@/lib/managed-mode";
import {
    bootstrapManagedConfigFromParent,
    listenManagedCanvasNavigationFromParent,
    listenManagedCloudSessionFromParent,
    listenManagedLocaleFromParent,
    listenManagedThemeFromParent,
    notifyManagedCanvasReady,
} from "@/lib/managed-bootstrap";
import { router } from "@/router";

initAnalytics();
listenManagedThemeFromParent();
listenManagedLocaleFromParent();
listenManagedCloudSessionFromParent();
listenManagedCanvasNavigationFromParent((path) => {
    void router.navigate(path);
});

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

const embedded = new URLSearchParams(window.location.search).get("embed") === "1";
if (embedded) setManagedMode(true);

const bootstrap = bootstrapManagedConfigFromParent();
const root = document.getElementById("root");

if (root) {
    createRoot(root).render(
        <React.StrictMode>
            <AppProviders>
                <RouterProvider router={router} />
            </AppProviders>
        </React.StrictMode>,
    );
    for (const delay of [0, 100, 300, 800, 1500, 3000]) {
        window.setTimeout(notifyManagedCanvasReady, delay);
    }
}

void bootstrap.catch((error) => {
    console.error("Failed to apply the managed canvas configuration.", error);
});
