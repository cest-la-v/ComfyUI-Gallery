import { useMemo } from 'react';
import { useGalleryContext } from './GalleryContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ImageCardHeight } from './ImageCard';

const DIVIDER_ROW_H = 56;
const IMAGE_ROW_H = ImageCardHeight + 16; // 466px

const GalleryGroupJumpers = () => {
    const { imagesDetailsList, gridSize, scrollToGroupKey } = useGalleryContext();

    const markers = useMemo(() => {
        const colCount = Math.max(1, gridSize.columnCount);
        const totalRows = Math.ceil(imagesDetailsList.length / colCount);
        if (totalRows === 0) return [];

        // Compute per-row heights and total content height
        let totalH = 0;
        const rowH: number[] = new Array(totalRows);
        for (let r = 0; r < totalRows; r++) {
            const h = imagesDetailsList[r * colCount]?.type === 'divider' ? DIVIDER_ROW_H : IMAGE_ROW_H;
            rowH[r] = h;
            totalH += h;
        }
        if (totalH === 0) return [];

        // Walk rows; record each group divider's cumulative pixel offset
        const seen = new Set<string>();
        const found: { key: string; label: string; pct: number }[] = [];
        let cumH = 0;
        for (let r = 0; r < totalRows; r++) {
            const item = imagesDetailsList[r * colCount];
            if (item?.type === 'divider' && item.group_key && !seen.has(item.group_key)) {
                seen.add(item.group_key);
                found.push({ key: item.group_key, label: item.name, pct: (cumH / totalH) * 100 });
            }
            cumH += rowH[r];
        }

        return found.length > 1 ? found : [];
    }, [imagesDetailsList, gridSize.columnCount]);

    if (markers.length === 0) return null;

    return (
        // top-1/bottom-1 inset (4px each side) keeps -translate-y-1/2 markers from
        // being clipped by the parent overflow-hidden without shifting their positions.
        <div className="absolute right-0 top-1 bottom-1 w-4 pointer-events-none z-[var(--cg-z-popup)]">
            {markers.map(({ key, label, pct }) => (
                <Tooltip key={key}>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="absolute right-0.5 -translate-y-1/2 w-2.5 h-1.5 rounded-full bg-muted-foreground/40 hover:bg-primary hover:w-3 hover:h-2 pointer-events-auto transition-all duration-100 cursor-pointer"
                            style={{ top: `${pct}%` }}
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
