import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    X, Settings, Sun, Moon, Loader2, Folder, Palette,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useGalleryContext } from './GalleryContext';
import type { ViewMode } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { BASE_THEMES, ACCENT_THEMES } from './themes';

const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
    { label: 'By Date', value: 'date' },
    { label: 'By Model', value: 'model' },
    { label: 'By Prompt', value: 'prompt' },
];

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

    // Reset highlight when options change or dropdown closes
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
        <div ref={containerRef} className="relative flex-1 min-w-[120px] max-w-[280px]">
            <div className="relative flex items-center">
                <input
                    ref={inputRef}
                    type="text"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm pr-8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
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

function ViewModeSelector({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
    return (
        <ToggleGroup
            type="single"
            value={value}
            onValueChange={v => v && onChange(v as ViewMode)}
            variant="outline"
            className="shrink-0 h-9"
        >
            {VIEW_MODE_OPTIONS.map(opt => (
                <ToggleGroupItem key={opt.value} value={opt.value} className="text-sm px-3 h-9">
                    {opt.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

const GalleryHeader = () => {
    const {
        setShowSettings,
        setSearchFileName,
        sortMethod, setSortMethod,
        viewMode, setViewMode,
        imagesAutoCompleteNames,
        autoCompleteOptions, setAutoCompleteOptions,
        setOpen,
        selectedImages, setSelectedImages,
        mutate,
        currentFolder, setCurrentFolder,
        data,
        settings, setSettings,
    } = useGalleryContext();

    const [search, setSearch] = useState("");
    const [showClose, setShowClose] = useState(false);
    const [targetDate, setTargetDate] = useState<number>();
    const [countdown] = useCountDown({
        targetDate,
        onEnd: () => { setOpen(false); setShowClose(false); setTargetDate(undefined); },
    });
    const dragCounter = useRef(0);

    const [downloading, setDownloading] = useState(false);
    const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        const onDragStart = () => setShowClose(true);
        const onDragEnd = () => { setShowClose(false); setTargetDate(undefined); };
        window.addEventListener('dragstart', onDragStart);
        window.addEventListener('dragend', onDragEnd);
        return () => {
            window.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragend', onDragEnd);
        };
    }, []);

    const debouncedSearch = useDebounce(search, { wait: 100 });
    useEffect(() => {
        setSearchFileName(debouncedSearch);
        if (!debouncedSearch || debouncedSearch.length == 0) {
            setAutoCompleteOptions(imagesAutoCompleteNames);
        } else {
            setAutoCompleteOptions(
                imagesAutoCompleteNames.filter(opt =>
                    typeof opt.value === 'string' && opt.value.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
            );
        }
    }, [debouncedSearch, imagesAutoCompleteNames, setAutoCompleteOptions, setSearchFileName]);

    const handleBulkDownload = useCallback(async () => {
        setDownloading(true);
        try {
            const zip = new JSZip();
            await Promise.all(selectedImages.map(async (url) => {
                try {
                    const fetchUrl = url.startsWith('http') ? url : `${BASE_PATH}${url}`;
                    const blob = await (await fetch(fetchUrl)).blob();
                    zip.file(url.split('/').pop() || 'image', blob);
                } catch (e) { console.error('Failed to fetch image:', url, e); }
            }));
            FileSaver.saveAs(await zip.generateAsync({ type: 'blob' }), 'comfy-ui-gallery-images.zip');
        } catch { toast.error('Failed to download images.'); }
        finally { setDownloading(false); }
    }, [selectedImages]);

    const handleBulkDelete = useCallback(async () => {
        let deleted = 0;
        const failed: string[] = [];
        for (const url of selectedImages) {
            try {
                if (await ComfyAppApi.deleteImage(url)) {
                    deleted++;
                    mutate((oldData) => {
                        if (!oldData?.folders) return oldData;
                        const folders = { ...oldData.folders };
                        for (const folder of Object.keys(folders)) {
                            const files = { ...folders[folder] };
                            for (const filename of Object.keys(files)) {
                                if (files[filename].url === url) delete files[filename];
                            }
                            if (Object.keys(files).length === 0) delete folders[folder];
                            else folders[folder] = files;
                        }
                        return { ...oldData, folders };
                    });
                } else { failed.push(url); }
                await new Promise(res => setTimeout(res, 50));
            } catch (e) { console.error('Failed to delete image:', url, e); failed.push(url); }
        }
        setSelectedImages([]);
        if (failed.length > 0) toast.warning(`Deleted ${deleted} image(s), ${failed.length} failed.`);
        else toast.success(`Deleted ${deleted} image(s).`);
    }, [selectedImages, mutate, setSelectedImages]);

    // Build folder options from data for the toolbar dropdown
    const ALL_FOLDERS = '__all__';

    const folderOptions = useMemo(() => {
        if (!data?.folders) return [{ value: ALL_FOLDERS, label: 'All' }];
        const paths = Object.keys(data.folders).sort();
        const root = paths[0]?.split('/')[0] ?? '';
        const totalCount = paths.reduce((acc, p) => acc + Object.keys(data.folders![p] ?? {}).length, 0);
        const options = [{ value: ALL_FOLDERS, label: `All (${totalCount})` }];
        for (const p of paths) {
            const stripped = root && p.startsWith(root) ? p.slice(root.length + 1) : p;
            const count = Object.keys(data.folders[p] ?? {}).length;
            options.push({ value: p, label: `${stripped || '(root)'} (${count})` });
        }
        return options;
    }, [data]);

    return (
        <div className="flex items-center justify-between w-full gap-2">

            {/* Left zone: folder selector + bulk actions + active filter tag */}
            <div className="flex items-center gap-2 shrink-0">
                <Select
                    value={currentFolder === '' ? ALL_FOLDERS : currentFolder}
                    onValueChange={v => setCurrentFolder(v === ALL_FOLDERS ? '' : v)}
                >
                    <SelectTrigger className="h-9 min-w-[140px] max-w-[220px] shrink-0">
                        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[var(--cg-z-popup)]">
                        {folderOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {selectedImages && selectedImages.length > 0 && (
                    <>
                        <Button
                            disabled={downloading}
                            onClick={() => !downloading && setShowDownloadConfirm(true)}
                            className="selectedImagesActionButton"
                        >
                            {downloading && <Loader2 className="h-4 w-4 animate-spin" />}
                            Download Selected
                        </Button>
                        <AlertDialog open={showDownloadConfirm} onOpenChange={setShowDownloadConfirm}>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Download Selected Images</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Are you sure you want to download {selectedImages.length} selected image(s)?
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel onClick={() => toast.info('Download cancelled')}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={async () => { setShowDownloadConfirm(false); await handleBulkDownload(); }}>
                                        Download ({selectedImages.length})
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>

                        <Button
                            variant="destructive"
                            onClick={() => setShowDeleteConfirm(true)}
                            className="selectedImagesActionButton"
                        >
                            Delete Selected
                        </Button>
                        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Selected Images</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Are you sure you want to delete {selectedImages.length} selected image(s)? This cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel onClick={() => toast.info('Delete cancelled')}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        className={buttonVariants({ variant: 'destructive' })}
                                        onClick={async () => { setShowDeleteConfirm(false); await handleBulkDelete(); }}
                                    >
                                        Delete ({selectedImages.length})
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </>
                )}
            </div>
            <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
                <SearchAutocomplete
                    value={search}
                    onChange={val => setSearch(val)}
                    options={autoCompleteOptions && autoCompleteOptions.length > 0 ? autoCompleteOptions : imagesAutoCompleteNames}
                    placeholder="Search…"
                />

                <ViewModeSelector
                    value={viewMode}
                    onChange={v => setViewMode(v)}
                />

                {/* Sort select */}
                <Select
                    value={sortMethod}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onValueChange={v => setSortMethod(v as any)}
                >
                    <SelectTrigger className="h-9 min-w-[130px] shrink-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[var(--cg-z-popup)]">
                        <SelectItem value="Newest">Newest</SelectItem>
                        <SelectItem value="Oldest">Oldest</SelectItem>
                        <SelectItem value="Name ↑">A → Z</SelectItem>
                        <SelectItem value="Name ↓">Z → A</SelectItem>
                    </SelectContent>
                </Select>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="comfy-gallery-icon-btn" // hover bg still applied here
                            onClick={() => setSettings({ ...settings, darkMode: !settings.darkMode })}
                        >
                            {settings.darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{settings.darkMode ? 'Light Mode' : 'Dark Mode'}</TooltipContent>
                </Tooltip>

                {/* Theme quick-pick popover */}
                <Popover>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="comfy-gallery-icon-btn"
                                    onMouseDown={e => e.preventDefault()}
                                >
                                    <Palette className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Theme</TooltipContent>
                    </Tooltip>
                    <PopoverContent align="end" className="w-64 p-3 flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Base Theme</span>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    title="Default"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => setSettings({ ...settings, themeBase: 'default' })}
                                    className={cn(
                                        "size-6 rounded-full overflow-hidden ring-offset-background transition-all shrink-0",
                                        settings.themeBase === 'default' ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                    )}
                                >
                                    <div className="flex h-full">
                                        <div className="flex-1 bg-[oklch(0.141_0.005_285.823)]" />
                                        <div className="flex-1 bg-[oklch(0.985_0_0)]" />
                                    </div>
                                </button>
                                {BASE_THEMES.map(t => (
                                    <button
                                        key={t.name}
                                        type="button"
                                        title={t.label}
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => setSettings({ ...settings, themeBase: t.name })}
                                        className={cn(
                                            "size-6 rounded-full ring-offset-background transition-all shrink-0",
                                            settings.themeBase === t.name ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                        )}
                                        style={{ backgroundColor: t.preview }}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Accent Color</span>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    title="Default"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => setSettings({ ...settings, themeAccent: 'default' })}
                                    className={cn(
                                        "size-6 rounded-full overflow-hidden ring-offset-background transition-all shrink-0",
                                        settings.themeAccent === 'default' ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                    )}
                                >
                                    <div className="flex h-full">
                                        <div className="flex-1 bg-[oklch(0.141_0.005_285.823)]" />
                                        <div className="flex-1 bg-[oklch(0.985_0_0)]" />
                                    </div>
                                </button>
                                {ACCENT_THEMES.map(t => (
                                    <button
                                        key={t.name}
                                        type="button"
                                        title={t.label}
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => setSettings({ ...settings, themeAccent: t.name })}
                                        className={cn(
                                            "size-6 rounded-full ring-offset-background transition-all shrink-0",
                                            settings.themeAccent === t.name ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                        )}
                                        style={{ backgroundColor: t.preview }}
                                    />
                                ))}
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="comfy-gallery-icon-btn" onClick={() => setShowSettings(true)}>
                            <Settings className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Settings</TooltipContent>
                </Tooltip>

                {/* Close / drag-to-close drop target */}
                <div
                    onDragEnter={e => { e.preventDefault(); dragCounter.current++; if (!targetDate) setTargetDate(Date.now() + 3000); }}
                    onDragLeave={e => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0 && targetDate) setTargetDate(undefined); }}
                    onDragOver={e => e.preventDefault()}
                >
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                onClick={() => { setOpen(false); }}
                                className={cn(
                                    "comfy-gallery-icon-btn transition-all duration-200",
                                    targetDate ? "text-destructive h-9 px-3 w-auto" : "h-9 w-9"
                                )}
                            >
                                {(!showClose || !targetDate) && <X className="h-4 w-4" />}
                                {targetDate ? `${Math.ceil(countdown / 1000)}s` : null}
                            </Button>
                        </TooltipTrigger>
                        {showClose && !targetDate && (
                            <TooltipContent>Hover to close in 3s</TooltipContent>
                        )}
                    </Tooltip>
                </div>
            </div>
        </div>
    );
};

export default GalleryHeader;
