import React, { createContext, useContext, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useSize, useRequest, useAsyncEffect, useEventListener, useLocalStorageState, useClickAway } from 'ahooks';
import type { FileDetails, FilesTree, SourcePath } from './types';
import { useTheme } from './hooks/useTheme';
import { normalizeModelName } from './metadata-parser/samplerNormalizer';
type AutoCompleteOption = { value?: string; label?: React.ReactNode };
import { ComfyAppApi, OPEN_BUTTON_ID } from './ComfyAppApi';

function getImages(): Promise<FilesTree> {
    return new Promise(async (resolve, reject) => {
        try {
            let request = await ComfyAppApi.fetchImages();
            let json: FilesTree = await request.json();
            resolve(json);
        } catch (error) {
            reject(error);
        }
    });
}

export interface SettingsState {
    /** @deprecated Use sourcePaths instead. Kept for v5→v6 migration. */
    relativePath?: string;
    sourcePaths?: SourcePath[];
    buttonLabel: string;
    floatingButton: boolean;
    autoPlayVideos: boolean;
    darkMode: boolean;
    galleryShortcut: boolean;
    disableLogs: boolean;
    usePollingObserver: boolean;
    scanExtensions: string[];
    themeBase: string;
    themeAccent: string;
    galleryLayout: 'center' | 'bottom';
    /** Incremented when we need to migrate stored settings to new defaults. */
    _settingsVersion?: number;
}

export const DEFAULT_SOURCE_PATHS: SourcePath[] = [
    { source_id: 'output', path: '{output}', label: 'Output', enabled: true },
    { source_id: 'input',  path: '{input}',  label: 'Input',  enabled: true },
];

export const DEFAULT_SETTINGS: SettingsState = {
    sourcePaths: DEFAULT_SOURCE_PATHS,
    buttonLabel: 'Open Gallery',
    floatingButton: true,
    autoPlayVideos: true,
    darkMode: true,
    galleryShortcut: true,
    disableLogs: false,
    usePollingObserver: false,
    scanExtensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'gif', 'webm', 'mov', 'wav', 'mp3', 'm4a', 'flac'],
    themeBase: 'default',
    themeAccent: 'default',
    galleryLayout: 'center',
    _settingsVersion: 6,
};
export const STORAGE_KEY = 'comfy-ui-gallery-settings';

export type ViewMode = 'date' | 'model' | 'prompt' | 'folder';
export type GallerySection = 'assets' | 'models' | 'prompts';

