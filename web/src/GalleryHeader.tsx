import { useEffect, useRef, useState } from 'react';
import {
    X, Settings, Sun, Moon, Palette, LayoutGrid, AlignJustify, ArrowUpDown,
    CalendarDays, Box, MessageSquare, FolderOpen, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
    DropdownMenuLabel, DropdownMenuSeparator,
    DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useGalleryContext } from './GalleryContext';
import type { ViewMode } from './GalleryContext';
import { useCountDown } from 'ahooks';
import { BASE_THEMES, ACCENT_THEMES } from './themes';
import GallerySearchBar from './GallerySearchBar';

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

const GalleryHeader = ({ showSearch = false }: { showSearch?: boolean }) => {
    const {
        setShowSettings,
        sortMethod, setSortMethod,
        viewMode, setViewMode,
        gridView, setGridView,
        setOpen,
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
    const [themePickerOpen, setThemePickerOpen] = useState(false);
    const [groupModeOpen, setGroupModeOpen] = useState(false);

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

    return (
        <div className="flex items-center gap-2 w-full">

            {showSearch && <GallerySearchBar compact className="flex-1 min-w-0" />}

            <div className={cn("flex items-center gap-1 shrink-0", !showSearch && "ml-auto")}>
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

                        {/* Group mode icon button */}
                        {gridView !== 'overview' && (
                            <Popover open={groupModeOpen} onOpenChange={setGroupModeOpen}>
                                <Tooltip open={groupModeOpen ? false : undefined}>
                                    <TooltipTrigger asChild>
                                        <PopoverTrigger asChild>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="comfy-gallery-icon-btn shrink-0"
                                                onMouseDown={e => e.preventDefault()}
                                            >
                                                {(() => { const Icon = GROUP_MODE_ICONS[viewMode]; return <Icon className="h-4 w-4" />; })()}
                                            </Button>
                                        </PopoverTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Group by</TooltipContent>
                                </Tooltip>
                                <PopoverContent align="end" className="w-40 p-1" onOpenAutoFocus={e => e.preventDefault()}>
                                    {GROUP_MODE_OPTIONS.map(opt => {
                                        const Icon = GROUP_MODE_ICONS[opt.value];
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                                                onMouseDown={e => e.preventDefault()}
                                                onClick={() => { setViewMode(opt.value); setGroupModeOpen(false); }}
                                            >
                                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                                <span className="flex-1 text-left">{opt.label}</span>
                                                {viewMode === opt.value && <Check className="h-3.5 w-3.5 shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </PopoverContent>
                            </Popover>
                        )}
                    </>
                )}

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="comfy-gallery-icon-btn"
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
