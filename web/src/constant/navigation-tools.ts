import { ImagePlus, Images, Maximize2, PackageSearch, Settings2, Video } from "lucide-react";

export const navigationTools = [
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "product-detail",
        icon: PackageSearch,
    },
    {
        slug: "assets",
        icon: Images,
    },
    {
        slug: "config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
