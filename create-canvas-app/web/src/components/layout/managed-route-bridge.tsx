import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { notifyManagedCanvasRoute } from "@/lib/managed-bootstrap";

export function ManagedRouteBridge() {
    const location = useLocation();

    useEffect(() => {
        notifyManagedCanvasRoute(location.pathname, location.search, location.hash);
    }, [location.hash, location.pathname, location.search]);

    return null;
}
