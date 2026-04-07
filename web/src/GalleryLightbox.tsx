import React, { useMemo, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Lightbox from 'yet-another-react-lightbox';
import type { Slide } from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import { toast } from 'sonner';
import GalleryGrid from './GalleryGrid';
import { useGalleryContext } from './GalleryContext';
import { MetadataPanel } from './MetadataPanel';
import type { FileDetails } from './types';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { Info, FileText, Copy, Download, Trash2, Check, Music, RotateCcw, RotateCw, FlipHorizontal, FlipVertical } from 'lucide-react';
import { saveAs } from 'file-saver';
import { usePortal } from './PortalContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

// 'custom' type prevents yarl's isImageSlide() from returning true for video/audio,
// which would incorrectly activate the Zoom plugin on non-image slides.
type GallerySlide = Slide & { fileDetails: FileDetails; type?: string };

const GalleryLightbox = () => {
    const {
        imagesDetailsList,
        showRawMetadata,
        setShowRawMetadata,
        showMetadataPanel,
        setShowMetadataPanel,
        setImageInfoName,
        setPreviewingVideo,
    } = useGalleryContext();
    const portalTarget = usePortal();

    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [showLightboxDeleteConfirm, setShowLightboxDeleteConfirm] = useState(false);
    const lightboxDeleteImageRef = useRef<FileDetails | undefined>(undefined);
    const [copySuccess, setCopySuccess] = useState(false);
    const [imageRotation, setImageRotation] = useState<0 | 90 | 180 | 270>(0);
    const [imageFlipH, setImageFlipH] = useState(false);
    const [imageFlipV, setImageFlipV] = useState(false);

    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === 'image' || img.type === 'media' || img.type === 'audio'),
        [imagesDetailsList]
    );

    const slides = useMemo(() =>
        previewableImages.map(img => ({
            src: `${BASE_PATH}${img.url}`,
            fileDetails: img,
            // Mark non-image slides so yarl's isImageSlide() returns false,
            // preventing the Zoom plugin from wrapping video/audio slides.
            ...(img.type !== 'image' ? { type: 'custom' } : {}),
        })) as GallerySlide[],
        [previewableImages]
    );

    const currentImage: FileDetails | undefined = previewableImages[lightboxIndex];

    const openLightbox = useCallback((url: string) => {
        const idx = previewableImages.findIndex(img => img.url === url);
        if (idx >= 0) { setLightboxIndex(idx); setLightboxOpen(true); }
    }, [previewableImages]);

    const handleLightboxView = useCallback(({ index }: { index: number }) => {
        const img = previewableImages[index];
        setLightboxIndex(index);
        setImageRotation(0);
        setImageFlipH(false);
        setImageFlipV(false);
        if (img) {
            setImageInfoName(img.name);
            if (img.type === 'media' || img.type === 'audio') setPreviewingVideo(img.name);
            else setPreviewingVideo(undefined);
        }
    }, [previewableImages, setImageInfoName, setPreviewingVideo]);

    const handleLightboxClose = useCallback(() => {
        setLightboxOpen(false);
        setImageInfoName(undefined);
        setPreviewingVideo(undefined);
        setShowMetadataPanel(false);
        setShowRawMetadata(false);
        setImageRotation(0);
        setImageFlipH(false);
        setImageFlipV(false);
    }, [setImageInfoName, setPreviewingVideo, setShowMetadataPanel, setShowRawMetadata]);

    const renderSlide = useCallback(({ slide }: { slide: Slide }) => {
        const s = slide as GallerySlide;
        const img = s.fileDetails;
        if (!img) return undefined;
        if (img.type === 'media') {
            return (
                <video
                    key={img.name}
                    style={{ maxWidth: '80%', maxHeight: '85vh' }}
                    src={`${BASE_PATH}${img.url}`}
                    autoPlay
                    controls
                    preload="none"
                />
            );
        }
        if (img.type === 'audio') {
            return (
                <div key={img.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh', gap: 24 }}>
                    <Music style={{ color: '#1890ff' }} className="h-20 w-20" />
                    <span style={{ color: '#e6e6e6', fontSize: 16, maxWidth: 400, textAlign: 'center' }}>{img.name}</span>
                    <audio src={`${BASE_PATH}${img.url}`} autoPlay controls style={{ width: 360 }} />
                </div>
            );
        }
        return undefined; // use yarl default image renderer
    }, []);

    // Apply rotation/flip via slideContainer so it wraps the Zoom plugin's content
    const renderSlideContainer = useCallback(({ slide, children }: { slide: Slide; children?: React.ReactNode }) => {
        const gs = slide as GallerySlide;
        if (gs.fileDetails?.type !== 'image') return <>{children}</>;

        const transforms: string[] = [];
        if (imageRotation) transforms.push(`rotate(${imageRotation}deg)`);
        if (imageFlipH) transforms.push('scaleX(-1)');
        if (imageFlipV) transforms.push('scaleY(-1)');

        if (!transforms.length) return <>{children}</>;

        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transform: transforms.join(' '), transition: 'transform 0.2s ease' }}>
                {children}
            </div>
        );
    }, [imageRotation, imageFlipH, imageFlipV]);

    const renderToolbar = () => {
        if (!lightboxOpen || !currentImage) return null;
        if (currentImage.type === 'media' || currentImage.type === 'audio') return null;

        const btnCls = "lb-btn";
        const activeCls = "lb-btn lb-btn-active";

        return (
            <div
                style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3150 }}
            >
                <div className="flex items-center gap-1 rounded-lg px-2 py-1" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button className={showMetadataPanel && !showRawMetadata ? activeCls : btnCls} onClick={() => {
                                if (showMetadataPanel && !showRawMetadata) setShowMetadataPanel(false);
                                else { setShowMetadataPanel(true); setShowRawMetadata(false); }
                            }}>
                                <Info size={18} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{showMetadataPanel && !showRawMetadata ? 'Hide metadata' : 'Show metadata'}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button className={showMetadataPanel && showRawMetadata ? activeCls : btnCls} onClick={() => {
                                if (showMetadataPanel && showRawMetadata) setShowMetadataPanel(false);
                                else { setShowMetadataPanel(true); setShowRawMetadata(true); }
                            }}>
                                <FileText size={18} />
                            </button>
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
                            <button className={copySuccess ? `lb-btn lb-btn-active lb-btn-success` : btnCls} onClick={() => {
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
                            }}>
                                {copySuccess ? <Check size={18} /> : <Copy size={18} />}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{copySuccess ? 'Copied!' : 'Copy image'}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button className={btnCls} onClick={async () => {
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
                            <button className={`${btnCls} text-red-400 hover:text-red-300`} onClick={() => {
                                lightboxDeleteImageRef.current = currentImage;
                                setShowLightboxDeleteConfirm(true);
                            }}>
                                <Trash2 size={18} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                </div>
            </div>
        );
    };

    return (
        <div id="imagesBox" style={{ width: '100%', height: '100%', position: 'relative' }}>
            <Lightbox
                open={lightboxOpen}
                index={lightboxIndex}
                slides={slides}
                close={handleLightboxClose}
                on={{ view: handleLightboxView }}
                render={{ slide: renderSlide, slideContainer: renderSlideContainer }}
                plugins={[Zoom]}
                styles={{ root: { '--yarl__portal_zindex': '3100', '--yarl__color_backdrop': 'rgba(0,0,0,0.88)' } as Parameters<typeof Lightbox>[0]['styles'] extends { root?: infer R } ? R : never }}
            />

            {/* Toolbar: portaled to escape DialogContent's stacking context */}
            {createPortal(renderToolbar(), portalTarget ?? document.body)}

            {/* MetadataPanel: portaled for same reason */}
            {lightboxOpen && currentImage && createPortal(
                <MetadataPanel image={currentImage} />,
                portalTarget ?? document.body
            )}

            {/* Delete confirm */}
            <AlertDialog open={showLightboxDeleteConfirm} onOpenChange={setShowLightboxDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete the image</AlertDialogTitle>
                        <AlertDialogDescription>Are you sure you want to delete this image?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>No</AlertDialogCancel>
                        <AlertDialogAction
                            className={buttonVariants({ variant: 'destructive' })}
                            onPointerDown={async (e) => {
                                if (e.button !== 0) return;
                                const image = lightboxDeleteImageRef.current;
                                if (!image) return;
                                const current = previewableImages.findIndex(img => img.name === image.name);
                                const next = previewableImages[current + 1] ?? previewableImages[current - 1];
                                const success = await ComfyAppApi.deleteImage(image.url);
                                if (success) { setImageInfoName(next?.name); toast.success('Image deleted'); }
                                else toast.error('Failed to delete image');
                                setShowLightboxDeleteConfirm(false);
                            }}
                        >Yes</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <GalleryGrid onOpenLightbox={openLightbox} />
        </div>
    );
};

export default GalleryLightbox;
