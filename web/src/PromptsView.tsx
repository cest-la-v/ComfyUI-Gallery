import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useGalleryContext, computeGroups } from './GalleryContext';
import { BASE_PATH } from './ComfyAppApi';

const PROMPT_PREVIEW_LEN = 100;

const PromptsView = () => {
    const { data, setGallerySection, setGroupFilter, setViewMode, setGridView, sortMethod } = useGalleryContext();
    const [search, setSearch] = useState('');

    const allItems = useMemo(
        () => Object.values(data?.folders ?? {}).flatMap(f => Object.values(f)),
        [data]
    );

    const promptGroups = useMemo(() => {
        return computeGroups(allItems, 'prompt', sortMethod)
            .filter(g => g.key !== '__noprompt__');
    }, [allItems, sortMethod]);

    const filtered = useMemo(() => {
        if (!search.trim()) return promptGroups;
        const q = search.toLowerCase();
        return promptGroups.filter(g => g.label.toLowerCase().includes(q));
    }, [promptGroups, search]);

    const handleClick = (fp: string) => {
        setGroupFilter(fp);
        setViewMode('prompt');
        setGridView('detail');
        setGallerySection('assets');
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-4 py-3 border-b shrink-0">
                <Input
                    placeholder="Search prompts…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-8"
                />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        {search ? 'No prompts match your search.' : 'No prompt data found.'}
                    </p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {filtered.map(({ key, label, items, samplePaths }) => {
                            const thumbPath = samplePaths[0];
                            const thumbUrl = thumbPath
                                ? `${BASE_PATH}/gallery/thumbnail?rel_path=${encodeURIComponent(thumbPath)}`
                                : null;
                            const preview = label.length > PROMPT_PREVIEW_LEN
                                ? label.slice(0, PROMPT_PREVIEW_LEN) + '…'
                                : label;

                            return (
                                <button
                                    key={key}
                                    onClick={() => handleClick(key)}
                                    onMouseDown={e => e.preventDefault()}
                                    className={cn(
                                        "group flex items-start gap-3 rounded-lg border bg-card p-2.5 text-left",
                                        "hover:border-primary hover:shadow-sm transition-all duration-150 cursor-pointer"
                                    )}
                                >
                                    {thumbUrl && (
                                        <div className="shrink-0 w-12 h-12 rounded overflow-hidden bg-muted">
                                            <img
                                                src={thumbUrl}
                                                alt=""
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                                                loading="lazy"
                                            />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                                        <span className="text-xs text-foreground line-clamp-2 leading-relaxed" title={label}>
                                            {preview}
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

export default PromptsView;
