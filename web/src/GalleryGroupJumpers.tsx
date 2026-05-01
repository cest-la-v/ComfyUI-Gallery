import { useMemo } from 'react';
import { useGalleryContext } from './GalleryContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ImageCardHeight } from './ImageCard';

const DIVIDER_ROW_H = 56;
const IMAGE_ROW_H = ImageCardHeight + 16; // 466px
const HALF_MARKER_H = 3; // half of h-1.5 (6px) — clamping budget to avoid clip

const GalleryGroupJumpers = () => {
    const { imagesDetailsList, gridSize, scrollToGroupKey } = useGalleryContext();

    const markers = useMemo(() => {
        const colCount = Math.max(1, gridSize.columnCount);
        const viewportH = gridSize.height;
        const totalRows = Math.ceil(imagesDetailsList.length / colCount);
        if (totalRows === 0 || viewportH <= 0) return [];

        // Compute per-row heights and total content height
        let totalH = 0;
        const rowH: number[] = new Array(totalRows);
        for (let r = 0; r < totalRows; r++) {
            const h = imagesDetailsList[r * colCount]?.type === 'divider' ? DIVIDER_ROW_H : IMAGE_ROW_H;
            rowH[r] = h;
            totalH += h;
        }

        // The scrollbar maps scrollTop ∈ [0, scrollRange] to the full track height.
        // Use scrollRange (not totalH) so marker positions match scrollbar thumb positions.
        const scrollRange = totalH - viewportH;
        if (scrollRange <= 0) return []; // all content fits — no scroll, no jumpers

        // Walk rows, record each divider's scroll-aligned pixel position
        const seen = new Set<string>();
        const found: { key: string; label: string; topPx: number }[] = [];
        let cumH = 0;
        for (let r = 0; r < totalRows; r++) {
            const item = imagesDetailsList[r * colCount];
            if (item?.type === 'divider' && item.group_key && !seen.has(item.group_key)) {
                seen.add(item.group_key);
                // When scrollTop = cumH the divider is at the top of the viewport.
                // Map that scrollTop to a pixel position along the container height.
                const raw = (cumH / scrollRange) * viewportH;
                const topPx = Math.max(HALF_MARKER_H, Math.min(viewportH - HALF_MARKER_H, raw));
                found.push({ key: item.group_key, label: item.name, topPx });
            }
            cumH += rowH[r];
        }

        return found.length > 1 ? found : [];
    }, [imagesDetailsList, gridSize.columnCount, gridSize.height]);

    if (markers.length === 0) return null;

    return (
        <div className="absolute right-0 top-0 h-full w-4 pointer-events-none z-[var(--cg-z-popup)]">
            {markers.map(({ key, label, topPx }) => (
                <Tooltip key={key}>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="absolute right-0.5 -translate-y-1/2 w-2.5 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-primary hover:w-3 hover:h-2 pointer-events-auto transition-all duration-100 cursor-pointer"
                            style={{ top: topPx }}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => scrollToGroupKey(key)}
                        />
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs max-w-48 truncate">
                        {label}
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
};

export default GalleryGroupJumpers;
