import Modal from 'antd/es/modal/Modal';
import Layout from 'antd/es/layout/layout';
import Sider from 'antd/es/layout/Sider';
import { useGalleryContext } from './GalleryContext';
import GalleryHeader from './GalleryHeader';
import GallerySidebar from './GallerySidebar';
import GalleryImageGrid from './GalleryImageGrid';
import GallerySettingsModal from './GallerySettingsModal';
import GroupView from './GroupView';
import { BASE_Z_INDEX } from './ComfyAppApi';

const GalleryModal = () => {
    const {
        open, setOpen, size, showSettings, siderCollapsed,
        viewMode, setViewMode, setActiveFilter, setFilteredRelPaths,
    } = useGalleryContext();

    const handleSelectModel = async (model: string) => {
        try {
            const res = await fetch(`/Gallery/groups/files?by=model&value=${encodeURIComponent(model)}`, { cache: 'no-store' });
            const json = await res.json();
            setFilteredRelPaths(json.rel_paths ?? []);
            setActiveFilter({ by: 'model', value: model, label: model });
            setViewMode('all');
        } catch (e) {
            console.error('Failed to fetch group files:', e);
            setViewMode('all');
        }
    };

    const handleSelectPrompt = async (fingerprint: string, label: string) => {
        try {
            const res = await fetch(`/Gallery/groups/files?by=prompt&value=${encodeURIComponent(fingerprint)}`, { cache: 'no-store' });
            const json = await res.json();
            setFilteredRelPaths(json.rel_paths ?? []);
            setActiveFilter({ by: 'prompt', value: fingerprint, label });
            setViewMode('all');
        } catch (e) {
            console.error('Failed to fetch group files:', e);
            setViewMode('all');
        }
    };

    return (
        <>
        <Modal
            zIndex={BASE_Z_INDEX}
            title={<GalleryHeader />}
            centered
            open={open}
            afterOpenChange={setOpen}
            onOk={() => setOpen(false)}
            onCancel={() => setOpen(false)}
            width={size?.width}
            footer={null}
        >
            <Layout 
                style={{ 
                    borderRadius: 8, 
                    overflowX: "hidden", 
                    overflowY: "auto", 
                    width: '100%', 
                    height: "85vh" 
                }}
            >
                {viewMode === 'model' || viewMode === 'prompt' ? (
                    <GroupView
                        onSelectModel={handleSelectModel}
                        onSelectPrompt={handleSelectPrompt}
                        activeTab={viewMode === 'prompt' ? 'prompt' : 'model'}
                    />
                ) : (
                    <>
                        <Sider 
                            collapsed={siderCollapsed}
                            collapsedWidth={0}
                            width="20%" 
                            style={{ 
                                overflow: 'auto', 
                                position: 'sticky', 
                                insetInlineStart: 0, 
                                top: 0, 
                                bottom: 0, 
                                scrollbarWidth: 'thin', 
                                scrollbarGutter: 'stable', 
                                background: "transparent" 
                            }}
                        >
                            <GallerySidebar />
                        </Sider>
                        <GalleryImageGrid />
                    </>
                )}
            </Layout>
        </Modal>
            {showSettings && <GallerySettingsModal />}
        </>
    );
};

export default GalleryModal;
