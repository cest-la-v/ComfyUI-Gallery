import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import type { Slide } from 'yet-another-react-lightbox';
import { toast } from 'sonner';
import { AutoSizer } from 'react-virtualized';
import { VariableSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { MetadataPanel } from './MetadataPanel';
import type { FileDetails } from './types';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { Info, FileText, Copy, Download, Trash2, Check, Loader2, Music } from 'lucide-react';
import { saveAs } from 'file-saver';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

type GallerySlide = Slide & { fileDetails: FileDetails };

const GalleryImageGrid = () => {
    const {
        data,
        currentFolder,
        gridSize,
        setGridSize,
        autoSizer,
        setAutoSizer,
        imageInfoName,
        setImageInfoName,
        setPreviewingVideo,
        showRawMetadata,
        setShowRawMetadata,
        showMetadataPanel,
        setShowMetadataPanel,
        imagesDetailsList,
        loading,
    } = useGalleryContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<VariableSizeGrid>(null);
    const [copySuccess, setCopySuccess] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [showLightboxDeleteConfirm, setShowLightboxDeleteConfirm] = useState(false);
    const lightboxDeleteImageRef = useRef<FileDetails | undefined>(undefined);

    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === 'image' || img.type === 'media' || img.type === 'audio'),
        [imagesDetailsList]
    );

    const slides = useMemo<GallerySlide[]>(() =>
        previewableImages.map(img => ({
            src: `${BASE_PATH}${img.url}`,
            fileDetails: img,
        })),
        [previewableImages]
    );

    const currentImage: FileDetails | undefined = previewableImages[lightboxIndex];

    const getRowHeight = useCallback((rowIndex: number) => {
        const firstItem = imagesDetailsList[rowIndex * gridSize.columnCount];
        return firstItem?.type === 'divider' ? 56 : ImageCardHeight + 16;
    }, [imagesDetailsList, gridSize.columnCount]);

    useEffect(() => {
        gridRef.current?.resetAfterRowIndex(0);
    }, [imagesDetailsList, gridSize.columnCount]);

    const handleInfoClick = useCallback((imageName: string) => {
        const item = data?.folders?.[currentFolder]?.[imageName];
        if (item && (item.type === 'media' || item.type === 'audio')) setPreviewingVideo(item.name);
        else setPreviewingVideo(undefined);
        setImageInfoName(imageName);
    }, [setImageInfoName, data, currentFolder, setPreviewingVideo]);

    const openLightbox = useCallback((url: string) => {
        const idx = previewableImages.findIndex(img => img.url === url);
        if (idx >= 0) { setLightboxIndex(idx); setLightboxOpen(true); }
    }, [previewableImages]);

    const Cell = useCallback(({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
        const index = rowIndex * gridSize.columnCount + columnIndex;
        const image = imagesDetailsList[index];
        if (!image) return null;

        if (image.type === 'divider') {
            if (columnIndex !== 0) return null;
            return (
                <div
                    style={{
                        ...style,
                        width: `calc(${gridSize.columnCount} * ${ImageCardWidth + 16}px)`,
                        background: 'transparent',
                        display: 'flex',
                        alignItems: 'flex-end',
                        paddingLeft: 16,
                        paddingBottom: 8,
                        paddingTop: 16,
                        position: 'absolute',
                        zIndex: 2,
                        gap: 8,
                    }}
                >
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#aaa', letterSpacing: '0.01em' }}>
                        {image.name}
                    </span>
                    {image.count != null && (
                        <span style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#888' }}>
                            {image.count}
                        </span>
                    )}
                </div>
            );
        }

        if (image.type === 'empty-space') {
            return <div style={{ ...style, background: 'transparent' }} />;
        }

        return (
            <div style={{ ...style, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <ImageCard
                    image={{ ...image, dragFolder: currentFolder }}
                    key={image.name}
                    onInfoClick={() => handleInfoClick(image.name)}
                    onOpenLightbox={() => openLightbox(image.url)}
                />
            </div>
        );
    }, [gridSize.columnCount, imagesDetailsList, handleInfoClick, openLightbox, currentFolder]);

    useEffect(() => {
        const { width, height } = autoSizer;
        const columnCount = Math.max(1, Math.floor(width / (ImageCardWidth + 16)));
        const rowCount = Math.ceil(imagesDetailsList.length / columnCount);
        setGridSize({ width, height, columnCount, rowCount });
    }, [autoSizer.width, autoSizer.height, imagesDetailsList.length, autoSizer, setGridSize]);

    useEffect(() => {
        const grid = document.querySelector('.grid-element');
        if (grid) {
            Array.from(grid.children).forEach(child => { (child as HTMLElement).style.position = 'relative'; });
        }
    }, [gridSize, imageInfoName, currentFolder, data]);

    const handleLightboxView = useCallback(({ index }: { index: number }) => {
        const img = previewableImages[index];
        setLightboxIndex(index);
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


    const renderControls = useCallback(() => {
        if (!lightboxOpen || !currentImage) return null;
        if (currentImage.type === 'media' || currentImage.type === 'audio') return null;

        const btnCls = "p-2 rounded hover:bg-white/10 cursor-pointer transition-colors text-white/85 hover:text-white";
        const activeCls = "p-2 rounded bg-white/10 cursor-pointer transition-colors text-[#1890ff]";

        return (
            <div
                style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}
                onClick={e => e.stopPropagation()}
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
                    <div className="w-px h-5 bg-white/25 mx-1" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button className={copySuccess ? `${activeCls} text-green-400` : btnCls} onClick={() => {
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
                    <div className="w-px h-5 bg-white/25 mx-1" />
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
    }, [lightboxOpen, currentImage, showMetadataPanel, showRawMetadata, setShowMetadataPanel, setShowRawMetadata, copySuccess]);

    return (
        <div id="imagesBox" style={{ width: '100%', height: '100%', position: 'relative' }} ref={containerRef}>
            {loading && (
                <div className="absolute inset-0 bg-zinc-900/50 z-[100] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Lightbox */}
            <Lightbox
                open={lightboxOpen}
                index={lightboxIndex}
                slides={slides}
                close={handleLightboxClose}
                on={{ view: handleLightboxView }}
                render={{ slide: renderSlide, controls: renderControls }}
                styles={{ root: { '--yarl__color_backdrop': 'rgba(0,0,0,0.88)' } as Parameters<typeof Lightbox>[0]['styles'] extends { root?: infer R } ? R : never }}
            />

            {/* MetadataPanel: fixed overlay shown when lightbox is open */}
            {lightboxOpen && currentImage && (
                <MetadataPanel image={currentImage} />
            )}

            {/* Lightbox delete confirm */}
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
                            onClick={async () => {
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

            {imagesDetailsList.length === 0 ? (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    No images found
                </div>
            ) : (
                <AutoSizer>
                    {({ width, height }) => {
                        if (autoSizer.width !== width || autoSizer.height !== height) {
                            setTimeout(() => setAutoSizer({ width, height }), 0);
                        }
                        return (
                            <VariableSizeGrid
                                ref={gridRef}
                                columnCount={gridSize.columnCount}
                                rowCount={gridSize.rowCount}
                                columnWidth={() => ImageCardWidth + 16}
                                rowHeight={getRowHeight}
                                width={width}
                                height={height}
                                className="grid-element"
                                style={{ display: 'flex', alignContent: 'center', justifyContent: 'center' }}
                            >
                                {Cell}
                            </VariableSizeGrid>
                        );
                    }}
                </AutoSizer>
            )}
        </div>
    );
};

export default GalleryImageGrid;