export interface GalleryContextType {
    gallerySection: GallerySection;
    setGallerySection: Dispatch<SetStateAction<GallerySection>>;
    assetSourceFilter: string;
    setAssetSourceFilter: Dispatch<SetStateAction<string>>;
    groupFilter: string;
    setGroupFilter: Dispatch<SetStateAction<string>>;
    gridView: 'detail' | 'overview';
    setGridView: Dispatch<SetStateAction<'detail' | 'overview'>>;
    groupValues: { key: string; label: string }[];
    searchFileName: string;
    setSearchFileName: Dispatch<SetStateAction<string>>;
    viewMode: ViewMode;
    setViewMode: Dispatch<SetStateAction<ViewMode>>;
    showSettings: boolean;
    setShowSettings: Dispatch<SetStateAction<boolean>>;
    showRawMetadata: boolean;
    setShowRawMetadata: Dispatch<SetStateAction<boolean>>;
    sortMethod: 'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓';
    setSortMethod: Dispatch<SetStateAction<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>>;
    imageInfoName: string | undefined;
    setImageInfoName: Dispatch<SetStateAction<string | undefined>>;
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    previewingVideo: string | undefined;
    setPreviewingVideo: Dispatch<SetStateAction<string | undefined>>;
    lightboxOpen: boolean;
    setLightboxOpen: Dispatch<SetStateAction<boolean>>;
    lightboxIndex: number;
    setLightboxIndex: Dispatch<SetStateAction<number>>;
    openLightbox: (url: string) => void;
    closeLightbox: () => void;
    pendingDeleteImage: FileDetails | null;
    setPendingDeleteImage: Dispatch<SetStateAction<FileDetails | null>>;
    imageRotation: 0 | 90 | 180 | 270;
    setImageRotation: Dispatch<SetStateAction<0 | 90 | 180 | 270>>;
    imageFlipH: boolean;
    setImageFlipH: Dispatch<SetStateAction<boolean>>;
    imageFlipV: boolean;
    setImageFlipV: Dispatch<SetStateAction<boolean>>;
    size: ReturnType<typeof useSize>;
    data: FilesTree | undefined;
    error: any;
    loading: boolean;
    runAsync: () => Promise<any>;
    mutate: (data?: FilesTree | ((oldData?: FilesTree | undefined) => FilesTree | undefined) | undefined) => void;
    markDeleted: (url: string) => void;
    gridSize: { width: number; height: number; columnCount: number; rowCount: number };
    setGridSize: Dispatch<SetStateAction<{ width: number; height: number; columnCount: number; rowCount: number }>>;
    autoSizer: { width: number; height: number };
    setAutoSizer: Dispatch<SetStateAction<{ width: number; height: number }>>;
    imagesDetailsList: FileDetails[];
    imagesAutoCompleteNames: AutoCompleteOption[];
    autoCompleteOptions: AutoCompleteOption[];
    setAutoCompleteOptions: React.Dispatch<React.SetStateAction<AutoCompleteOption[]>>;
    settings: SettingsState;
    setSettings: (v: SettingsState) => void;
    selectedImages: string[];
    setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
    showMetadataPanel: boolean;
    setShowMetadataPanel: React.Dispatch<React.SetStateAction<boolean>>;
    pickMode: boolean;
    onPickImage: ((absPath: string) => void) | null;
    openPickMode: (callback: (absPath: string) => void) => void;
    closePickMode: () => void;
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);

import { galleryBridge } from './galleryBridge';

export type GroupEntry = {
    key: string;
    label: string;
    items: FileDetails[];
    maxTimestamp: number;
    samplePaths: string[];
};

function getFolderGroupKey(item: FileDetails): string {
    if (!item.rel_path) return '__root__';
    const lastSlash = item.rel_path.lastIndexOf('/');
    return lastSlash >= 0 ? item.rel_path.slice(0, lastSlash) : '__root__';
}

function stripCommonFolderPrefix(keys: string[]): string {
    const nonEmpty = keys.filter(k => k !== '__root__');
    if (nonEmpty.length === 0) return '';
    const firstPart = nonEmpty[0].split('/')[0];
    return nonEmpty.every(k => k.split('/')[0] === firstPart) ? firstPart : '';
}

export function getGroupKey(item: FileDetails, mode: ViewMode): string {
    switch (mode) {
        case 'date': return item.timestamp ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : 'Unknown';
        case 'model': return item.model ?? 'Unknown';
        case 'prompt': return item.prompt_only_fp || '__noprompt__';
        case 'folder': return getFolderGroupKey(item);
    }
}

