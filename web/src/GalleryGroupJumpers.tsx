import { useMemo } from 'react';
import { useGalleryContext } from './GalleryContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const GalleryGroupJumpers = () => {
    const { imagesDetailsList, gridSize, scrollToGroupKey } = useGalleryContext();

    const markers = useMemo(() => {
        const colCount = Math.max(1, gridSize.columnCount);
        const seen = new Set<string>();
        const found: { key: string; label: string; rowIdx: number }[] = [];

        for (let i = 0; i < imagesDetailsList.length; i++) {
            const item = imagesDetailsList[i];
            if (item.type === 'divider' && item.group_key && !seen.has(item.group_key)) {
                seen.add(item.group_key);
                found.push({ key: item.group_key, label: item.name, rowIdx: Math.floor(i / colCount) });
            }
        }

        if (found.length <= 1) return [];

        const totalRows = Math.ceil(imagesDetailsList.length / colCount);
        return found.map(({ key, label, rowIdx }) => ({
            key,
            label,
            // Clamp away from 0/100 so -translate-y-1/2 doesn't clip at container edges.
            pct: totalRows > 1 ? Math.min(97, Math.max(3, (rowIdx / (totalRows - 1)) * 100)) : 50,
        }));
    }, [imagesDetailsList, gridSize.columnCount]);

    if (markers.length === 0) return null;

    return (
        <div className="absolute right-0 top-0 h-full w-4 pointer-events-none z-[var(--cg-z-popup)]">
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
