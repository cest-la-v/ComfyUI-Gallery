import React, { useCallback, useEffect, useRef } from 'react';
import { AutoSizer } from 'react-virtualized';
import { VariableSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { Loader2 } from 'lucide-react';
import { BASE_PATH } from './ComfyAppApi';
import { Badge } from '@/components/ui/badge';

const DIVIDER_HEIGHT = 56;



const GalleryGrid = () => {
    const {
        gridSize,
        setGridSize,
        autoSizer,
        setAutoSizer,
        imageInfoName,
        setImageInfoName,
        setPreviewingVideo,
        imagesDetailsList,
        loading,
        openLightbox,
        viewMode,
        pendingScrollKey,
        setPendingScrollKey,
    } = useGalleryContext();

    const gridRef = useRef<VariableSizeGrid>(null);

    const getRowHeight = useCallback((rowIndex: number) => {
        const firstItem = imagesDetailsList[rowIndex * gridSize.columnCount];
        if (firstItem?.type === 'divider') return DIVIDER_HEIGHT;
        return ImageCardHeight + 16;
    }, [imagesDetailsList, gridSize.columnCount]);

    useEffect(() => {
        gridRef.current?.resetAfterRowIndex(0);
    }, [imagesDetailsList, gridSize.columnCount]);

    // Scroll to a pending group key (from jumpers or drill-through navigation).
    // Fires on mount (handles cross-section switch) and when pendingScrollKey changes.
    useEffect(() => {
        if (!pendingScrollKey || !gridRef.current) return;
        const colCount = Math.max(1, gridSize.columnCount || 1);
        for (let i = 0; i < imagesDetailsList.length; i++) {
            const item = imagesDetailsList[i];
            if (item.type === 'divider' && item.group_key === pendingScrollKey) {
                gridRef.current.scrollToItem({ rowIndex: Math.floor(i / colCount), columnIndex: 0 });
                break;
            }
        }
        setPendingScrollKey(null);
    }, [pendingScrollKey, imagesDetailsList, gridSize.columnCount, setPendingScrollKey]);

    const handleInfoClick = useCallback((item: typeof imagesDetailsList[number]) => {
        if (item.type === 'media' || item.type === 'audio') setPreviewingVideo(item.name);
        else setPreviewingVideo(undefined);
        setImageInfoName(item.name);
    }, [setImageInfoName, setPreviewingVideo]);

    const Cell = useCallback(({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
        const index = rowIndex * gridSize.columnCount + columnIndex;
        const image = imagesDetailsList[index];
        if (!image) return null;

        if (image.type === 'divider') {
            if (columnIndex !== 0) return null;
            const isPrompt = (image.divider_mode ?? 'date') === 'prompt';
            return (
                <div
                    style={{
                        ...style,
                        width: `calc(${gridSize.columnCount} * ${ImageCardWidth + 16}px)`,
                        // eslint-disable-next-line no-restricted-syntax -- local stacking within divider row, not gallery-level z-index
                        zIndex: 'var(--cg-z-divider-label)',
                    }}
                    className="absolute flex items-center gap-2 pl-4 pt-4 pb-2 bg-transparent flex-wrap"
                >
                    <span className={`text-sm font-bold tracking-wide text-muted-foreground${isPrompt ? ' line-clamp-2' : ''}`}>
                        {image.name}
                    </span>
                    {image.count != null && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-[18px]">
                            {image.count}
                        </Badge>
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
                    image={{ ...image, dragFolder: image.rel_path?.includes('/') ? image.rel_path.slice(0, image.rel_path.lastIndexOf('/')) : '' }}
                    key={image.name}
                    showModelBadge={viewMode === 'prompt' && !!image.model}
                    onInfoClick={() => handleInfoClick(image)}
                    onOpenLightbox={() => openLightbox(image.url)}
                />
            </div>
        );
    }, [gridSize.columnCount, imagesDetailsList, handleInfoClick, openLightbox]);

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
    }, [gridSize, imageInfoName]);

    return (
        <>
            {loading && (
                <div className="absolute inset-0 bg-background/50 z-[var(--cg-z-grid-loading)] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}
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
                            >
                                {Cell}
                            </VariableSizeGrid>
                        );
                    }}
                </AutoSizer>
            )}
        </>
    );
};

export default GalleryGrid;
