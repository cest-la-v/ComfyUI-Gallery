import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGalleryContext } from './GalleryContext';
import { useDebounce } from 'ahooks';

function SearchAutocomplete({
    value,
    onChange,
    options,
    placeholder,
}: {
    value: string;
    onChange: (v: string) => void;
    options: { value?: string | number | null; label?: ReactNode }[];
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [highlightedIdx, setHighlightedIdx] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const visibleOptions = options.slice(0, 20);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

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
                onChange(String(visibleOptions[highlightedIdx].value ?? ''));
                setOpen(false);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            setHighlightedIdx(-1);
        }
    }, [open, highlightedIdx, visibleOptions, onChange]);

    return (
        <div ref={containerRef} className="relative w-full">
            <div className="relative flex items-center">
                <input
                    ref={inputRef}
                    type="text"
                    className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm pr-8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                    value={value}
                    onChange={e => { onChange(e.target.value); setHighlightedIdx(-1); }}
                    onFocus={() => setOpen(true)}
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
                            key={String(opt.value ?? i)}
                            className={cn(
                                "px-3 py-1.5 text-sm cursor-pointer truncate",
                                i === highlightedIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                            )}
                            onMouseDown={e => { e.preventDefault(); onChange(String(opt.value ?? '')); setOpen(false); }}
                        >
                            {opt.label ?? opt.value}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const GalleryAssetsSearchBar = () => {
    const {
        setSearchFileName,
        imagesAutoCompleteNames,
        autoCompleteOptions, setAutoCompleteOptions,
    } = useGalleryContext();

    const [search, setSearch] = useState('');

    const debouncedSearch = useDebounce(search, { wait: 100 });
    useEffect(() => {
        setSearchFileName(debouncedSearch);
        if (!debouncedSearch) {
            setAutoCompleteOptions(imagesAutoCompleteNames);
        } else {
            setAutoCompleteOptions(
                imagesAutoCompleteNames.filter(opt =>
                    typeof opt.value === 'string' && opt.value.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
            );
        }
    }, [debouncedSearch, imagesAutoCompleteNames, setAutoCompleteOptions, setSearchFileName]);

    return (
        <div className="px-4 py-3 border-b shrink-0">
            <SearchAutocomplete
                value={search}
                onChange={setSearch}
                options={autoCompleteOptions?.length ? autoCompleteOptions : imagesAutoCompleteNames}
                placeholder="Search…"
            />
        </div>
    );
};

export default GalleryAssetsSearchBar;
