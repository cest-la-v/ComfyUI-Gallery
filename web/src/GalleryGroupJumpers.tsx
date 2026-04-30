import { useMemo } from 'react';
import { useGalleryContext } from './GalleryContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

/** Abbreviated label for compact display — at most 4 chars. */
function abbrevLabel(label: string): string {
    if (label.length <= 4) return label;
    // Date like "2025-01-30" → "01-30"
    const dateParts = label.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateParts) return `${dateParts[2]}/${dateParts[3]}`;
    // "Jan 2025" → "Jan"
    const monthYear = label.match(/^(\w{3})\s+\d{4}$/);
    if (monthYear) return monthYear[1];
    // Default: first 4 chars
    return label.slice(0, 4);
}

const GalleryGroupJumpers = () => {
    const { groupValues, imagesDetailsList, gridSize, scrollToGroupKey } = useGalleryContext();

    const totalRows = Math.max(1, Math.ceil(imagesDetailsList.length / Math.max(1, gridSize.columnCount)));

    const markers = useMemo(() => {
        if (groupValues.length <= 1) return [];
        const colCount = Math.max(1, gridSize.columnCount);
        return groupValues.map(({ key, label }) => {
            const dividerIdx = imagesDetailsList.findIndex(
                item => item.type === 'divider' && item.group_key === key
            );
            const rowIdx = dividerIdx >= 0 ? Math.floor(dividerIdx / colCount) : 0;
            const pct = totalRows > 1 ? (rowIdx / (totalRows - 1)) * 100 : 0;
            return { key, label, pct };
        });
    }, [groupValues, imagesDetailsList, gridSize.columnCount, totalRows]);

    if (markers.length <= 1) return null;

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
                    <TooltipContent side="left" className="text-xs font-mono">
                        {abbrevLabel(label)}
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
};

export default GalleryGroupJumpers;
