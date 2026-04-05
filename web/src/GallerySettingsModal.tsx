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
import { useGalleryContext, type SettingsState } from './GalleryContext';
import { useSetState } from 'ahooks';
import { useEffect, useState } from 'react';

interface DbStatus {
    schema_version: number;
    file_count: number;
    params_count: number;
    db_path: string;
}

const GallerySettingsModal = () => {
    const { showSettings, setShowSettings, settings, setSettings } = useGalleryContext();
    const [staged, setStaged] = useSetState<SettingsState>(settings);
    const [extInput, setExtInput] = useState("");
    const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);

    // When modal opens, reset staged to current settings and fetch DB status
    useEffect(() => {
        if (showSettings) {
            setStaged(settings);
            setExtInput((settings && (settings as any).scanExtensions) ? (settings as any).scanExtensions.join(', ') : "");
            fetch('/Gallery/db/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => setDbStatus(d)).catch(() => {});
        }
    }, [showSettings, settings, setStaged]);

    // Save staged settings to context and close
    const handleSave = () => {
        const exts = extInput.split(',').map(s => s.trim().replace(/^\./, '')).filter(s => s);
        const newSettings = { ...staged, scanExtensions: exts } as SettingsState;
        setSettings(newSettings);
        setShowSettings(false);
    };
    // Cancel: just close modal (staged will reset on next open)
    const handleCancel = () => {
        setShowSettings(false);
    };

    return (
        <Dialog open={showSettings} onOpenChange={setShowSettings}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2">
                    <div>
                        <label className="text-sm font-medium">Relative Path:</label>
                        <Input
                            className="mt-1"
                            value={staged.relativePath}
                            onChange={e => setStaged({ relativePath: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium">Button Box Query:</label>
                        <Input
                            className="mt-1"
                            value={staged.buttonBoxQuery}
                            onChange={e => setStaged({ buttonBoxQuery: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium">Button Label:</label>
                        <Input
                            className="mt-1"
                            value={staged.buttonLabel}
                            onChange={e => setStaged({ buttonLabel: e.target.value })}
                        />
                    </div>

                    {([
                        { key: 'floatingButton',      on: 'Floating Button',        off: 'Normal Button' },
                        { key: 'autoPlayVideos',      on: 'Auto Play Videos',       off: "Don't Auto Play Videos" },
                        { key: 'hideOpenButton',      on: 'Hide Open Button',       off: 'Show Open Button' },
                        { key: 'darkMode',            on: 'Dark Mode',              off: 'Light Mode' },
                        { key: 'galleryShortcut',     on: 'Enable Ctrl+G Shortcut', off: 'Disable Ctrl+G Shortcut' },
                        { key: 'expandAllFolders',    on: 'Expand All Folders',     off: 'Collapse All Folders' },
                        { key: 'disableLogs',         on: 'Disable Terminal Logs',  off: 'Enable Terminal Logs' },
                        { key: 'usePollingObserver',  on: 'Use Polling Observer',   off: 'Use Native Observer' },
                    ] as const).map(({ key, on, off }) => (
                        <div key={key} className="flex items-center justify-between">
                            <span className="text-sm select-none">
                                {(staged as unknown as Record<string, boolean>)[key] ? on : off}
                            </span>
                            <Switch
                                checked={(staged as unknown as Record<string, boolean>)[key]}
                                onCheckedChange={checked => setStaged({ [key]: checked } as unknown as Pick<SettingsState, keyof SettingsState>)}
                            />
                        </div>
                    ))}

                    <div>
                        <label className="text-sm font-medium">Scan File Extensions:</label>
                        <p className="text-xs text-muted-foreground mb-1">Comma separated (e.g. png, jpg, mp4, wav)</p>
                        <Input value={extInput} onChange={e => setExtInput(e.target.value)} />
                    </div>

                    <Separator className="my-1" />

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
