import Modal from 'antd/es/modal/Modal';
import { Button, Flex, Input, Switch, Typography, Popconfirm, message, Divider } from 'antd';
import { useGalleryContext, type SettingsState } from './GalleryContext';
import { useSetState } from 'ahooks';
import { useEffect, useState } from 'react';
import { BASE_Z_INDEX } from './ComfyAppApi';

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
            fetch('/Gallery/db/status').then(r => r.ok ? r.json() : null).then(d => setDbStatus(d)).catch(() => {});
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
        <Modal
            zIndex={BASE_Z_INDEX + 1}
            title={"Settings"}
            open={showSettings}
            centered
            afterOpenChange={setShowSettings}
            onOk={handleSave}
            onCancel={handleCancel}
            footer={[
                <Button 
                    key="back" 
                    onClick={handleCancel}
                >
                    Return
                </Button>,
                <Button 
                    key="submit" 
                    type="primary" 
                    onClick={handleSave}
                >
                    Save
                </Button>
            ]}
        >
            <Flex 
                vertical 
                gap={16}
            >
                <div>
                    <Typography.Title 
                        level={5}
                    >
                        Relative Path:
                    </Typography.Title>
                    <Input 
                        value={staged.relativePath} 
                        onChange={e => setStaged({ relativePath: e.target.value })} 
                    />
                </div>
                <div>
                    <Typography.Title 
                        level={5}
                    >
                        Button Box Query:
                    </Typography.Title>
                    <Input 
                        value={staged.buttonBoxQuery} 
                        onChange={e => setStaged({ buttonBoxQuery: e.target.value })} 
                    />
                </div>
                <div>
                    <Typography.Title 
                        level={5}
                    >
                        Button Label:
                    </Typography.Title>
                    <Input 
                        value={staged.buttonLabel} 
                        onChange={e => setStaged({ buttonLabel: e.target.value })} 
                    />
                </div>
                <Switch
                    checkedChildren={"Floating Button"}
                    unCheckedChildren={"Normal Button"}
                    checked={staged.floatingButton}
                    onChange={checked => setStaged({ floatingButton: checked })}
                />
                <Switch
                    checkedChildren={"Auto Play Videos"}
                    unCheckedChildren={"Don't Auto Play Videos"}
                    checked={staged.autoPlayVideos}
                    onChange={checked => setStaged({ autoPlayVideos: checked })}
                />
                <Switch
                    checkedChildren={"Hide Open Button"}
                    unCheckedChildren={"Show Open Button"}
                    checked={staged.hideOpenButton}
                    onChange={checked => setStaged({ hideOpenButton: checked })}
                />
                <Switch
                    checkedChildren={"Dark Mode"}
                    unCheckedChildren={"Light Mode"}
                    checked={staged.darkMode}
                    onChange={checked => setStaged({ darkMode: checked })}
                />
                <Switch
                    checkedChildren={"Enable Ctrl+G Shortcut"}
                    unCheckedChildren={"Disable Ctrl+G Shortcut"}
                    checked={staged.galleryShortcut}
                    onChange={checked => setStaged({ galleryShortcut: checked })}
                />
                <Switch
                    checkedChildren={"Expand All Folders"}
                    unCheckedChildren={"Collapse All Folders"}
                    checked={staged.expandAllFolders}
                    onChange={checked => setStaged({ expandAllFolders: checked })}
                />
                <Switch
                    checkedChildren={"Disable Terminal Logs"}
                    unCheckedChildren={"Enable Terminal Logs"}
                    checked={staged.disableLogs}
                    onChange={checked => setStaged({ disableLogs: checked })}
                />
                <Switch
                    checkedChildren={"Use Polling Observer"}
                    unCheckedChildren={"Use Native Observer"}
                    checked={staged.usePollingObserver}
                    onChange={checked => setStaged({ usePollingObserver: checked })}
                />
                <div>
                    <Typography.Title level={5}>Scan File Extensions:</Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Comma separated (e.g. png, jpg, mp4, wav)</Typography.Text>
                    <Input value={extInput} onChange={e => setExtInput(e.target.value)} />
                </div>
                <Divider style={{ margin: '12px 0' }} />
                <div>
                    <Typography.Title level={5} type="danger">Danger Zone</Typography.Title>
                    {dbStatus && (
                        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                            DB v{dbStatus.schema_version} · {dbStatus.file_count} files · {dbStatus.params_count} with metadata
                            {dbStatus.params_count === 0 && dbStatus.file_count > 0 && (
                                <span style={{ color: '#ff4d4f' }}> — no metadata cached, reset to rebuild</span>
                            )}
                        </Typography.Text>
                    )}
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                        Reset the gallery database — clears all cached metadata. The next scan will rebuild it from scratch.
                    </Typography.Text>
                    <Popconfirm
                        title="Reset Gallery Database"
                        description="This will delete all cached metadata. Metadata will be re-extracted on the next scan. Continue?"
                        okText="Reset"
                        cancelText="Cancel"
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                            try {
                                const res = await fetch('/Gallery/db/reset', { method: 'POST' });
                                if (res.ok) {
                                    message.success('Database reset. Metadata will be rebuilt on next scan.');
                                    setDbStatus(null);
                                } else {
                                    message.error('Reset failed: ' + res.statusText);
                                }
                            } catch (e) {
                                message.error('Reset failed: network error');
                            }
                        }}
                    >
                        <Button danger>Reset Database</Button>
                    </Popconfirm>
                </div>
            </Flex>
        </Modal>
    );
};

export default GallerySettingsModal;
