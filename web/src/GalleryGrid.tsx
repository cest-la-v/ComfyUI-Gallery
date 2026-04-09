import React, { useCallback, useEffect, useRef } from 'react';
import { AutoSizer } from 'react-virtualized';
import { VariableSizeGrid } from 'react-window';
import ImageCard, { ImageCardHeight, ImageCardWidth } from './ImageCard';
import { useGalleryContext } from './GalleryContext';
import { Loader2 } from 'lucide-react';
import { BASE_PATH } from './ComfyAppApi';
import { Badge } from '@/components/ui/badge';

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
        currentFolder,
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
            const hasThumbs = divMode !== 'date' && image.sample_paths && image.sample_paths.length > 0;
            return (
                <div
                    style={{
                        ...style,
                        width: `calc(${gridSize.columnCount} * ${ImageCardWidth + 16}px)`,
                        background: 'transparent',
                        display: 'flex',
                        flexDirection: hasThumbs ? 'column' : 'row',
                        alignItems: hasThumbs ? 'flex-start' : 'flex-end',
                        paddingLeft: 16,
                        paddingBottom: 8,
                        paddingTop: 16,
                        position: 'absolute',
                        zIndex: 2,
                        gap: hasThumbs ? 0 : 8,
                    }}
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#aaa', letterSpacing: '0.01em' }}
                              className={divMode === 'prompt' ? 'line-clamp-2' : ''}>
                            {image.name}
                        </span>
                        {image.count != null && (
                            <span style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#888' }}>
                                {image.count}
                            </span>
                        )}
                        {divMode === 'prompt' && image.divider_models && image.divider_models.map(m => (
                            <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{m}</Badge>
                        ))}
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
                    image={{ ...image, dragFolder: currentFolder }}
                    key={image.name}
                    onInfoClick={() => handleInfoClick(image)}
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
    }, [gridSize, imageInfoName, currentFolder]);

    return (
        <>
            {loading && (
                <div className="absolute inset-0 bg-zinc-900/50 z-[100] flex items-center justify-center">
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
