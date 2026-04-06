import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useSize, useRequest, useAsyncEffect, useEventListener, useLocalStorageState, useClickAway } from 'ahooks';
import type { FileDetails, FilesTree } from './types';
type AutoCompleteOption = { value?: string; label?: React.ReactNode };
import { ComfyAppApi, OPEN_BUTTON_ID } from './ComfyAppApi';

function getImages(): Promise<FilesTree> {
    return new Promise(async (resolve, reject) => {
            try {
                let settings = DEFAULT_SETTINGS;
            try {
                const raw = localStorage.getItem('comfy-ui-gallery-settings');
                if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
            } catch {}
            
            let request = await ComfyAppApi.fetchImages(settings.relativePath); 
            let json: FilesTree = await request.json();
            resolve(json);
        } catch (error) {
            reject(error);
        }
    });
}

export interface SettingsState {
    relativePath: string;
    buttonBoxQuery: string;
    buttonLabel: string;
    floatingButton: boolean;
    autoPlayVideos: boolean;
    darkMode: boolean;
    galleryShortcut: boolean;
    expandAllFolders: boolean;
    disableLogs: boolean;
    usePollingObserver: boolean;
    scanExtensions: string[];
    /** Incremented when we need to migrate stored settings to new defaults. */
    _settingsVersion?: number;
}

export const DEFAULT_SETTINGS: SettingsState = {
    relativePath: './',
    buttonBoxQuery: 'div.flex.gap-2.mx-2',
    buttonLabel: 'Open Gallery',
    floatingButton: true,
    autoPlayVideos: true,
    darkMode: true,
    galleryShortcut: true,
    expandAllFolders: true,
    disableLogs: false,
    usePollingObserver: false,
    scanExtensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'gif', 'webm', 'mov', 'wav', 'mp3', 'm4a', 'flac'],
    _settingsVersion: 3,
};
export const STORAGE_KEY = 'comfy-ui-gallery-settings';

export type ViewMode = 'all' | 'date' | 'resolution' | 'model' | 'prompt';

export interface ActiveFilter {
    by: 'model' | 'prompt';
    value: string;
    label: string;
}

export interface GalleryContextType {
    currentFolder: string;
    setCurrentFolder: Dispatch<SetStateAction<string>>;
    searchFileName: string;
    setSearchFileName: Dispatch<SetStateAction<string>>;
    viewMode: ViewMode;
    setViewMode: Dispatch<SetStateAction<ViewMode>>;
    activeFilter: ActiveFilter | null;
    setActiveFilter: Dispatch<SetStateAction<ActiveFilter | null>>;
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
    size: ReturnType<typeof useSize>;
    imagesBoxSize: ReturnType<typeof useSize>;
    data: FilesTree | undefined;
    error: any;
    loading: boolean;
    runAsync: () => Promise<any>;
    mutate: (data?: FilesTree | ((oldData?: FilesTree | undefined) => FilesTree | undefined) | undefined) => void;
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
    siderCollapsed: boolean;
    setSiderCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    showMetadataPanel: boolean;
    setShowMetadataPanel: React.Dispatch<React.SetStateAction<boolean>>;
    filteredRelPaths: string[] | null;
    setFilteredRelPaths: React.Dispatch<React.SetStateAction<string[] | null>>;
}

const GalleryContext = createContext<GalleryContextType | undefined>(undefined);

