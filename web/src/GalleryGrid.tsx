import React, { useCallback, useEffect, useRef } from 'react';
import { AutoSizer } from 'react-virtualized';
import { VariableSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { Loader2 } from 'lucide-react';
import { BASE_PATH } from './ComfyAppApi';

const THUMB_SIZE = 64;
const FALLBACK_SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const DIVIDER_HEIGHT: Record<string, number> = {
    date: 56,
    model: 96,
    prompt: 128,
};

function ThumbnailStrip({ samplePaths }: { samplePaths: string[] }) {
    return (
        <div className="flex gap-1 mt-2 overflow-hidden">
            {samplePaths.slice(0, 4).map((rel, i) => (
                <img
                    key={i}
                    src={`${BASE_PATH}/static_gallery/${rel}`}
                    className="object-cover rounded shrink-0"
                    style={{ width: THUMB_SIZE, height: THUMB_SIZE, minWidth: THUMB_SIZE }}
                    onError={e => { (e.target as HTMLImageElement).src = FALLBACK_SRC; }}
                />
            ))}
        </div>
    );
}

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
    } = useGalleryContext();

    const gridRef = useRef<VariableSizeGrid>(null);

    const getRowHeight = useCallback((rowIndex: number) => {
        const firstItem = imagesDetailsList[rowIndex * gridSize.columnCount];
        if (firstItem?.type === 'divider') {
            return DIVIDER_HEIGHT[firstItem.divider_mode ?? 'date'] ?? 56;
        }
        return ImageCardHeight + 16;
    }, [imagesDetailsList, gridSize.columnCount]);

    useEffect(() => {
        gridRef.current?.resetAfterRowIndex(0);
    }, [imagesDetailsList, gridSize.columnCount]);

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
            const divMode = image.divider_mode ?? 'date';
            const isPrompt = divMode === 'prompt';
            const hasThumbs = isPrompt && image.sample_paths && image.sample_paths.length > 0;
            const centered = divMode === 'date' || divMode === 'model';
            return (
                <div
                    style={{
                        ...style,
                        width: `calc(${gridSize.columnCount} * ${ImageCardWidth + 16}px)`,
                        background: 'transparent',
                        display: 'flex',
                        flexDirection: hasThumbs ? 'column' : 'row',
                        alignItems: centered ? 'center' : hasThumbs ? 'flex-start' : 'flex-end',
                        justifyContent: centered ? 'center' : undefined,
                        paddingLeft: centered ? undefined : 16,
                        paddingBottom: 8,
                        paddingTop: 16,
                        position: 'absolute',
                        // eslint-disable-next-line no-restricted-syntax -- local stacking within divider row, not gallery-level z-index
                        zIndex: 'var(--cg-z-divider-label)',
                        gap: hasThumbs ? 0 : 8,
                    }}
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--muted-foreground)', letterSpacing: '0.01em' }}
                              className={divMode === 'prompt' ? 'line-clamp-2' : ''}>
                            {image.name}
                        </span>
                        {image.count != null && (
                            <span style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 10, background: 'color-mix(in oklch, var(--foreground) 8%, transparent)', color: 'var(--muted-foreground)' }}>
                                {image.count}
                            </span>
                        )}
                    </div>
                    {hasThumbs && <ThumbnailStrip samplePaths={image.sample_paths!} />}
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
                                style={{ display: 'flex', alignContent: 'center', justifyContent: 'center' }}
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
