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
        appMode, setAppMode, setGroupBy,
    } = useGalleryContext();

    const handleSelectModel = (model: string) => {
        // Switch back to images view with "By Model" grouping active
        setGroupBy('model');
        setAppMode('images');
        // Future: could also set a model filter here
        void model;
    };

    const handleSelectPrompt = () => {
        setAppMode('images');
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
                {appMode === 'groups' ? (
                    <GroupView
                        onSelectModel={handleSelectModel}
                        onSelectPrompt={handleSelectPrompt}
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
