import { useMemo } from 'react';
import { useGalleryContext } from './GalleryContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

/** Shorten a group label to ≤5 chars for display in the narrow strip. */
function toShortLabel(label: string): string {
    if (label.length <= 5) return label;
    // ISO date "2025-01-30" → "01/30"
    const m = label.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}/${m[2]}`;
    // Year-month "2025-01" → "01"
    const ym = label.match(/^\d{4}-(\d{2})$/);
    if (ym) return ym[1];
    return label.slice(0, 5);
}

const MIN_LABEL_SPACING_PX = 12; // below this we switch to a dot

const GalleryGroupJumpers = () => {
    const { imagesDetailsList, gridSize, scrollToGroupKey } = useGalleryContext();

    const markers = useMemo(() => {
        const colCount = Math.max(1, gridSize.columnCount);
        const seen = new Set<string>();
        const found: { key: string; label: string }[] = [];

        for (let i = 0; i < imagesDetailsList.length; i += colCount) {
            const item = imagesDetailsList[i];
            if (item?.type === 'divider' && item.group_key && !seen.has(item.group_key)) {
                seen.add(item.group_key);
                found.push({ key: item.group_key, label: item.name });
            }
        }
        return found.length > 1 ? found : [];
    }, [imagesDetailsList, gridSize.columnCount]);

    if (markers.length === 0) return null;

    const N = markers.length;
    // Switch dots↔labels based on available vertical space per entry.
    const spacingPx = gridSize.height > 0 ? gridSize.height / N : MIN_LABEL_SPACING_PX;
    const showLabels = spacingPx >= MIN_LABEL_SPACING_PX;

    return (
        <div className="absolute right-0 top-0 h-full w-5 pointer-events-none z-[var(--cg-z-popup)]">
            {markers.map(({ key, label }, i) => (
                <Tooltip key={key}>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            className="absolute right-0 w-full -translate-y-1/2 flex items-center justify-end pr-0.5 pointer-events-auto cursor-pointer select-none leading-none transition-colors text-muted-foreground/50 hover:text-foreground"
                            style={{ top: `${((i + 0.5) / N) * 100}%` }}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => scrollToGroupKey(key)}
                        >
                            {showLabels
                                ? <span className="text-[9px] font-semibold">{toShortLabel(label)}</span>
                                : <span className="w-1 h-1 rounded-full bg-current" />
                            }
                        </button>
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
