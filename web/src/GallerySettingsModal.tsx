import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
    AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
    AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useGalleryContext, type SettingsState } from './GalleryContext';
import { useSetState } from 'ahooks';
import { useEffect, useState, useCallback } from 'react';
import { useDebounceFn } from 'ahooks';
import { ComfyAppApi, isComfyMode } from './ComfyAppApi';
import { cn } from '@/lib/utils';

interface DbStatus {
    schema_version: number;
    file_count: number;
    params_count: number;
    db_path: string;
}

interface ResolvedPath {
    resolved: string;
    exists: boolean;
}

/** A single settings row: fixed label left, control right. */
function SettingRow({ label, description, children }: {
    label: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex flex-col">
                <span className="text-sm font-medium leading-tight">{label}</span>
                {description && <span className="text-xs text-muted-foreground leading-tight mt-0.5">{description}</span>}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

/** Switch with a static On/Off label alongside. */
function LabeledSwitch({ checked, onCheckedChange }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-6 text-right">{checked ? 'On' : 'Off'}</span>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}

/** Two-option segmented control (replaces confusing switch for binary named options). */
function SegmentedControl<T extends string>({ value, options, onChange }: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
}) {
    return (
        <div className="flex rounded-md border border-input overflow-hidden text-xs">
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        "px-3 py-1 transition-colors",
                        value === opt.value
                            ? "bg-primary text-primary-foreground font-medium"
                            : "bg-transparent text-foreground hover:bg-accent"
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

const GallerySettingsModal = () => {
    const { showSettings, setShowSettings, settings, setSettings } = useGalleryContext();
    const [staged, setStaged] = useSetState<SettingsState>(settings);
    const [extInput, setExtInput] = useState("");
    const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
    const [resolvedPath, setResolvedPath] = useState<ResolvedPath | null>(null);
    const [resolving, setResolving] = useState(false);

    // When modal opens, reset staged to current settings and fetch DB status
    useEffect(() => {
        if (showSettings) {
            setStaged(settings);
            setExtInput((settings && (settings as any).scanExtensions) ? (settings as any).scanExtensions.join(', ') : "");
            fetch('/Gallery/db/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => setDbStatus(d)).catch(() => {});
        }
    }, [showSettings, settings, setStaged]);

    // Live path resolution — debounced 400ms
    const doResolve = useCallback(async (path: string) => {
        setResolving(true);
        const result = await ComfyAppApi.resolvePath(path);
        setResolvedPath(result);
        setResolving(false);
    }, []);

    const { run: debouncedResolve } = useDebounceFn(doResolve, { wait: 400 });

    // Resolve whenever staged path changes or modal opens
    useEffect(() => {
        if (showSettings) {
            debouncedResolve(staged.relativePath);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [staged.relativePath, showSettings]);

    const handleSave = () => {
        const exts = extInput.split(',').map(s => s.trim().replace(/^\./, '')).filter(s => s);
        const newSettings = { ...staged, scanExtensions: exts } as SettingsState;
        setSettings(newSettings);
        setShowSettings(false);
    };
    const handleCancel = () => setShowSettings(false);

    return (
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
            <DialogContent className="max-w-lg" data-gallery-root>
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3 py-2">

                    {/* Source path */}
                    <div>
                        <label className="text-sm font-medium">Source Path</label>
                        <Input
                            className="mt-1"
                            value={staged.relativePath}
                            onChange={e => setStaged({ relativePath: e.target.value })}
                            placeholder="./ or /absolute/path"
                        />
                        {/* Live resolved path display */}
                        <div className="mt-1 min-h-[1.25rem] flex items-center gap-1.5">
                            {resolving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                            {!resolving && resolvedPath && (
                                <>
                                    {resolvedPath.exists
                                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                        : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                                    }
                                    <span className={cn(
                                        "text-xs font-mono truncate",
                                        resolvedPath.exists ? "text-muted-foreground" : "text-destructive"
                                    )}>
                                        {resolvedPath.resolved}
                                        {!resolvedPath.exists && " (not found)"}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    <Separator />

                    {/* Button settings */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Entry Button</span>
                        <SettingRow label="Button Label">
                            <Input
                                className="h-8 w-40 text-sm"
                                value={staged.buttonLabel}
                                onChange={e => setStaged({ buttonLabel: e.target.value })}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Open Button"
                            description={isComfyMode
                                ? '"Embedded" uses the native ComfyUI action bar button; "Floating" adds a draggable button over the canvas'
                                : '"Floating" shows a draggable button; "Embedded" shows a fixed inline button'}
                        >
                            <SegmentedControl
                                value={staged.floatingButton ? 'floating' : 'embedded'}
                                options={[{ label: 'Embedded', value: 'embedded' }, { label: 'Floating', value: 'floating' }]}
                                onChange={v => setStaged({ floatingButton: v === 'floating' })}
                            />
                        </SettingRow>
                    </div>

                    <Separator />

                    {/* Behaviour settings */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Behaviour</span>
                        <SettingRow label="Auto-play Videos">
                            <LabeledSwitch
                                checked={staged.autoPlayVideos}
                                onCheckedChange={v => setStaged({ autoPlayVideos: v })}
                            />
                        </SettingRow>
                        <SettingRow label="Ctrl+G Shortcut" description="Open gallery with keyboard shortcut">
                            <LabeledSwitch
                                checked={staged.galleryShortcut}
                                onCheckedChange={v => setStaged({ galleryShortcut: v })}
                            />
                        </SettingRow>
                        <SettingRow label="Expand All Folders" description="Expand all sidebar folders on load">
                            <LabeledSwitch
                                checked={staged.expandAllFolders}
                                onCheckedChange={v => setStaged({ expandAllFolders: v })}
                            />
                        </SettingRow>
                    </div>

                    <Separator />

                    {/* Advanced */}
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Advanced</span>
                        <SettingRow label="Terminal Logs">
                            <LabeledSwitch
                                checked={!staged.disableLogs}
                                onCheckedChange={v => setStaged({ disableLogs: !v })}
                            />
                        </SettingRow>
                        <SettingRow label="File Watcher" description="Polling works on network drives; native is more efficient">
                            <SegmentedControl
                                value={staged.usePollingObserver ? 'polling' : 'native'}
                                options={[
                                    { value: 'native', label: 'Native' },
                                    { value: 'polling', label: 'Polling' },
                                ]}
                                onChange={v => setStaged({ usePollingObserver: v === 'polling' })}
                            />
                        </SettingRow>
                        <div>
                            <label className="text-sm font-medium">Scan File Extensions</label>
                            <p className="text-xs text-muted-foreground mb-1">Comma separated (e.g. png, jpg, mp4, wav)</p>
                            <Input value={extInput} onChange={e => setExtInput(e.target.value)} />
                        </div>
                    </div>

                    <Separator />

                    {/* Danger zone */}
                    <div>
                        <label className="text-sm font-medium text-destructive">Danger Zone</label>
                        {dbStatus && (
                            <p className="text-[11px] text-muted-foreground mt-1 mb-1.5">
                                DB v{dbStatus.schema_version} · {dbStatus.file_count} files · {dbStatus.params_count} with metadata
                                {dbStatus.params_count === 0 && dbStatus.file_count > 0 && (
                                    <span className="text-destructive"> — no metadata cached, reset to rebuild</span>
                                )}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground mb-2">
                            Reset the gallery database — clears all cached metadata. The next scan will rebuild it from scratch.
                        </p>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm">Reset Database</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Reset Gallery Database</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will delete all cached metadata. Metadata will be re-extracted on the next scan. Continue?
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        className={buttonVariants({ variant: 'destructive' })}
                                        onClick={async () => {
                                            try {
                                                const res = await fetch('/Gallery/db/reset', { method: 'POST' });
                                                if (res.ok) {
                                                    toast.success('Database reset. Metadata will be rebuilt on next scan.');
                                                    setDbStatus(null);
                                                } else {
                                                    toast.error('Reset failed: ' + res.statusText);
                                                }
                                            } catch {
                                                toast.error('Reset failed: network error');
                                            }
                                        }}
                                    >
                                        Reset
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel}>Return</Button>
                    <Button onClick={handleSave}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default GallerySettingsModal;