export function GalleryProvider({ children }: { children: React.ReactNode }) {
    const [currentFolder, setCurrentFolder] = useState("");
    const [searchFileName, setSearchFileName] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>('all');
    const [activeFilter, setActiveFilter] = useState<ActiveFilter | null>(null);
    const [filteredRelPaths, setFilteredRelPaths] = useState<string[] | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showRawMetadata, setShowRawMetadata] = useState(false);
    const [sortMethod, setSortMethod] = useState<'Newest' | 'Oldest' | 'Name ↑' | 'Name ↓'>("Newest");
    const [imageInfoName, setImageInfoName] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [previewingVideo, setPreviewingVideo] = useState<string | undefined>(undefined);
    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [siderCollapsed, setSiderCollapsed] = useState(true);
    const [showMetadataPanel, setShowMetadataPanel] = useState(false);
    const size= useSize(document.querySelector('body'));
    const imagesBoxSize = useSize(document.querySelector('#imagesBox'));
    const { data, error, loading, runAsync, mutate, refresh, refreshAsync } = useRequest(getImages, { manual: true });
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
            console.log("file_change:", event.detail);
            updateImages(event.detail);
        });

        ComfyAppApi.onUpdate((event) => {
            console.log("update:", event.detail);
            updateImages(event.detail); // Pass the whole object, not event.detail.folders
        });
        
        ComfyAppApi.onClear((event) => {
            mutate({ folders: {} });
        });
    }, []);

    // Watch for changes to settingsState.relativePath, disableLogs, usePollingObserver and update monitoring and data
    // Start monitoring when settings change
    const saveSettings = (newSettings: SettingsState) => {
        setSettings(newSettings);
        ComfyAppApi.saveSettings(newSettings);
    };

    useEffect(() => {
        if (settingsState?.relativePath) {
            ComfyAppApi.startMonitoring(
                settingsState.relativePath, 
                settingsState.disableLogs, 
                settingsState.usePollingObserver,
                settingsState.scanExtensions // Pass extensions here
            );
            runAsync();
        }
    }, [settingsState?.relativePath, settingsState?.disableLogs, settingsState?.usePollingObserver, JSON.stringify(settingsState?.scanExtensions)]);

    // Recovery B: when gallery is opened, restart monitoring if dead and refresh image list
    useEffect(() => {
        if (open && settingsState?.relativePath) {
            ComfyAppApi.startMonitoring(
                settingsState.relativePath,
                settingsState.disableLogs,
                settingsState.usePollingObserver,
                settingsState.scanExtensions
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
    useEffect(() => {
        if (settingsState && (settingsState._settingsVersion ?? 1) < 3) {
            setSettings({ ...settingsState, darkMode: true, _settingsVersion: 3 });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync dark mode setting → Tailwind's .dark class on <html>
    useEffect(() => {
        document.documentElement.classList.toggle('dark', !!settingsState?.darkMode);
    }, [settingsState?.darkMode]);

    // Memoized list of all images in the current folder
    const imagesDetailsList = useMemo(() => {
        // '' = show all folders flattened (root / default view)
        // group filter = flatMap across all folders
        // specific folder = that folder only
        const allItems: FileDetails[] = filteredRelPaths !== null
            ? Object.values(data?.folders ?? {}).flatMap(folder => Object.values(folder as Record<string, FileDetails>))
            : currentFolder === ''
                ? Object.values(data?.folders ?? {}).flatMap(folder => Object.values(folder as Record<string, FileDetails>))
                : Object.values(data?.folders?.[currentFolder] ?? []);

        let list = allItems;

        // Apply active filter (drill-down from group card)
        if (filteredRelPaths !== null) {
            const pathSet = new Set(filteredRelPaths);
            list = list.filter(item => item.rel_path && pathSet.has(item.rel_path));
        }

        if (searchFileName && searchFileName.trim() !== "") {
            const searchTerm = searchFileName.toLowerCase();
            list = list.filter(imageInfo => imageInfo.name.toLowerCase().includes(searchTerm));
        }
        // Step 1: Sort
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
        // Step 2: Group dividers (date/resolution modes only)
        if (viewMode !== 'date' && viewMode !== 'resolution') return list;

        const getGroupKey = (item: FileDetails): string => {
            switch (viewMode) {
                case 'date':
                    return item.timestamp ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : 'Unknown';
                case 'resolution':
                    return (item.width && item.height) ? `${item.width}x${item.height}` : 'Unknown';
                default:
                    return 'Unknown';
            }
        };

        const grouped: Record<string, FileDetails[]> = {};
        list.forEach(item => {
            const key = getGroupKey(item);
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
        });

        const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
            if (a === 'Unknown' || a === 'N/A') return 1;
            if (b === 'Unknown' || b === 'N/A') return -1;
            if (viewMode === 'date') {
                return sortMethod === 'Oldest' ? a.localeCompare(b) : b.localeCompare(a);
            }
            return a.localeCompare(b);
        });

        const result: FileDetails[] = [];
        const colCount = Math.max(1, gridSize.columnCount || 1);
        sortedGroups.forEach(([key, items]) => {
            for (let i = 0; i < colCount; i++) {
                result.push({ name: key, type: 'divider', count: items.length } as FileDetails);
            }
            result.push(...items);
            const remainder = items.length % colCount;
            if (remainder !== 0 && colCount > 1) {
                for (let i = 0; i < colCount - remainder; i++) {
                    result.push({ type: 'empty-space' } as FileDetails);
                }
            }
        });
        return result;
    }, [currentFolder, data, sortMethod, searchFileName, gridSize.columnCount, viewMode, filteredRelPaths]);

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
    }, [imagesDetailsList, currentFolder]);
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

    const value = useMemo(() => ({
        currentFolder, setCurrentFolder,
        searchFileName, setSearchFileName,
        viewMode, setViewMode,
        activeFilter, setActiveFilter,
        filteredRelPaths, setFilteredRelPaths,
        showSettings, setShowSettings,
        showRawMetadata, setShowRawMetadata,
        sortMethod, setSortMethod,
        imageInfoName, setImageInfoName,
        open, setOpen,
        previewingVideo, setPreviewingVideo,
        size, imagesBoxSize,
        data, error, loading, runAsync, mutate,
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
        siderCollapsed,
        setSiderCollapsed,
        showMetadataPanel,
        setShowMetadataPanel,
    }), [
        currentFolder, 
        searchFileName, 
        viewMode,
        activeFilter,
        filteredRelPaths,
        showSettings, 
        showRawMetadata, 
        sortMethod, 
        imageInfoName, 
        open, 
        previewingVideo, 
        size, 
        imagesBoxSize, 
        data, 
        error, 
        loading, 
        runAsync, 
        mutate,
        gridSize, 
        autoSizer, 
        imagesDetailsList, 
        imagesAutoCompleteNames, 
        autoCompleteOptions,
        settingsState, 
        saveSettings,
        selectedImages,
        setSelectedImages,
        siderCollapsed,
        setSiderCollapsed,
        showMetadataPanel,
        setShowMetadataPanel,
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
