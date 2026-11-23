import { useState, type ReactNode } from "react";
import { Image as AntImage, type ImageProps } from "antd";

type DetailImagePreviewProps = Omit<ImageProps, "preview"> & {
    previewCover?: ReactNode | false;
};

export function DetailImagePreview({ previewCover = false, ...props }: DetailImagePreviewProps) {
    const [open, setOpen] = useState(false);
    const [instanceKey, setInstanceKey] = useState(0);

    const closePreview = () => {
        setOpen(false);
        // Electron + React 19 can leave Ant Design's image-preview exit motion stuck forever.
        // Remounting the image removes the stale portal immediately and releases the page.
        setInstanceKey((current) => current + 1);
    };

    return (
        <AntImage
            key={instanceKey}
            {...props}
            preview={{
                open,
                onOpenChange: (nextOpen) => nextOpen ? setOpen(true) : closePreview(),
                cover: previewCover,
                mask: { closable: true, blur: true },
                imageRender: (image) => (
                    <div
                        data-image-preview-blank=""
                        className="flex size-full items-center justify-center"
                        onClick={(event) => {
                            if (event.target === event.currentTarget) closePreview();
                        }}
                    >
                        {image}
                    </div>
                ),
            }}
        />
    );
}
