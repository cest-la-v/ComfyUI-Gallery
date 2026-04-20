import React, { useState, useMemo, useCallback } from 'react';
import { MODULE_CONTROLLER, createModule, useLightboxState, useEvents, ACTION_PREV, ACTION_NEXT } from 'yet-another-react-lightbox';
import type { Plugin, ComponentProps } from 'yet-another-react-lightbox';
import { useGalleryContext } from './GalleryContext';
import { MetadataPanel } from './MetadataPanel';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import {
    Info, FileText, Copy, Download, Trash2,
    Check, X, RotateCcw, RotateCw, FlipHorizontal, FlipVertical,
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PortalProvider } from './PortalContext';

// Wrapper rendered inside yarl's portal (#comfy-gallery-yarl-root).
// React context propagates through createPortal fiber tree, so useGalleryContext() works here.
// AlertDialog is NOT safe here (it portals to #comfy-gallery-portals which is inert while yarl
// is open). Delete confirmation uses inline UI instead.
//
// We create a local portal-target div inside #comfy-gallery-yarl-root and override
// PortalContext so that Tooltip/Select/etc. portals target it — not the inert root.
function GalleryOverlayWrapper({ children }: ComponentProps) {
    const {
        showMetadataPanel, setShowMetadataPanel,
        showRawMetadata, setShowRawMetadata,
        setImageRotation,
        imageFlipH, setImageFlipH,
        imageFlipV, setImageFlipV,
        imagesDetailsList,
        closeLightbox,
        setImageInfoName,
        setLightboxIndex,
    } = useGalleryContext();

    const { currentIndex } = useLightboxState();
    const [copySuccess, setCopySuccess] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    // Portal override: Tooltip/Radix portals target this div (inside #comfy-gallery-yarl-root,
    // not inert), so they remain interactive while yarl's portal is open.
    const [lbPortalContainer, setLbPortalContainer] = useState<HTMLElement | null>(null);

    const { publish } = useEvents();

    const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); publish(ACTION_PREV); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); publish(ACTION_NEXT); }
    }, [publish]);

    const previewableImages = useMemo(
        () => imagesDetailsList.filter(img => img.type === 'image' || img.type === 'media' || img.type === 'audio'),
        [imagesDetailsList],
    );

    const currentImage = previewableImages[currentIndex];

    const handleDelete = useCallback(async () => {
        if (!currentImage) return;
        const success = await ComfyAppApi.deleteImage(currentImage.url);
        if (success) {
            toast.success('Image deleted');
            if (previewableImages.length <= 1) {
                closeLightbox();
            } else if (currentIndex >= previewableImages.length - 1) {
                // Deleted the last image — must go backwards (index will be out of bounds after refresh)
                setLightboxIndex(currentIndex - 1);
                setImageInfoName(previewableImages[currentIndex - 1].name);
            } else {
                // Non-last image: keep the same index — after data refresh previewableImages[currentIndex]
                // will naturally be the next image. Manually updating the index causes a double-switch
                // because on.view fires again once the slides array shrinks.
                setImageInfoName(previewableImages[currentIndex + 1].name);
            }
        } else {
            toast.error('Failed to delete image');
        }
        setConfirmingDelete(false);
    }, [currentImage, currentIndex, previewableImages, closeLightbox, setImageInfoName, setLightboxIndex]);

    const showToolbar = !!currentImage && currentImage.type !== 'media' && currentImage.type !== 'audio';
    const btnCls = 'lb-btn';
    const activeCls = 'lb-btn lb-btn-active';

    return (
        <PortalProvider value={lbPortalContainer}>
            {/* Portal target: all Radix/Tooltip portals inside this tree target this div */}
            <div ref={setLbPortalContainer} style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }} />

            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
                {/* Main row: carousel (left) + optional metadata panel (right) */}
                <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {/* Carousel area — contains {children} (MODULE_CONTROLLER) and the toolbar */}
                    <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                        {children}

                        {/* Toolbar: absolutely positioned at bottom-center of the carousel area */}
                        {showToolbar && (
                            <div style={{
                                position: 'absolute', bottom: 24, left: '50%',
                                transform: 'translateX(-50%)',
                                // eslint-disable-next-line no-restricted-syntax -- local stacking within yarl carousel area, not gallery-level z-index
                                zIndex: 10,
                                pointerEvents: 'auto',
                            }}>
                                {confirmingDelete ? (
                                    <div
                                        className="flex items-center gap-2 rounded-lg px-3 py-2"
                                        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
                                    >
                                        <span className="text-sm text-white mr-1">Delete this image?</span>
                                        <button className="lb-btn text-green-400 hover:text-green-300" onClick={handleDelete}>
                                            <Check size={18} />
                                        </button>
                                        <button className={btnCls} onClick={() => setConfirmingDelete(false)}>
                                            <X size={18} />
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        className="flex items-center gap-1 rounded-lg px-2 py-1"
                                        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
                                    >
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    className={showMetadataPanel && !showRawMetadata ? activeCls : btnCls}
                                                    onClick={() => {
                                                        if (showMetadataPanel && !showRawMetadata) setShowMetadataPanel(false);
                                                        else { setShowMetadataPanel(true); setShowRawMetadata(false); }
                                                    }}
                                                ><Info size={18} /></button>
                                            </TooltipTrigger>
                                            <TooltipContent>{showMetadataPanel && !showRawMetadata ? 'Hide metadata' : 'Show metadata'}</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    className={showMetadataPanel && showRawMetadata ? activeCls : btnCls}
                                                    onClick={() => {
                                                        if (showMetadataPanel && showRawMetadata) setShowMetadataPanel(false);
                                                        else { setShowMetadataPanel(true); setShowRawMetadata(true); }
                                                    }}
                                                ><FileText size={18} /></button>
                                            </TooltipTrigger>
                                            <TooltipContent>{showMetadataPanel && showRawMetadata ? 'Hide Raw JSON' : 'Raw JSON'}</TooltipContent>
                                        </Tooltip>
                                        <div className="lb-divider" />
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button className={btnCls} onClick={() => setImageRotation(r => ((r - 90 + 360) % 360) as 0 | 90 | 180 | 270)}>
                                                    <RotateCcw size={18} />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>Rotate Left</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button className={btnCls} onClick={() => setImageRotation(r => ((r + 90) % 360) as 0 | 90 | 180 | 270)}>
                                                    <RotateCw size={18} />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>Rotate Right</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button className={imageFlipH ? activeCls : btnCls} onClick={() => setImageFlipH(v => !v)}>
                                                    <FlipHorizontal size={18} />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>Flip Horizontal</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button className={imageFlipV ? activeCls : btnCls} onClick={() => setImageFlipV(v => !v)}>
                                                    <FlipVertical size={18} />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>Flip Vertical</TooltipContent>
                                        </Tooltip>
                                        <div className="lb-divider" />
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    className={copySuccess ? 'lb-btn lb-btn-active lb-btn-success' : btnCls}
                                                    onClick={async () => {
                                                        if (!currentImage) return;
                                                        const img = new window.Image();
                                                        img.crossOrigin = 'anonymous';
                                                        img.src = `${BASE_PATH}${currentImage.url}`;
                                                        img.onload = () => {
                                                            const canvas = document.createElement('canvas');
                                                            canvas.width = img.width; canvas.height = img.height;
                                                            const ctx = canvas.getContext('2d');
                                                            if (ctx) {
                                                                ctx.drawImage(img, 0, 0);
                                                                canvas.toBlob(async blob => {
                                                                    if (blob) {
                                                                        try {
                                                                            await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })]);
                                                                            setCopySuccess(true);
                                                                            setTimeout(() => setCopySuccess(false), 1200);
                                                                        } catch { toast.error('Clipboard copy failed'); }
                                                                    }
                                                                }, 'image/png');
                                                            }
                                                        };
                                                        img.onerror = () => toast.error('Failed to load image for copy');
                                                    }}
                                                >{copySuccess ? <Check size={18} /> : <Copy size={18} />}</button>
                                            </TooltipTrigger>
                                            <TooltipContent>{copySuccess ? 'Copied!' : 'Copy image'}</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button className={btnCls} onClick={async () => {
                                                    if (!currentImage) return;
                                                    try {
                                                        const r = await fetch(`${BASE_PATH}${currentImage.url}`, { mode: 'cors' });
                                                        if (!r.ok) throw new Error('Failed');
                                                        saveAs(await r.blob(), currentImage.name);
                                                    } catch { toast.error('Failed to download file'); }
                                                }}>
                                                    <Download size={18} />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent>Download</TooltipContent>
                                        </Tooltip>
                                        <div className="lb-divider" />
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    className={`${btnCls} text-red-400 hover:text-red-300`}
                                                    onClick={() => setConfirmingDelete(true)}
                                                ><Trash2 size={18} /></button>
                                            </TooltipTrigger>
                                            <TooltipContent>Delete</TooltipContent>
                                        </Tooltip>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Metadata panel — onKeyDown publishes to yarl event bus so ArrowLeft/Right
                        navigate even when focus is inside the panel (bypasses focus/sensor chain).
                        tabIndex={-1} makes the container focusable. onMouseDown focuses it when
                        clicking non-interactive areas (text/blank), so onKeyDown fires. Interactive
                        children (buttons) keep their own focus; keydown still bubbles up here. */}
                    {showMetadataPanel && currentImage && (
                        <div className="bg-card border-l border-border" style={{
                            width: 400, minWidth: 320,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            outline: 'none',
                        }}
                            tabIndex={-1}
                            onMouseDown={e => {
                                const t = e.target as HTMLElement;
                                if (!t.closest('button, input, textarea, select, a, [tabindex]')) {
                                    (e.currentTarget as HTMLElement).focus();
                                }
                            }}
                            onKeyDown={handlePanelKeyDown}
                        >
                            <MetadataPanel image={currentImage} />
                        </div>
                    )}
                </div>
            </div>
        </PortalProvider>
    );
}

export const GalleryOverlayPlugin: Plugin = ({ addParent }) => {
    addParent(MODULE_CONTROLLER, createModule('GalleryOverlay', GalleryOverlayWrapper));
};