export function computeGroups(
    sortedItems: FileDetails[],
    mode: ViewMode,
    sortMethod: 'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓',
): GroupEntry[] {
    const grouped = new Map<string, FileDetails[]>();
    sortedItems.forEach(item => {
        const key = getGroupKey(item, mode);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(item);
    });

    const prefix = mode === 'folder' ? stripCommonFolderPrefix([...grouped.keys()]) : '';

    const entries: GroupEntry[] = [...grouped.entries()].map(([key, items]) => {
        let label: string;
        if (mode === 'date') {
            label = key;
        } else if (mode === 'model') {
            label = key === 'Unknown' ? key : (normalizeModelName(key) || key);
        } else if (mode === 'folder') {
            label = key === '__root__' ? '(root)' : (prefix ? key.slice(prefix.length + 1) || key : key);
        } else {
            // prompt — key is prompt_only_fp fingerprint, label is the actual text
            const sample = items.find(i => i.positive_prompt);
            const text = sample?.positive_prompt ?? '';
            label = text ? (text.length > 50 ? text.slice(0, 50) + '…' : text) : '(no prompt)';
        }
        const maxTimestamp = items.reduce((max, i) => Math.max(max, i.timestamp ?? 0), 0);
        const samplePaths = items
            .filter(i => i.type === 'image' || i.type === 'media')
            .slice(0, 5)
            .map(i => i.rel_path!)
            .filter(Boolean);
        return { key, label, items, maxTimestamp, samplePaths };
    });

    // Sort groups by sortMethod
    entries.sort((a, b) => {
        switch (sortMethod) {
            case 'Newest': return b.maxTimestamp - a.maxTimestamp;
            case 'Oldest': return a.maxTimestamp - b.maxTimestamp;
            case 'Name ↑': return a.label.localeCompare(b.label);
            case 'Name ↓': return b.label.localeCompare(a.label);
        }
    });

    // 'Unknown' / no-metadata always last
    const pushToEnd = (predicate: (e: GroupEntry) => boolean) => {
        const idx = entries.findIndex(predicate);
        if (idx > 0) entries.push(entries.splice(idx, 1)[0]);
    };
    if (mode === 'date' || mode === 'model') pushToEnd(e => e.key === 'Unknown');
    if (mode === 'prompt') pushToEnd(e => e.key === '__noprompt__');
    if (mode === 'folder') pushToEnd(e => e.key === '__root__');

    return entries;
}

function injectDividers(
    sortedList: FileDetails[],
    mode: ViewMode,
    colCount: number,
    sortMethod: 'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓',
): FileDetails[] {
    const groups = computeGroups(sortedList, mode, sortMethod);
    const result: FileDetails[] = [];
    groups.forEach(({ key, label, items, samplePaths }) => {
        const divider: FileDetails = {
            name: label,
            url: '',
            timestamp: 0,
            date: '',
            type: 'divider',
            count: items.length,
            divider_mode: mode,
            sample_paths: samplePaths,
        };
        for (let i = 0; i < colCount; i++) result.push(divider);
        result.push(...items);
        const remainder = items.length % colCount;
        if (remainder !== 0 && colCount > 1) {
            for (let i = 0; i < colCount - remainder; i++) {
                result.push({ name: key, url: '', timestamp: 0, date: '', type: 'empty-space' });
            }
        }
    });
    return result;
}

