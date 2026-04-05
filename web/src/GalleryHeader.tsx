import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    ChevronsLeft, ChevronsRight, X, ArrowUpDown, Settings, Sun, Moon,
    ChevronDown, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useGalleryContext } from './GalleryContext';
import type { ViewMode } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';

const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
    { label: 'All', value: 'all' },
    { label: 'By Date', value: 'date' },
    { label: 'By Resolution', value: 'resolution' },
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
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    return (
        <div ref={containerRef} className="relative flex-1 min-w-[120px] max-w-[280px]">
            <div className="relative flex items-center">
                <input
                    ref={inputRef}
                    type="text"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm pr-8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onFocus={() => setOpen(true)}
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
            {open && options.length > 0 && (
                <div className="absolute top-full mt-1 w-full rounded-md border bg-popover shadow-md z-[3001] max-h-48 overflow-y-auto">
                    {options.slice(0, 20).map((opt, i) => (
                        <div
                            key={String(opt.value ?? i)}
                            className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent truncate"
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
        <div className="flex items-center rounded-md border border-input overflow-hidden h-9 text-sm shrink-0">
            {VIEW_MODE_OPTIONS.map((opt, i) => (
                <button
                    key={opt.value}
                    className={cn(
                        "px-3 h-full transition-colors whitespace-nowrap",
                        i > 0 && "border-l border-input",
                        value === opt.value
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground"
                    )}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

const GalleryHeader = () => {
    const {
        setShowSettings,
        setSearchFileName,
        sortMethod, setSortMethod,
        viewMode, setViewMode,
        activeFilter, setActiveFilter,
        setFilteredRelPaths,
        imagesAutoCompleteNames,
        autoCompleteOptions, setAutoCompleteOptions,
        setOpen,
        selectedImages, setSelectedImages,
        mutate,
        siderCollapsed, setSiderCollapsed,
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

    const clearFilter = () => { setActiveFilter(null); setFilteredRelPaths(null); };

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

    return (
        <div className="flex items-center justify-between w-full gap-2">

            {/* Left zone: sidebar toggle + bulk actions + active filter tag */}
            <div className="flex items-center gap-2 shrink-0">
                <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setSiderCollapsed((prev: boolean) => !prev)}
                >
                    {siderCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                </Button>

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

                {activeFilter && (
                    <div className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-[13px] px-2 py-0.5 shrink-0">
                        <span>{activeFilter.by === 'model' ? 'Model' : 'Prompt'}: {activeFilter.label}</span>
                        <button onClick={clearFilter} className="hover:opacity-70 transition-opacity ml-0.5">
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                )}
            </div>

            {/* Right zone: search · view · sort · dark · settings · close */}
            <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
                <SearchAutocomplete
                    value={search}
                    onChange={val => setSearch(val)}
                    options={autoCompleteOptions && autoCompleteOptions.length > 0 ? autoCompleteOptions : imagesAutoCompleteNames}
                    placeholder="Search…"
                />

                <ViewModeSelector
                    value={viewMode}
                    onChange={v => { setViewMode(v); if (v !== 'model' && v !== 'prompt') clearFilter(); }}
                />

                {/* Sort select */}
                <div className="relative flex items-center shrink-0">
                    <ArrowUpDown className="absolute left-2 h-3.5 w-3.5 pointer-events-none text-muted-foreground" />
                    <select
                        className="h-9 appearance-none bg-background border border-input pl-7 pr-6 text-sm focus:outline-none cursor-pointer text-foreground min-w-[130px] rounded-md"
                        value={sortMethod}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onChange={e => setSortMethod(e.target.value as any)}
                    >
                        <option value="Newest">Date: Newest</option>
                        <option value="Oldest">Date: Oldest</option>
                        <option value="Name ↑">Name: A → Z</option>
                        <option value="Name ↓">Name: Z → A</option>
                    </select>
                    <ChevronDown className="absolute right-1 h-3.5 w-3.5 pointer-events-none text-muted-foreground" />
                </div>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setSettings({ ...settings, darkMode: !settings.darkMode })}
                        >
                            {settings.darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{settings.darkMode ? 'Light Mode' : 'Dark Mode'}</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => setShowSettings(true)}>
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
                                    "transition-all duration-200",
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
