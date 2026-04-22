import { useMemo } from 'react';
import { ArrowRight, CalendarDays, Box, MessageSquare, FolderOpen } from 'lucide-react';
import { BASE_PATH } from './ComfyAppApi';
import { useGalleryContext, computeGroups } from './GalleryContext';
import type { ViewMode } from './GalleryContext';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

const MODE_ICON: Record<ViewMode, React.ElementType> = {
    date: CalendarDays,
    model: Box,
    prompt: MessageSquare,
    folder: FolderOpen,
};

function formatGroupLabel(key: string, mode: string, label: string): string {
    if (mode === 'date' && key && key !== 'Unknown') {
        const d = new Date(key + 'T00:00:00');
        return isNaN(d.getTime()) ? key : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return label;
}

export default function GalleryOverview() {
    const { data, viewMode, sortMethod, setGroupFilter, setGridView, openLightbox, loading } = useGalleryContext();

    const groups = useMemo(() => {
        if (!data?.folders) return [];
        const allItems = Object.values(data.folders)
            .flatMap(folder => Object.values(folder as Record<string, import('./types').FileDetails>));
        return computeGroups(allItems, viewMode, sortMethod);
    }, [data, viewMode, sortMethod]);

    if (loading) {
        return (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-4 overflow-y-auto h-full">
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-48 rounded-lg" />
                ))}
            </div>
        );
    }

    return (
        <ScrollArea className="h-full w-full">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-4">
                {groups.map(({ key, label, items, samplePaths }) => {
                    const displayLabel = formatGroupLabel(key, viewMode, label);
                    const previewable = items.filter(i => i.type === 'image' || i.type === 'media');
                    const thumbs = previewable.slice(0, 4);
                    const totalCount = items.filter(i => i.type !== 'divider' && i.type !== 'empty-space').length;

                    return (
                        <Card key={key} className="overflow-hidden flex flex-col">
                            <CardHeader className="py-3 px-4 flex-row items-center justify-between gap-2 space-y-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {(() => { const Icon = MODE_ICON[viewMode]; return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />; })()}
                                    <p className="text-sm font-medium truncate leading-tight" title={displayLabel}>
                                        {displayLabel}
                                    </p>
                                </div>
                                <Badge variant="secondary" className="shrink-0 text-xs">
                                    {totalCount}
                                </Badge>
                            </CardHeader>
                            <CardContent className="px-4 pb-3 flex flex-col gap-3">
                                {/* Thumbnail strip */}
                                <div className="grid grid-cols-4 gap-1">
                                    {thumbs.length > 0 ? thumbs.map((item, idx) => (
                                        <button
                                            key={item.url ?? idx}
                                            type="button"
                                            className="aspect-square rounded overflow-hidden cursor-pointer border border-border hover:ring-2 hover:ring-primary transition-all"
                                            onClick={() => openLightbox(item.url)}
                                            onMouseDown={e => e.preventDefault()}
                                        >
                                            <img
                                                src={`${BASE_PATH}${samplePaths[idx] ? `/gallery/thumbnail?rel_path=${encodeURIComponent(samplePaths[idx])}` : item.url}`}
                                                alt={item.name}
                                                className="w-full h-full object-cover"
                                                onError={e => { (e.target as HTMLImageElement).src = `${BASE_PATH}${item.url}`; }}
                                            />
                                        </button>
                                    )) : (
                                        <div className="col-span-4 h-16 rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">
                                            No images
                                        </div>
                                    )}
                                </div>
                                {/* View all */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs self-end gap-1 text-muted-foreground hover:text-foreground"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => {
                                        setGroupFilter(key);
                                        setGridView('detail');
                                    }}
                                >
                                    View all {totalCount} <ArrowRight className="h-3 w-3" />
                                </Button>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </ScrollArea>
    );
}
