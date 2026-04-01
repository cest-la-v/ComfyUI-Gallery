import { useCallback } from 'react';
import type { FileDetails } from './types';
import ReactJsonView from '@microlink/react-json-view';
import Modal from 'antd/es/modal/Modal';
import { BASE_PATH, BASE_Z_INDEX } from './ComfyAppApi';
import { useGalleryContext } from './GalleryContext';
import { MetadataPanel } from './MetadataPanel';
import InfoCircleOutlined from '@ant-design/icons/lib/icons/InfoCircleOutlined';
import { Button, Tooltip } from 'antd';

export function UnifiedPreview({
    image,
    showRawMetadata,
    setShowRawMetadata,
}: {
    image: FileDetails;
    showRawMetadata: boolean;
    setShowRawMetadata: (show: boolean) => void;
}) {
    const { settings, showMetadataPanel, setShowMetadataPanel } = useGalleryContext();

    const renderMedia = useCallback(() => {
        if (image.type === 'image') {
            return (
                <img
                    src={`${BASE_PATH}${image.url}`}
                    alt={image.name}
                    style={{
                        maxWidth: showMetadataPanel ? 'calc(100% - 500px)' : '90%',
                        maxHeight: '85vh',
                        objectFit: 'contain',
                        borderRadius: 8,
                        transition: 'max-width 0.2s ease-in-out',
                    }}
                    draggable={false}
                />
            );
        }
        if (image.type === 'media') {
            return (
                <video
                    key={image.name}
                    style={{ maxWidth: showMetadataPanel ? 'calc(100% - 500px)' : '80%', maxHeight: '85vh' }}
                    src={`${BASE_PATH}${image.url}`}
                    autoPlay
                    controls
                    preload="none"
                />
            );
        }
        if (image.type === 'audio') {
            return (
                <audio
                    key={image.name}
                    style={{ width: showMetadataPanel ? 'calc(100% - 500px)' : '80%' }}
                    src={`${BASE_PATH}${image.url}`}
                    autoPlay
                    controls
                    preload="none"
                />
            );
        }
        return null;
    }, [image, showMetadataPanel]);

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
            }}
        >
            {/* Main media content - centered, respecting sidebar space */}
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    paddingRight: showMetadataPanel ? 480 : 0,
                    transition: 'padding-right 0.2s ease-in-out',
                }}
            >
                {renderMedia()}
            </div>

            {/* Toggle metadata panel button - shown when panel is closed */}
            {!showMetadataPanel && (
                <Tooltip title="Show metadata" placement="left">
                    <Button
                        type="primary"
                        shape="circle"
                        icon={<InfoCircleOutlined />}
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMetadataPanel(true);
                        }}
                        style={{
                            position: 'absolute',
                            top: 16,
                            right: 16,
                            zIndex: 10,
                            background: 'rgba(0, 0, 0, 0.6)',
                            border: 'none',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                        }}
                    />
                </Tooltip>
            )}

            {/* Show Raw Metadata button - top left */}
            <Tooltip title="Show the raw JSON metadata" placement="right">
                <Button
                    type="dashed"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowRawMetadata(true);
                    }}
                    style={{
                        position: 'absolute',
                        top: 16,
                        left: 16,
                        zIndex: 10,
                    }}
                >
                    Raw JSON
                </Button>
            </Tooltip>

            {/* Metadata sidebar panel */}
            {showMetadataPanel && (
                <MetadataPanel
                    image={image}
                    onClose={() => setShowMetadataPanel(false)}
                />
            )}

            {/* Raw metadata modal */}
            <Modal
                zIndex={BASE_Z_INDEX + 2}
                title={`Raw Metadata: ${image.name}`}
                open={showRawMetadata}
                onCancel={() => setShowRawMetadata(false)}
                footer={null}
                width="100%"
                height="100%"
                style={{ padding: '40px' }}
                centered
            >
                {showRawMetadata && (
                    <ReactJsonView
                        theme={settings.darkMode ? 'apathy' : 'apathy:inverted'}
                        src={image.metadata || {}}
                        name={false}
                        collapsed={2}
                        enableClipboard
                        displayDataTypes={false}
                    />
                )}
            </Modal>
        </div>
    );
}

// Backward-compatible export
export { UnifiedPreview as MetadataView };
