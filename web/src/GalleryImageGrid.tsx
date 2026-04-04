import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Image, Spin, Tooltip, Popconfirm, message, Tag } from 'antd';
import { AutoSizer } from 'react-virtualized';
import { FixedSizeGrid, VariableSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { MetadataPanel } from './MetadataPanel';
import type { FileDetails } from './types';
import { BASE_PATH, ComfyAppApi } from "./ComfyAppApi";
import { InfoCircleOutlined, FileTextOutlined, CopyOutlined, DownloadOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons';
import { saveAs } from 'file-saver';

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

    const getRowHeight = useCallback((rowIndex: number) => {
        const firstItem = imagesDetailsList[rowIndex * gridSize.columnCount];
        return firstItem?.type === 'divider' ? 56 : ImageCardHeight + 16;
    }, [imagesDetailsList, gridSize.columnCount]);

    useEffect(() => {
        gridRef.current?.resetAfterRowIndex(0);
    }, [imagesDetailsList, gridSize.columnCount]);

    const handleInfoClick = useCallback((imageName: string) => {
        // Set the info modal target
        
        // If the item is media/audio, set previewing state so the preview group uses media renderer
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
                        <Tag style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.08)', color: '#888' }}>
                            {image.count}
                        </Tag>
                    )}
                </div>
            );
        }
        if (image.type === 'empty-space') {
            return (
                <div 
                    key={`empty-space-${index}`} 
                    style={{ 
                        ...style, 
                        background: 'transparent' 
                    }} 
                />
            );
        }
        // Add folder info to drag data by wrapping ImageCard
        return (
            <div 
                key={`div-${image.name}`} 
                style={{ 
                    ...style, 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center' 
                }}
            >
                <ImageCard 
                    image={{ 
                        ...image, 
                        dragFolder: currentFolder 
                    }} 
                    key={image.name} 
                    index={index} 
                    onInfoClick={() => handleInfoClick(image.name)} onVideoClick={() => setPreviewingVideo(image.name)} 
                />
            </div>
        );
    }, [gridSize.columnCount, imagesDetailsList, handleInfoClick, setPreviewingVideo, currentFolder]);

    useEffect(() => {
        const { width, height } = autoSizer;
        const columnCount = Math.max(1, Math.floor(width / (ImageCardWidth + 16)));
        const rowCount = Math.ceil(imagesDetailsList.length / columnCount);
        setGridSize({ width, height, columnCount, rowCount });
    }, [autoSizer.width, autoSizer.height, imagesDetailsList.length]);

    useEffect(() => {
        const grid = document.querySelector(".grid-element");
        if (grid) {
            Array.from(grid.children).forEach(child => {
                (child as HTMLElement).style.position = 'relative';
            });
        }
    }, [gridSize, imageInfoName, currentFolder, data]);

    // Memoized previewable images for InfoView navigation and rendering
    const previewableImages = useMemo(() =>
        imagesDetailsList.filter(img => img.type === "image" || img.type === "media" || img.type === "audio"),
        [imagesDetailsList]
    );

    // Helper to resolve image for Info/Image render
    const resolvePreviewableImage = useCallback((image: FileDetails | undefined, info: { current: number }) => {
        if (image) return image;
        let resolved: FileDetails | undefined;
        // Try forward
        for (let index = info.current; index < previewableImages.length; index++) {
            let current = previewableImages[index];
            resolved = current;
            break;
        }
        // Try backward
        if (!resolved) {
            for (let index = info.current; index > 0 && index > previewableImages.length; index--) {
                let current = previewableImages[index];
                resolved = current;
                break;
            }
        }
        // If still not found, return undefined
        if (!resolved) return undefined;

        setImageInfoName(resolved!.name);

        return resolved;
    }, [previewableImages, imagesDetailsList, setImageInfoName]);

    // imageRender: pass through originalNode (keeps zoom/pan/toolbar) + overlay MetadataPanel
    const previewImageRender = useCallback((originalNode: React.ReactElement, info: { current: number }) => {
        let image: FileDetails | undefined = previewableImages[info.current];
        if (!image) {
            image = resolvePreviewableImage(image, info);
        }
        if (!image) return originalNode;

        // For video/audio: custom media render (no zoom needed)
        if (image.type === 'media') {
            return (
                <video
                    key={image.name}
                    style={{ maxWidth: '80%', maxHeight: '85vh' }}
                    src={`${BASE_PATH}${image.url}`}
                    autoPlay
                    controls
                    preload="none"
                />
            );
        }
        if (image.type === 'audio') {
            return (
                <audio
                    key={image.name}
                    style={{ width: '80%' }}
                    src={`${BASE_PATH}${image.url}`}
                    autoPlay
                    controls
                    preload="none"
                />
            );
        }

        // For images: keep the native zoomable originalNode, overlay metadata panel
        return (
            <>
                {originalNode}
                <MetadataPanel
                    image={image}
                />
            </>
        );
    }, [previewableImages, resolvePreviewableImage]);

    // toolbarRender: extend default toolbar with custom action buttons
    const previewToolbarRender = useCallback((originalNode: React.ReactElement, info: { actions: { onClose: () => void }; current: number }) => {
        const image = previewableImages[info.current];
        // For video/audio, hide toolbar
        if (image && (image.type === 'media' || image.type === 'audio')) return null;

        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {originalNode}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0,
                        marginLeft: 12,
                        borderLeft: '1px solid rgba(255,255,255,0.25)',
                        paddingLeft: 12,
                    }}
                >
                    <Tooltip title={showMetadataPanel && !showRawMetadata ? "Hide metadata" : "Show metadata"}>
                        <InfoCircleOutlined
                            style={{
                                fontSize: 18,
                                padding: '8px 12px',
                                cursor: 'pointer',
                                color: showMetadataPanel && !showRawMetadata ? '#1890ff' : '#ffffffd9',
                            }}
                            onClick={() => {
                                if (showMetadataPanel && !showRawMetadata) {
                                    setShowMetadataPanel(false);
                                } else {
                                    setShowMetadataPanel(true);
                                    setShowRawMetadata(false);
                                }
                            }}
                        />
                    </Tooltip>
                    <Tooltip title={showMetadataPanel && showRawMetadata ? "Hide Raw JSON" : "Raw JSON"}>
                        <FileTextOutlined
                            style={{ fontSize: 18, padding: '8px 12px', cursor: 'pointer', color: showMetadataPanel && showRawMetadata ? '#1890ff' : '#ffffffd9' }}
                            onClick={() => {
                                if (showMetadataPanel && showRawMetadata) {
                                    setShowMetadataPanel(false);
                                } else {
                                    setShowMetadataPanel(true);
                                    setShowRawMetadata(true);
                                }
                            }}
                        />
                    </Tooltip>
                    {image?.type === 'image' && (
                        <Tooltip title={copySuccess ? "Copied!" : "Copy image"}>
                            {copySuccess ? (
                                <CheckOutlined
                                    style={{ fontSize: 18, padding: '8px 12px', color: '#52c41a' }}
                                />
                            ) : (
                                <CopyOutlined
                                    style={{ fontSize: 18, padding: '8px 12px', cursor: 'pointer', color: '#ffffffd9' }}
                                    onClick={() => {
                                        if (!image) return;
                                        const img = new window.Image();
                                        img.crossOrigin = 'anonymous';
                                        img.src = `${BASE_PATH}${image.url}`;
                                        img.onload = () => {
                                            const canvas = document.createElement('canvas');
                                            canvas.width = img.width;
                                            canvas.height = img.height;
                                            const ctx = canvas.getContext('2d');
                                            if (ctx) {
                                                ctx.drawImage(img, 0, 0);
                                                canvas.toBlob(async (blob) => {
                                                    if (blob) {
                                                        try {
                                                            await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })]);
                                                            setCopySuccess(true);
                                                            setTimeout(() => setCopySuccess(false), 1200);
                                                        } catch { message.error('Clipboard copy failed'); }
                                                    }
                                                }, 'image/png');
                                            }
                                        };
                                    }}
                                />
                            )}
                        </Tooltip>
                    )}
                    <Tooltip title="Download">
                        <DownloadOutlined
                            style={{ fontSize: 18, padding: '8px 12px', cursor: 'pointer', color: '#ffffffd9' }}
                            onClick={async () => {
                                if (!image) return;
                                try {
                                    const response = await fetch(`${BASE_PATH}${image.url}`, { mode: 'cors' });
                                    if (!response.ok) throw new Error('Failed');
                                    const blob = await response.blob();
                                    saveAs(blob, image.name);
                                } catch { message.error('Failed to download file'); }
                            }}
                        />
                    </Tooltip>
                    <Popconfirm
                        title="Delete the image"
                        description="Are you sure you want to delete this image?"
                        onConfirm={async () => {
                            if (!image) return;
                            const next = previewableImages[info.current + 1] ?? previewableImages[info.current - 1];
                            const success = await ComfyAppApi.deleteImage(image.url);
                            if (success) {
                                setImageInfoName(next?.name);
                                message.success('Image deleted');
                            } else {
                                message.error('Failed to delete image');
                            }
                        }}
                        okText="Yes"
                        cancelText="No"
                    >
                        <Tooltip title="Delete">
                            <DeleteOutlined
                                style={{ fontSize: 18, padding: '8px 12px', cursor: 'pointer', color: '#ff4d4f' }}
                            />
                        </Tooltip>
                    </Popconfirm>
                </div>
            </div>
        );
    }, [previewableImages, showMetadataPanel, setShowMetadataPanel, setShowRawMetadata, showRawMetadata, setImageInfoName, copySuccess]);

    // onChange for preview navigation
    const previewOnChange = useCallback((current: number) => {
        const img = previewableImages[current];
        if (img) {
            setImageInfoName(img.name);
            if (img.type === 'media' || img.type === 'audio') {
                setPreviewingVideo(img.name);
            } else {
                setPreviewingVideo(undefined);
            }
        }
    }, [previewableImages, setImageInfoName, setPreviewingVideo]);

    // afterOpenChange for preview close
    const previewAfterOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setImageInfoName(undefined);
            setPreviewingVideo(undefined);
            setShowMetadataPanel(false);
            setShowRawMetadata(false);
        }
    }, [setImageInfoName, setPreviewingVideo, setShowMetadataPanel, setShowRawMetadata]);

    // Memoized current index for preview
    const previewableCurrentIndex = useMemo(() => {
        const index = previewableImages.findIndex(img => img.name === imageInfoName);
        return index < 0 ? undefined : index;
    }, [previewableImages, imageInfoName]);

    return (
        <div id="imagesBox" style={{ width: '100%', height: '100%', position: 'relative' }} ref={containerRef}>
            {loading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'rgba(30,30,30,0.5)',
                    zIndex: 100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <Spin size="large" />
                </div>
            )}
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
                    <Empty 
                        style={{ 
                            position: "absolute", 
                            top: "50%", 
                            left: "50%", 
                            transform: "translate(-50%, -50%)" 
                        }} 
                        description={"No images found"} 
                    />
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
                                    className={"grid-element"}
                                    style={{ 
                                        display: "flex", 
                                        alignContent: "center", 
                                        justifyContent: "center" 
                                    }}
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
