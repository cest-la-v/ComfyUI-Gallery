import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGalleryContext } from './GalleryContext';
import { useDebounce } from 'ahooks';
import { normalizeModelName } from './metadata-parser/samplerNormalizer';

type Suggestion = { value: string; label: string };

function SearchAutocomplete({
    value,
    onChange,
    options,
    placeholder,
}: {
    value: string;
    onChange: (v: string) => void;
    options: Suggestion[];
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [highlightedIdx, setHighlightedIdx] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);

    const visibleOptions = options.slice(0, 20);

    useEffect(() => { setHighlightedIdx(-1); }, [open, options]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open) {
            if (e.key === 'ArrowDown') { setOpen(true); e.preventDefault(); }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIdx(i => Math.min(i + 1, visibleOptions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            if (highlightedIdx >= 0 && highlightedIdx < visibleOptions.length) {
                e.preventDefault();
                onChange(visibleOptions[highlightedIdx].value);
                setOpen(false);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            setHighlightedIdx(-1);
        }
    }, [open, highlightedIdx, visibleOptions, onChange]);

    return (
        <div className="relative w-full">
            <div className="relative flex items-center">
                <input
                    ref={inputRef}
                    type="text"
                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm pr-8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                    value={value}
                    onChange={e => { onChange(e.target.value); setHighlightedIdx(-1); }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setOpen(false)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                />
                {value && (
                    <button
                        type="button"
                        className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                        onMouseDown={e => { e.preventDefault(); onChange(''); inputRef.current?.focus(); }}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            {open && visibleOptions.length > 0 && (
                <div className="absolute top-full mt-1 w-full rounded-md border bg-popover shadow-md z-[var(--cg-z-content)] max-h-48 overflow-y-auto">
                    {visibleOptions.map((opt, i) => (
                        <div
                            key={opt.value + i}
                            className={cn(
                                "px-3 py-1.5 text-sm cursor-pointer truncate",
                                i === highlightedIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                            )}
                            onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false); }}
                        >
                            {opt.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const GallerySearchBar = () => {
    const {
        gallerySection,
        setSearchQuery,
        imagesDetailsList,
        modelsSearch, setModelsSearch,
        promptsSearch, setPromptsSearch,
        assetSourceFilter, setAssetSourceFilter,
        settings,
    } = useGalleryContext();

    const isAssets = gallerySection === 'assets';
    const isModels = gallerySection === 'models';

    // Assets input is local + debounced before writing to context (heavier filtering)
    const [assetsInput, setAssetsInput] = useState('');
    const debouncedAssetsInput = useDebounce(assetsInput, { wait: 100 });
    useEffect(() => {
        setSearchQuery(debouncedAssetsInput);
    }, [debouncedAssetsInput, setSearchQuery]);

    const currentValue = isAssets ? assetsInput : isModels ? modelsSearch : promptsSearch;
    const handleChange = isAssets
        ? setAssetsInput
        : isModels
            ? setModelsSearch
            : setPromptsSearch;

    const placeholder = isAssets
        ? 'Search by name, model, prompt…'
        : isModels
            ? 'Search models…'
            : 'Search prompts…';

    // Enriched autocomplete for assets: filenames + model names + prompt snippets
    const autocompleteOptions = useMemo<Suggestion[]>(() => {
        if (!isAssets) return [];
        const term = assetsInput.toLowerCase();
        const media = imagesDetailsList.filter(
            i => i.type === 'image' || i.type === 'media' || i.type === 'audio'
        );

        const fileOpts: Suggestion[] = media
            .filter(i => !term || i.name.toLowerCase().includes(term))
            .slice(0, 10)
            .map(i => ({ value: i.name, label: i.name }));

        const modelSet = new Set<string>();
        const modelOpts: Suggestion[] = [];
        for (const i of media) {
            if (!i.model) continue;
            const name = normalizeModelName(i.model) ?? i.model;
            if (modelSet.has(name)) continue;
            if (term && !name.toLowerCase().includes(term)) continue;
            modelSet.add(name);
            modelOpts.push({ value: name, label: `Model: ${name}` });
            if (modelOpts.length >= 5) break;
        }

        const promptSet = new Set<string>();
        const promptOpts: Suggestion[] = [];
        for (const i of media) {
            if (!i.positive_prompt) continue;
            if (term && !i.positive_prompt.toLowerCase().includes(term)) continue;
            const snippet = i.positive_prompt.slice(0, 60);
            const key = snippet.toLowerCase();
            if (promptSet.has(key)) continue;
            promptSet.add(key);
            promptOpts.push({ value: snippet, label: `Prompt: ${snippet}` });
            if (promptOpts.length >= 5) break;
        }

        return [...fileOpts, ...modelOpts, ...promptOpts].slice(0, 20);
    }, [isAssets, assetsInput, imagesDetailsList]);

    const enabledSources = (settings.sourcePaths ?? []).filter(s => s.enabled !== false);
    const showSourceChips = isAssets && enabledSources.length > 1;

    return (
        <div className="px-4 py-3 border-b shrink-0">
            <SearchAutocomplete
                value={currentValue}
                onChange={handleChange}
                options={autocompleteOptions}
                placeholder={placeholder}
            />
            {showSourceChips && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setAssetSourceFilter('')}
                        className={cn(
                            "px-2.5 py-0.5 text-xs rounded-full border transition-colors",
                            assetSourceFilter === ''
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-transparent text-muted-foreground border-border hover:bg-accent"
                        )}
                    >
                        All
                    </button>
                    {enabledSources.map(src => (
                        <button
                            key={src.source_id}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => setAssetSourceFilter(
                                assetSourceFilter === src.source_id ? '' : src.source_id
                            )}
                            className={cn(
                                "px-2.5 py-0.5 text-xs rounded-full border transition-colors capitalize",
                                assetSourceFilter === src.source_id
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-transparent text-muted-foreground border-border hover:bg-accent"
                            )}
                        >
                            {src.label ?? src.source_id}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default GallerySearchBar;
