import { useEffect, useMemo, useState } from 'react';
import { useGalleryContext } from './GalleryContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ImageCardHeight } from './ImageCard';

const DIVIDER_ROW_H = 56;
const IMAGE_ROW_H = ImageCardHeight + 16; // 466 px

/** Shorten a group label to ≤5 chars for the pill face. */
function toShortLabel(label: string): string {
    if (label.length <= 5) return label;
    const m = label.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}/${m[2]}`;
    const ym = label.match(/^\d{4}-(\d{2})$/);
    if (ym) return ym[1];
    return label.slice(0, 5);
}

/** Minimum vertical px per marker before switching to dot-only mode. */
const MIN_LABEL_SPACING = 14;

const GalleryGroupJumpers = () => {
    const { imagesDetailsList, gridSize, scrollToGroupKey, gridScrollBus } = useGalleryContext();
    const [scrollTop, setScrollTop] = useState(0);

    useEffect(() => gridScrollBus.subscribe(setScrollTop), [gridScrollBus]);

    // Build marker list with cumulative content offsets for active-group detection.
    const markers = useMemo(() => {
        const colCount = Math.max(1, gridSize.columnCount);
        const seen = new Set<string>();
        const found: { key: string; label: string; cumH: number }[] = [];
        let cumH = 0;
        for (let i = 0; i < imagesDetailsList.length; i += colCount) {
            const item = imagesDetailsList[i];
            if (item?.type === 'divider' && item.group_key && !seen.has(item.group_key)) {
                seen.add(item.group_key);
                found.push({ key: item.group_key, label: item.name, cumH });
            }
            cumH += item?.type === 'divider' ? DIVIDER_ROW_H : IMAGE_ROW_H;
        }
        return found.length > 1 ? found : [];
    }, [imagesDetailsList, gridSize.columnCount]);

    // The active group is the last one whose divider has scrolled into the upper third.
    const activeKey = useMemo(() => {
        if (!markers.length) return null;
        const threshold = scrollTop + gridSize.height * 0.35;
        let active = markers[0].key;
        for (const { key, cumH } of markers) {
            if (cumH <= threshold) active = key;
            else break;
        }
        return active;
    }, [markers, scrollTop, gridSize.height]);

    if (markers.length === 0) return null;

    const N = markers.length;
    const spacingPx = gridSize.height > 0 ? gridSize.height / N : MIN_LABEL_SPACING;
    const showLabels = spacingPx >= MIN_LABEL_SPACING;

    return (
        <div className="absolute right-0 top-0 h-full w-16 pointer-events-none z-[var(--cg-z-popup)]">
            {markers.map(({ key, label }, i) => {
                const isActive = key === activeKey;
                return (
                    <Tooltip key={key}>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                className={cn(
                                    'absolute right-2 -translate-y-1/2 pointer-events-auto cursor-pointer select-none',
                                    'flex items-center justify-center',
                                    'rounded-full border transition-all duration-150',
                                    showLabels
                                        ? 'h-6 min-w-[44px] px-2 text-[10px] font-medium leading-none'
                                        : 'h-3 w-3',
                                    isActive
                                        ? 'bg-primary/25 text-primary border-primary/60 font-semibold scale-110'
                                        : 'bg-card/80 text-muted-foreground/70 border-border/50 hover:bg-card hover:text-foreground hover:border-border hover:scale-105 backdrop-blur-sm',
                                )}
                                style={{ top: `${((i + 0.5) / N) * 100}%` }}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => scrollToGroupKey(key)}
                            >
                                {showLabels
                                    ? toShortLabel(label)
                                    : <span className={cn('rounded-full', isActive ? 'w-2.5 h-2.5 bg-primary' : 'w-1.5 h-1.5 bg-current')} />
                                }
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs max-w-48 truncate">
                            {label}
                        </TooltipContent>
                    </Tooltip>
                );
            })}
        </div>
    );
};

export default GalleryGroupJumpers;