export function GalleryProvider({ children }: { children: React.ReactNode }) {
    const [gallerySection, setGallerySection] = useState<GallerySection>('assets');
    const [assetSourceFilter, setAssetSourceFilter] = useState('');
    const [groupFilter, setGroupFilter] = useState("");
    const [gridView, setGridView] = useState<'detail' | 'overview'>('detail');
    const [searchFileName, setSearchFileName] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>('date');
    const [showSettings, setShowSettings] = useState(false);
    const [showRawMetadata, setShowRawMetadata] = useState(false);
    const [sortMethod, setSortMethod] = useState<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>("Newest");
    const [imageInfoName, setImageInfoName] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [previewingVideo, setPreviewingVideo] = useState<string | undefined>(undefined);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [pendingDeleteImage, setPendingDeleteImage] = useState<FileDetails | null>(null);
    const [imageRotation, setImageRotation] = useState<0 | 90 | 180 | 270>(0);
    const [imageFlipH, setImageFlipH] = useState(false);
    const [imageFlipV, setImageFlipV] = useState(false);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [showMetadataPanel, setShowMetadataPanel] = useState(false);
    const [pickMode, setPickMode] = useState(false);
    const [onPickImage, setOnPickImage] = useState<((absPath: string) => void) | null>(null);
    const size= useSize(document.querySelector('body'));
    const { data, error, loading, runAsync, mutate, refresh, refreshAsync } = useRequest(getImages, { manual: true });

    // Tracks URLs of images that were optimistically deleted by the user.
    // Filters them out of imagesDetailsList even if runAsync/updateImages restores
    // them from stale server data (DB GC runs asynchronously via watchdog, so the
    // server may still return deleted files during the cleanup window).
    // Entries are cleared only when the watchdog confirms the file via 'remove' or
    // re-creates it via 'create' — so the filter is active for exactly the right window.
    const deletedUrls = useRef<Set<string>>(new Set());
    const markDeleted = useCallback((url: string) => {
        deletedUrls.current.add(url);
    }, []);
    const [gridSize, setGridSize] = useState({ width: 1000, height: 600, columnCount: 1, rowCount: 1 });
    const [autoSizer, setAutoSizer] = useState({ width: 1000, height: 600 });
    const [autoCompleteOptions, setAutoCompleteOptions] = useState<AutoCompleteOption[]>([]);
    const [settingsState, setSettings] = useLocalStorageState<SettingsState>(STORAGE_KEY, {
        defaultValue: DEFAULT_SETTINGS,
        listenStorageChange: true,
    });

    useAsyncEffect(async () => { 
        // Fetch saved server settings and merge with defaults
        try {
            const serverSettings = await ComfyAppApi.fetchSettings();
            if (serverSettings && Object.keys(serverSettings).length > 0) {
                // Merge server settings into defaults, but only override when value is not null/undefined
                const merged: any = { ...DEFAULT_SETTINGS };
                Object.keys(serverSettings).forEach((k) => {
                    const v = (serverSettings as any)[k];
                    if (v !== null && v !== undefined) merged[k] = v;
                });
                setSettings(merged as SettingsState);
            }
        } catch (e) {}

        runAsync(); 

        ComfyAppApi.onFileChange((event) => {
            updateImages(event.detail);
        });

        ComfyAppApi.onUpdate((event) => {
            updateImages(event.detail); // Pass the whole object, not event.detail.folders
        });
        
        ComfyAppApi.onClear((event) => {
            mutate({ folders: {} });
        });
    }, []);

    const saveSettings = (newSettings: SettingsState) => {
        setSettings(newSettings);
        ComfyAppApi.saveSettings(newSettings);
    };

    // Watch for changes to sourcePaths / disableLogs / usePollingObserver — restart monitor
    useEffect(() => {
        const paths = settingsState?.sourcePaths;
        if (paths && paths.length > 0) {
            ComfyAppApi.startMonitoring(
                paths,
                settingsState.disableLogs,
                settingsState.usePollingObserver,
                settingsState.scanExtensions,
            );
            runAsync();
        }
    }, [JSON.stringify(settingsState?.sourcePaths), settingsState?.disableLogs, settingsState?.usePollingObserver, JSON.stringify(settingsState?.scanExtensions)]);

    // Recovery B: when gallery is opened, restart monitoring if dead and refresh image list
    useEffect(() => {
        const paths = settingsState?.sourcePaths;
        if (open && paths && paths.length > 0) {
            ComfyAppApi.startMonitoring(
                paths,
                settingsState.disableLogs,
                settingsState.usePollingObserver,
                settingsState.scanExtensions,
            );
            runAsync();
        }
    }, [open]);

    // Recovery C: periodic full-refresh while gallery is mounted (backstop for silent watcher issues)
    useEffect(() => {
        const interval = setInterval(() => {
            if (open) runAsync();
        }, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [open]);

    // One-time migrations:
    // v1→v2: darkMode was false by default, force true.
    // v2→v3: hideOpenButton removed — no conversion needed, unknown fields are ignored.
    // v3→v4: themeBase + themeAccent added (both default to 'default').
    // v4→v5: galleryLayout added (defaults to 'center').
    // v5→v6: relativePath → sourcePaths (multi-source). Old relativePath preserved as custom
    //        source if it was non-default, alongside the built-in output+input defaults.
    useEffect(() => {
        if (!settingsState) return;
        const v = settingsState._settingsVersion ?? 1;
        if (v < 6) {
            const defaultPaths = [...DEFAULT_SOURCE_PATHS];
            // Preserve a custom relativePath from pre-v6 settings as a third source.
            const oldPath = settingsState.relativePath;
            const isDefault = !oldPath || oldPath === './' || oldPath === '.' || oldPath === 'null' || oldPath === '';
            const sourcePaths: SourcePath[] = isDefault
                ? defaultPaths
                : [...defaultPaths, { source_id: 'custom', path: oldPath, label: 'Custom', enabled: true }];
            setSettings({
                ...settingsState,
                darkMode: settingsState.darkMode ?? true,
                themeBase: settingsState.themeBase ?? 'default',
                themeAccent: settingsState.themeAccent ?? 'default',
                galleryLayout: settingsState.galleryLayout ?? 'center',
                sourcePaths,
                _settingsVersion: 6,
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync dark mode setting → .dark class on both gallery roots
    useEffect(() => {
        const dark = !!settingsState?.darkMode;
        document.getElementById('comfy-gallery-root')?.classList.toggle('dark', dark);
        document.getElementById('comfy-gallery-yarl-root')?.classList.toggle('dark', dark);
    }, [settingsState?.darkMode]);

    // Apply base/accent theme CSS variable overrides
    useTheme(settingsState?.themeBase ?? 'default', settingsState?.themeAccent ?? 'default');

    // Memoized list of all images in the current folder
    const imagesDetailsList = useMemo(() => {
        const allItems: FileDetails[] = Object.values(data?.folders ?? {})
            .flatMap(folder => Object.values(folder as Record<string, FileDetails>))
            .filter(item => !deletedUrls.current.has(item.url));

        let list = allItems;

        if (searchFileName && searchFileName.trim() !== "") {
            const searchTerm = searchFileName.toLowerCase();
            list = list.filter(imageInfo => imageInfo.name.toLowerCase().includes(searchTerm));
        }

        // Source chip filter — only items whose rel_path starts with the selected source_id
        if (assetSourceFilter) {
            list = list.filter(item => item.rel_path?.startsWith(assetSourceFilter + '/') ?? false);
        }

        // Sort items
        switch (sortMethod) {
            case 'Newest':
                list = list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                break;
            case 'Oldest':
                list = list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                break;
            case 'Name ↑':
                list = list.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'Name ↓':
                list = list.sort((a, b) => b.name.localeCompare(a.name));
                break;
        }

        // Filter by group
        if (groupFilter !== '') {
            list = list.filter(item => getGroupKey(item, viewMode) === groupFilter);
        }

        return injectDividers(list, viewMode, Math.max(1, gridSize.columnCount || 1), sortMethod);
    }, [data, sortMethod, searchFileName, assetSourceFilter, gridSize.columnCount, viewMode, groupFilter]);

    const groupValues = useMemo<{ key: string; label: string }[]>(() => {
        const allItems: FileDetails[] = Object.values(data?.folders ?? {})
            .flatMap(folder => Object.values(folder as Record<string, FileDetails>));
        return computeGroups(allItems, viewMode, sortMethod)
            .map(({ key, label }) => ({ key, label }));
    }, [data, viewMode, sortMethod]);

    // Memoized autocomplete options for image names
    const imagesAutoCompleteNames = useMemo<AutoCompleteOption[]>(() => {
        let filtered = imagesDetailsList.filter(image => (image.type === "image" || image.type === "media" || image.type === "audio") && typeof image.name === 'string');
        if (sortMethod === 'Name ↑') {
            filtered = filtered.sort((a, b) => (a.name as string).localeCompare(b.name as string));
        } else if (sortMethod === 'Name ↓') {
            filtered = filtered.sort((a, b) => (b.name as string).localeCompare(a.name as string));
        } else if (sortMethod === 'Newest') {
            filtered = filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } else if (sortMethod === 'Oldest') {
            filtered = filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
        return filtered.map(image => ({ value: image.name as string, label: image.name as string }));
    }, [imagesDetailsList, sortMethod]);

    // Update images in the gallery data (data: FilesTree)
    function updateImages(changes: any) {
        if (!changes || !changes.folders) {
            console.warn("No valid changes data received.");
            return;
        }
        mutate((oldData: FilesTree | undefined) => {
            if (!oldData || !oldData.folders) return oldData;
            // Deep copy folders to avoid direct mutation
            const folders = { ...oldData.folders };
            let changed = false;
            for (const folderName in changes.folders) {
                const folderChanges = changes.folders[folderName];
                if (!folders[folderName] && folderChanges) {
                    folders[folderName] = {};
                }
                if (folders[folderName]) {
                    for (const filename in folderChanges) {
                        const fileChange = folderChanges[filename];
                        switch (fileChange.action) {
                            case 'create':
                                folders[folderName][filename] = { ...fileChange };
                                // File (re-)appeared — no longer needs to be filtered
                                deletedUrls.current.delete(fileChange.url);
                                changed = true;
                                break;
                            case 'update':
                                if (folders[folderName][filename]) {
                                    Object.assign(folders[folderName][filename], fileChange);
                                    changed = true;
                                }
                                break;
                            case 'remove':
                                if (folders[folderName][filename]) {
                                    // Watchdog confirmed removal — filter entry no longer needed
                                    deletedUrls.current.delete(folders[folderName][filename].url);
                                    delete folders[folderName][filename];
                                    changed = true;
                                    if (Object.keys(folders[folderName]).length === 0) {
                                        delete folders[folderName];
                                    }
                                }
                                break;
                            default:
                                console.warn(`Unknown action: ${fileChange.action}`);
                        }
                    }
                } else {
                    console.warn(`Change for non-existent folder: ${folderName}`);
                    return oldData;
                }
            }
            if (changed) {
                return { ...oldData, folders };
            }
            return oldData;
        });
    }

    const [imageCards, setImageCards] = useState(document.querySelectorAll(".image-card"));
    const [folders, setFolders] = useState(document.querySelectorAll('[role="treeitem"], .folder'));
    const [selectedImagesActionButtons, setSelectedImagesActionButtons] = useState(document.querySelectorAll(".selectedImagesActionButton"));

    useEffect(() => {
        setImageCards(document.querySelectorAll(".image-card"));
    }, [imagesDetailsList]);
    useEffect(() => {
        setFolders(document.querySelectorAll('[role="treeitem"], .folder'));
    }, [imagesDetailsList]);
    useEffect(() => {
        setSelectedImagesActionButtons(document.querySelectorAll(".selectedImagesActionButton"));
    }, [selectedImages]);

    useClickAway((event) => {
        setSelectedImages([]);
    }, [...imageCards, ...folders, ...selectedImagesActionButtons])

    useEventListener('keydown', (event) => {
        if (settingsState?.galleryShortcut && event.code == "KeyG" && event.ctrlKey) {
            try {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                document.getElementById(OPEN_BUTTON_ID)?.click();
            } catch {}
        }
    });

    const openLightbox = useCallback((url: string) => {
        const previewable = imagesDetailsList.filter(img => img.type === 'image' || img.type === 'media' || img.type === 'audio');
        const idx = previewable.findIndex(img => img.url === url);
        if (idx >= 0) { setLightboxIndex(idx); setLightboxOpen(true); setShowMetadataPanel(true); }
    }, [imagesDetailsList, setShowMetadataPanel]);

    const closeLightbox = useCallback(() => {
        setLightboxOpen(false);
        setImageInfoName(undefined);
        setPreviewingVideo(undefined);
        setShowMetadataPanel(false);
        setShowRawMetadata(false);
        setImageRotation(0);
        setImageFlipH(false);
        setImageFlipV(false);
        setPendingDeleteImage(null);
    }, [setImageInfoName, setPreviewingVideo, setShowMetadataPanel, setShowRawMetadata]);

    const openPickMode = useCallback((cb: (absPath: string) => void) => {
        setOnPickImage(() => cb);
        setPickMode(true);
        setOpen(true);
    }, []);

    const closePickMode = useCallback(() => {
        setPickMode(false);
        setOnPickImage(null);
        setOpen(false);
    }, []);

    // Keep bridge in sync with the latest openPickMode reference.
    useEffect(() => {
        galleryBridge.openPickMode = openPickMode;
    }, [openPickMode]);

    // Clear pick mode when the gallery is closed externally (Esc, backdrop click, etc.).
    useEffect(() => {
        if (!open && pickMode) {
            setPickMode(false);
            setOnPickImage(null);
        }
    }, [open]); // intentionally omits pickMode to avoid re-running when we set it ourselves

    const value = useMemo(() => ({
        gallerySection, setGallerySection,
        assetSourceFilter, setAssetSourceFilter,
        groupFilter, setGroupFilter,
        gridView, setGridView,
        groupValues,
        searchFileName, setSearchFileName,
        viewMode, setViewMode,
        showSettings, setShowSettings,
        showRawMetadata, setShowRawMetadata,
        sortMethod, setSortMethod,
        imageInfoName, setImageInfoName,
        open, setOpen,
        previewingVideo, setPreviewingVideo,
        lightboxOpen, setLightboxOpen,
        lightboxIndex, setLightboxIndex,
        openLightbox, closeLightbox,
        pendingDeleteImage, setPendingDeleteImage,
        imageRotation, setImageRotation,
        imageFlipH, setImageFlipH,
        imageFlipV, setImageFlipV,
        size,
        data, error, loading, runAsync, mutate,
        markDeleted,
        gridSize, setGridSize,
        autoSizer, setAutoSizer,
        imagesDetailsList,
        imagesAutoCompleteNames,
        autoCompleteOptions,
        setAutoCompleteOptions,
        settings: settingsState || DEFAULT_SETTINGS,
        setSettings: saveSettings,
        selectedImages,
        setSelectedImages,
        showMetadataPanel,
        setShowMetadataPanel,
        pickMode,
        onPickImage,
        openPickMode,
        closePickMode,
    }), [
        gallerySection,
        assetSourceFilter,
        groupFilter,
        gridView,
        groupValues,
        searchFileName, 
        viewMode,
        showSettings, 
        showRawMetadata, 
        sortMethod, 
        imageInfoName, 
        open, 
        previewingVideo, 
        lightboxOpen,
        lightboxIndex,
        openLightbox,
        closeLightbox,
        pendingDeleteImage,
        imageRotation,
        imageFlipH,
        imageFlipV,
        size, 
        data, 
        error, 
        loading, 
        runAsync, 
        mutate,
        markDeleted,
        gridSize, 
        autoSizer, 
        imagesDetailsList, 
        imagesAutoCompleteNames, 
        autoCompleteOptions,
        settingsState, 
        saveSettings,
        selectedImages,
        setSelectedImages,
        showMetadataPanel,
        setShowMetadataPanel,
        pickMode,
        onPickImage,
        openPickMode,
        closePickMode,
    ]);

    return <GalleryContext.Provider 
        value={value}
    >
        {children}
    </GalleryContext.Provider>;
}

export function useGalleryContext() {
    const ctx = useContext(GalleryContext);
    if (!ctx) throw new Error('useGalleryContext must be used within a GalleryProvider');
    return ctx;
}
