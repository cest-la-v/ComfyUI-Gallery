import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'antd'; // PreviewGroup kept until Phase 7 lightbox migration
import { toast } from 'sonner';
import { AutoSizer } from 'react-virtualized';
import { VariableSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { MetadataPanel } from './MetadataPanel';
import type { FileDetails } from './types';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { Info, FileText, Copy, Download, Trash2, Check, Loader2 } from 'lucide-react';
import { saveAs } from 'file-saver';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

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
        imagesUrlsLists,
        loading,
    } = useGalleryContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<VariableSizeGrid>(null);
    const [copySuccess, setCopySuccess] = useState(false);
    const [showLightboxDeleteConfirm, setShowLightboxDeleteConfirm] = useState(false);
    const lightboxDeleteImageRef = useRef<FileDetails | undefined>(undefined);

    const getRowHeight = useCallback((rowIndex: number) => {
        const firstItem = imagesDetailsList[rowIndex * gridSize.columnCount];
        return firstItem?.type === 'divider' ? 56 : ImageCardHeight + 16;
    }, [imagesDetailsList, gridSize.columnCount]);

    useEffect(() => {
        gridRef.current?.resetAfterRowIndex(0);
    }, [imagesDetailsList, gridSize.columnCount]);

    const handleInfoClick = useCallback((imageName: string) => {
        const item = data?.folders?.[currentFolder]?.[imageName];
        if (item && (item.type === 'media' || item.type === 'audio')) {
            setPreviewingVideo(item.name);
        } else {
            setPreviewingVideo(undefined);
        }
        setImageInfoName(imageName);
    }, [setImageInfoName, data, currentFolder, setPreviewingVideo]);

    const Cell = useCallback(({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
        const index = rowIndex * gridSize.columnCount + columnIndex;
        const image = imagesDetailsList[index];
        if (!image) return null;

        if (image.type === 'divider') {
            if (columnIndex !== 0) return null;
            return (
                <div
                    key={`divider-${index}`}
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
            return <div key={`empty-space-${index}`} style={{ ...style, background: 'transparent' }} />;
        }

        return (
            <div key={`div-${image.name}`} style={{ ...style, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <ImageCard
                    image={{ ...image, dragFolder: currentFolder }}
                    key={image.name}
                    onInfoClick={() => handleInfoClick(image.name)}
                />
            </div>
        );
    }, [gridSize.columnCount, imagesDetailsList, handleInfoClick, currentFolder]);

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

    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === 'image' || img.type === 'media' || img.type === 'audio'),
        [imagesDetailsList]
    );

    const resolvePreviewableImage = useCallback((image: FileDetails | undefined, info: { current: number }) => {
        if (image) return image;
        for (let i = info.current; i < previewableImages.length; i++) {
            const cur = previewableImages[i];
            if (cur) { setImageInfoName(cur.name); return cur; }
        }
        return undefined;
    }, [previewableImages, setImageInfoName]);

    const previewImageRender = useCallback((originalNode: React.ReactElement, info: { current: number }) => {
        let image: FileDetails | undefined = previewableImages[info.current];
        if (!image) image = resolvePreviewableImage(image, info);
        if (!image) return originalNode;

        if (image.type === 'media') {
            return <video key={image.name} style={{ maxWidth: '80%', maxHeight: '85vh' }} src={`${BASE_PATH}${image.url}`} autoPlay controls preload="none" />;
        }
        if (image.type === 'audio') {
            return <audio key={image.name} style={{ width: '80%' }} src={`${BASE_PATH}${image.url}`} autoPlay controls preload="none" />;
        }
        return <>{originalNode}<MetadataPanel image={image} /></>;
    }, [previewableImages, resolvePreviewableImage]);

    const previewToolbarRender = useCallback((originalNode: React.ReactElement, info: { actions: { onClose: () => void }; current: number }) => {
        const image = previewableImages[info.current];
        if (image && (image.type === 'media' || image.type === 'audio')) return null;

        const iconStyle = { fontSize: 18, padding: '8px 12px', cursor: 'pointer', color: '#ffffffd9' } as const;
        const activeStyle = { ...iconStyle, color: '#1890ff' } as const;

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {originalNode}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginLeft: 12, borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 12 }}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Info
                                style={showMetadataPanel && !showRawMetadata ? activeStyle : iconStyle}
                                onClick={() => {
                                    if (showMetadataPanel && !showRawMetadata) setShowMetadataPanel(false);
                                    else { setShowMetadataPanel(true); setShowRawMetadata(false); }
                                }}
                            />
                        </TooltipTrigger>
                        <TooltipContent>{showMetadataPanel && !showRawMetadata ? 'Hide metadata' : 'Show metadata'}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <FileText
                                style={showMetadataPanel && showRawMetadata ? activeStyle : iconStyle}
                                onClick={() => {
                                    if (showMetadataPanel && showRawMetadata) setShowMetadataPanel(false);
                                    else { setShowMetadataPanel(true); setShowRawMetadata(true); }
                                }}
                            />
                        </TooltipTrigger>
                        <TooltipContent>{showMetadataPanel && showRawMetadata ? 'Hide Raw JSON' : 'Raw JSON'}</TooltipContent>
                    </Tooltip>
                    {image?.type === 'image' && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                {copySuccess ? (
                                    <Check style={{ ...iconStyle, color: '#52c41a', cursor: 'default' }} />
                                ) : (
                                    <Copy
                                        style={iconStyle}
                                        onClick={() => {
                                            if (!image) return;
                                            const img = new window.Image();
                                            img.crossOrigin = 'anonymous';
                                            img.src = `${BASE_PATH}${image.url}`;
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
                                        }}
                                    />
                                )}
                            </TooltipTrigger>
                            <TooltipContent>{copySuccess ? 'Copied!' : 'Copy image'}</TooltipContent>
                        </Tooltip>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Download
                                style={iconStyle}
                                onClick={async () => {
                                    if (!image) return;
                                    try {
                                        const r = await fetch(`${BASE_PATH}${image.url}`, { mode: 'cors' });
                                        if (!r.ok) throw new Error('Failed');
                                        saveAs(await r.blob(), image.name);
                                    } catch { toast.error('Failed to download file'); }
                                }}
                            />
                        </TooltipTrigger>
                        <TooltipContent>Download</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Trash2
                                style={{ ...iconStyle, color: '#ff4d4f' }}
                                onClick={() => {
                                    lightboxDeleteImageRef.current = image;
                                    setShowLightboxDeleteConfirm(true);
                                }}
                            />
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                </div>
            </div>
        );
    }, [previewableImages, showMetadataPanel, setShowMetadataPanel, setShowRawMetadata, showRawMetadata, copySuccess]);

    const previewOnChange = useCallback((current: number) => {
        const img = previewableImages[current];
        if (img) {
            setImageInfoName(img.name);
            if (img.type === 'media' || img.type === 'audio') setPreviewingVideo(img.name);
            else setPreviewingVideo(undefined);
        }
    }, [previewableImages, setImageInfoName, setPreviewingVideo]);

    const previewAfterOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setImageInfoName(undefined);
            setPreviewingVideo(undefined);
            setShowMetadataPanel(false);
            setShowRawMetadata(false);
        }
    }, [setImageInfoName, setPreviewingVideo, setShowMetadataPanel, setShowRawMetadata]);

    const previewableCurrentIndex = useMemo(() => {
        const index = previewableImages.findIndex(img => img.name === imageInfoName);
        return index < 0 ? undefined : index;
    }, [previewableImages, imageInfoName]);

    return (
        <div id="imagesBox" style={{ width: '100%', height: '100%', position: 'relative' }} ref={containerRef}>
            {loading && (
                <div className="absolute inset-0 bg-zinc-900/50 z-[100] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
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

            <Image.PreviewGroup
                items={imagesUrlsLists}
                preview={{
                    current: previewableCurrentIndex,
                    imageRender: previewImageRender,
                    toolbarRender: previewToolbarRender,
                    onChange: previewOnChange,
                    afterOpenChange: previewAfterOpenChange,
                    destroyOnClose: true,
                }}
            >
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
            </Image.PreviewGroup>
        </div>
    );
};

export default GalleryImageGrid;
