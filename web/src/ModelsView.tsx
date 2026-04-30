import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useGalleryContext, computeGroups } from './GalleryContext';
import { normalizeModelName } from './metadata-parser/samplerNormalizer';
import { BASE_PATH } from './ComfyAppApi';

const ModelsView = () => {
    const { data, setGallerySection, setGroupFilter, setViewMode, setGridView, sortMethod, modelsSearch } = useGalleryContext();

    const allItems = useMemo(
        () => Object.values(data?.folders ?? {}).flatMap(f => Object.values(f)),
        [data]
    );

    const modelGroups = useMemo(() => {
        const groups = computeGroups(allItems, 'model', sortMethod);
        return groups.filter(g => g.key !== 'Unknown');
    }, [allItems, sortMethod]);

    const filtered = useMemo(() => {
        if (!modelsSearch.trim()) return modelGroups;
        const q = modelsSearch.toLowerCase();
        return modelGroups.filter(g =>
            (normalizeModelName(g.key) ?? g.key).toLowerCase().includes(q)
        );
    }, [modelGroups, modelsSearch]);

    const handleClick = (modelKey: string) => {
        setGroupFilter(modelKey);
        setViewMode('model');
        setGridView('detail');
        setGallerySection('assets');
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        {modelsSearch ? 'No models match your search.' : 'No model data found.'}
                    </p>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                        {filtered.map(({ key, items, samplePaths }) => {
                            const displayName = normalizeModelName(key);
                            const thumbPath = samplePaths[0];
                            const thumbUrl = thumbPath
                                ? `${BASE_PATH}/gallery/thumbnail?rel_path=${encodeURIComponent(thumbPath)}`
                                : null;

                            return (
                                <button
                                    key={key}
                                    onClick={() => handleClick(key)}
                                    onMouseDown={e => e.preventDefault()}
                                    className={cn(
                                        "group flex flex-col rounded-lg border bg-card overflow-hidden text-left",
                                        "hover:border-primary hover:shadow-md transition-all duration-150 cursor-pointer"
                                    )}
                                >
                                    <div className="aspect-square w-full bg-muted overflow-hidden">
                                        {thumbUrl ? (
                                            <img
                                                src={thumbUrl}
                                                alt={displayName}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                                                No preview
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-2 flex flex-col gap-0.5">
                                        <span className="text-xs font-medium truncate leading-tight" title={displayName}>
                                            {displayName}
                                        </span>
                                        <Badge variant="secondary" className="self-start text-[10px] px-1.5 py-0">
                                            {items.length}
                                        </Badge>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ModelsView;
