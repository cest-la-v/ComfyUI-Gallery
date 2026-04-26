import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
    X, Settings, Sun, Moon, Loader2, Palette, LayoutGrid, AlignJustify, ArrowUpDown,
    CalendarDays, Box, MessageSquare, FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
    AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuLabel, DropdownMenuSeparator,
    DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useGalleryContext } from './GalleryContext';
import type { ViewMode } from './GalleryContext';
import { useCountDown } from 'ahooks';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';
import { BASE_THEMES, ACCENT_THEMES } from './themes';

function useHoverOpen() {
    const [open, setOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const enter = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        setOpen(true);
    }, []);
    const leave = useCallback(() => {
        timer.current = setTimeout(() => setOpen(false), 120);
    }, []);
    return { open, setOpen, enter, leave };
}

export const GROUP_MODE_ICONS: Record<ViewMode, React.ElementType> = {
    date: CalendarDays,
    model: Box,
    prompt: MessageSquare,
    folder: FolderOpen,
};

const GROUP_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
    { label: 'Date', value: 'date' },
    { label: 'Model', value: 'model' },
    { label: 'Prompt', value: 'prompt' },
    { label: 'Folder', value: 'folder' },
];

const GalleryHeader = () => {
    const {
        setShowSettings,
        sortMethod, setSortMethod,
        viewMode, setViewMode,
        groupFilter, setGroupFilter,
        groupValues,
        gridView, setGridView,
        setOpen,
        selectedImages, setSelectedImages,
        mutate, markDeleted,
        settings, setSettings,
        gallerySection,
    } = useGalleryContext();

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
    const [themePickerOpen, setThemePickerOpen] = useState(false);
    const modeSelect = useHoverOpen();
    const filterSelect = useHoverOpen();

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
                    markDeleted(url);
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
    }, [selectedImages, mutate, markDeleted, setSelectedImages]);

    // Sentinel for "show all groups" — Radix Select disallows empty string values
    const ALL_GROUPS = '__all__';

    return (
        <div className="flex items-center justify-between w-full gap-2">

            {/* Left zone: group mode + group filter + bulk actions — assets only */}
            {gallerySection === 'assets' && (
            <div className="flex items-center gap-2 shrink-0">
                {/* Group mode selector */}
                <Select
                    open={modeSelect.open}
                    onOpenChange={modeSelect.setOpen}
                    value={viewMode}
                    onValueChange={v => {
                        setViewMode(v as ViewMode);
                        setGroupFilter('');
                    }}
                >
                    <SelectTrigger
                        className="h-9 w-[130px] shrink-0"
                        onMouseEnter={modeSelect.enter}
                        onMouseLeave={modeSelect.leave}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                        className="z-[var(--cg-z-popup)]"
                        onMouseEnter={modeSelect.enter}
                        onMouseLeave={modeSelect.leave}
                    >
                        {GROUP_MODE_OPTIONS.map(opt => {
                            const Icon = GROUP_MODE_ICONS[opt.value];
                            return (
                                <SelectItem key={opt.value} value={opt.value}>
                                    <span className="flex items-center gap-1.5">
                                        <Icon className="h-3.5 w-3.5 shrink-0" />
                                        {opt.label}
                                    </span>
                                </SelectItem>
                            );
                        })}
                    </SelectContent>
                </Select>

                {/* Group filter */}
                <Select
                    open={filterSelect.open}
                    onOpenChange={filterSelect.setOpen}
                    value={groupFilter === '' ? ALL_GROUPS : groupFilter}
                    onValueChange={v => setGroupFilter(v === ALL_GROUPS ? '' : v)}
                    disabled={gridView === 'overview'}
                >
                    <SelectTrigger
                        className="h-9 min-w-[140px] max-w-[200px] shrink-0"
                        onMouseEnter={filterSelect.enter}
                        onMouseLeave={filterSelect.leave}
                    >
                        <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent
                        className="z-[var(--cg-z-popup)]"
                        onMouseEnter={filterSelect.enter}
                        onMouseLeave={filterSelect.leave}
                    >
                        <SelectItem value={ALL_GROUPS}>All</SelectItem>
                        {groupValues.map(({ key, label }) => (
                            <SelectItem key={key} value={key}>
                                <span className="truncate max-w-[180px] block">{label}</span>
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
            )}
            <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
                {gallerySection === 'assets' && (
                    <>
                        {/* View toggle: Overview / Detail */}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    size="icon"
                                    variant={gridView === 'overview' ? 'secondary' : 'ghost'}
                                    className="comfy-gallery-icon-btn shrink-0"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => setGridView(gridView === 'overview' ? 'detail' : 'overview')}
                                >
                                    {gridView === 'overview' ? <AlignJustify className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{gridView === 'overview' ? 'Detail view' : 'Overview'}</TooltipContent>
                        </Tooltip>

                        {/* Sort button */}
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="comfy-gallery-icon-btn shrink-0"
                                            onMouseDown={e => e.preventDefault()}
                                        >
                                            <ArrowUpDown className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Sort</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuRadioGroup
                                    value={sortMethod}
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    onValueChange={v => setSortMethod(v as any)}
                                >
                                    <DropdownMenuRadioItem value="Newest">Newest first</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="Oldest">Oldest first</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="Name ↑">Name A → Z</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="Name ↓">Name Z → A</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </>
                )}

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
                <Popover open={themePickerOpen} onOpenChange={setThemePickerOpen}>
                    <Tooltip open={themePickerOpen ? false : undefined}>
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
                    <PopoverContent align="end" className="w-64 p-3 flex flex-col gap-3" onOpenAutoFocus={e => e.preventDefault()}>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Base Color</span>
                            <div className="flex flex-wrap gap-2">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            onMouseDown={e => e.preventDefault()}
                                            onClick={() => setSettings({ ...settings, themeBase: 'default', themeAccent: 'default' })}
                                            className={cn(
                                                "size-6 rounded-full overflow-hidden ring-offset-background transition-all shrink-0",
                                                settings.themeBase === 'default' ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                            )}
                                        >
                                            <div className="flex h-full">
                                                <div className="flex-1" style={{ backgroundColor: "oklch(0.141 0.005 285.823)" }} />
                                                <div className="flex-1" style={{ backgroundColor: "oklch(0.985 0 0)" }} />
                                            </div>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Default</TooltipContent>
                                </Tooltip>
                                {BASE_THEMES.map(t => (
                                    <Tooltip key={t.name}>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                onMouseDown={e => e.preventDefault()}
                                                onClick={() => setSettings({ ...settings, themeBase: t.name, themeAccent: 'default' })}
                                                className={cn(
                                                    "size-6 rounded-full ring-offset-background transition-all shrink-0",
                                                    settings.themeBase === t.name ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                                )}
                                                style={{ backgroundColor: t.preview }}
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent>{t.label}</TooltipContent>
                                    </Tooltip>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Theme</span>
                            <div className="flex flex-wrap gap-2">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            onMouseDown={e => e.preventDefault()}
                                            onClick={() => setSettings({ ...settings, themeAccent: 'default' })}
                                            className={cn(
                                                "size-6 rounded-full overflow-hidden ring-offset-background transition-all shrink-0",
                                                settings.themeAccent === 'default' ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                            )}
                                        >
                                            <div className="flex h-full">
                                                <div className="flex-1" style={{ backgroundColor: "oklch(0.141 0.005 285.823)" }} />
                                                <div className="flex-1" style={{ backgroundColor: "oklch(0.985 0 0)" }} />
                                            </div>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent>Same as base</TooltipContent>
                                </Tooltip>
                                {ACCENT_THEMES.map(t => (
                                    <Tooltip key={t.name}>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                onMouseDown={e => e.preventDefault()}
                                                onClick={() => setSettings({ ...settings, themeAccent: t.name })}
                                                className={cn(
                                                    "size-6 rounded-full ring-offset-background transition-all shrink-0",
                                                    settings.themeAccent === t.name ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"
                                                )}
                                                style={{ backgroundColor: t.preview }}
                                            />
                                        </TooltipTrigger>
                                        <TooltipContent>{t.label}</TooltipContent>
                                    </Tooltip>
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
