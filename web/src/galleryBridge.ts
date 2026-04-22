/**
 * Module-level bridge between the ComfyUI node extension system (plain JS) and
 * the gallery React tree. The `openPickMode` property is updated by GalleryProvider
 * after mount so the node extension can call `window.__comfyGallery.openPickMode(cb)`.
 */
export const galleryBridge: { openPickMode: (cb: (absPath: string) => void) => void } = {
    openPickMode: () => {},
};
