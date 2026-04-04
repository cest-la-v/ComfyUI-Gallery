import { useEffect, useRef, useState } from 'react';
import { Flex, AutoComplete, Button, Segmented, Modal, message, Popconfirm, Tag } from 'antd';
import { CloseSquareFilled, DoubleLeftOutlined, DoubleRightOutlined, CloseOutlined } from '@ant-design/icons';
import { useGalleryContext } from './GalleryContext';
import type { ViewMode } from './GalleryContext';
import { useDebounce, useCountDown } from 'ahooks';
import Typography from 'antd/es/typography/Typography';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { BASE_PATH, ComfyAppApi } from './ComfyAppApi';

const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
    { label: 'All', value: 'all' },
    { label: 'By Date', value: 'date' },
    { label: 'By Resolution', value: 'resolution' },
    { label: 'By Model', value: 'model' },
    { label: 'By Prompt', value: 'prompt' },
];

const GalleryHeader = () => {
    const {
        showSettings, setShowSettings,
        searchFileName, setSearchFileName,
        sortMethod, setSortMethod,
        viewMode, setViewMode,
        activeFilter, setActiveFilter,
        setFilteredRelPaths,
        imagesAutoCompleteNames,
        autoCompleteOptions, setAutoCompleteOptions,
        setOpen,
        selectedImages, setSelectedImages,
        mutate,
        siderCollapsed, setSiderCollapsed,
    } = useGalleryContext();

    const [search, setSearch] = useState("");
    const [showClose, setShowClose] = useState(false);
    const [targetDate, setTargetDate] = useState<number>();
    const [countdown] = useCountDown({
        targetDate,
        onEnd: () => {
            setOpen(false);
            setShowClose(false);
            setTargetDate(undefined);
        },
    });
    const dragCounter = useRef(0);

    const [downloading, setDownloading] = useState(false);
    const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Show close button only when dragging
    useEffect(() => {
        const onDragStart = () => setShowClose(true);
        const onDragEnd = () => {
            setShowClose(false);
            setTargetDate(undefined);
        };
        window.addEventListener('dragstart', onDragStart);
        window.addEventListener('dragend', onDragEnd);
        return () => {
            window.removeEventListener('dragstart', onDragStart);
            window.removeEventListener('dragend', onDragEnd);
        };
    }, []);

    // Debounce the search input to prevent lag
    const debouncedSearch = useDebounce(search, { wait: 100 });

    useEffect(() => {
        setSearchFileName(debouncedSearch);

        if (!debouncedSearch || debouncedSearch.length == 0) {
            setAutoCompleteOptions(imagesAutoCompleteNames);
        } else {
            setAutoCompleteOptions(
                imagesAutoCompleteNames.filter(opt =>
                    typeof opt.value === 'string' && opt.value.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
            );
        }
    }, [debouncedSearch, imagesAutoCompleteNames, setAutoCompleteOptions]);

    const clearFilter = () => {
        setActiveFilter(null);
        setFilteredRelPaths(null);
    };

    return (
        <Flex 
            justify={"space-between"} 
            align={"center"}
            gap={20}
        >
            <div
                style={{
                    display: "flex",
                    alignContent: "center",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "20px",
                }}      
            >
                <Button
                    size="middle"
                    onClick={() => setSiderCollapsed((prev: boolean) => !prev)}
                >
                    {siderCollapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
                </Button>
                <Button 
                    size={"middle"} 
                    onClick={() => setShowSettings(true)}
                >
                    Settings
                </Button>
            </div>
            {selectedImages && selectedImages.length > 0 && (
                <>
                    <Popconfirm
                        title="Download Selected Images"
                        description={`Are you sure you want to download ${selectedImages.length} selected image(s)?`}
                        onConfirm={async () => {
                            setDownloading(true);
                            try {
                                const zip = new JSZip();
                                await Promise.all(selectedImages.map(async (url) => {
                                    try {
                                        const fetchUrl = url.startsWith('http') ? url : `${BASE_PATH}${url}`;
                                        const response = await fetch(fetchUrl);
                                        const blob = await response.blob();
                                        const filename = url.split('/').pop() || 'image';
                                        zip.file(filename, blob);
                                    } catch (e) {
                                        console.error('Failed to fetch image:', url, e);
                                    }
                                }));
                                const content = await zip.generateAsync({ type: 'blob' });
                                FileSaver.saveAs(content, 'comfy-ui-gallery-images.zip');
                            } catch (error) {
                                message.error('Failed to download images.');
                            } finally {
                                setDownloading(false);
                            }
                        }}
                        onCancel={() => message.info('Download cancelled')}
                        okText={`Download (${selectedImages.length})`}
                        cancelText="Cancel"
                        okButtonProps={{ loading: downloading }}
                    >
                        <Button
                            type="primary"
                            loading={downloading}
                            style={{ marginLeft: 8 }}
                            className="selectedImagesActionButton"
                        >
                            Download Selected
                        </Button>
                    </Popconfirm>
                    <Popconfirm
                        title="Delete Selected Images"
                        description={`Are you sure you want to delete ${selectedImages.length} selected image(s)? This cannot be undone.`}
                        onConfirm={async () => {
                            let deleted = 0;
                            const failed: string[] = [];
                            for (const url of selectedImages) {
                                try {
                                    const ok = await ComfyAppApi.deleteImage(url);
                                    if (ok) {
                                        deleted++;
                                        mutate((oldData) => {
                                            if (!oldData?.folders) return oldData;
                                            const folders = { ...oldData.folders };
                                            for (const folder of Object.keys(folders)) {
                                                const files = { ...folders[folder] };
                                                for (const filename of Object.keys(files)) {
                                                    if (files[filename].url === url) {
                                                        delete files[filename];
                                                    }
                                                }
                                                if (Object.keys(files).length === 0) {
                                                    delete folders[folder];
                                                } else {
                                                    folders[folder] = files;
                                                }
                                            }
                                            return { ...oldData, folders };
                                        });
                                    } else {
                                        failed.push(url);
                                    }
                                    await new Promise(res => setTimeout(res, 50));
                                } catch (e) {
                                    console.error('Failed to delete image:', url, e);
                                    failed.push(url);
                                }
                            }
                            setSelectedImages([]);
                            if (failed.length > 0) {
                                message.warning(`Deleted ${deleted} image(s), ${failed.length} failed.`);
                            } else {
                                message.success(`Deleted ${deleted} image(s).`);
                            }
                        }}
                        onCancel={() => message.info('Delete cancelled')}
                        okText={`Delete (${selectedImages.length})`}
                        cancelText="Cancel"
                        okButtonProps={{ danger: true }}
                    >
                        <Button
                            danger
                            style={{ marginLeft: 8 }}
                            className="selectedImagesActionButton"
                        >
                            Delete Selected
                        </Button>
                    </Popconfirm>
                </>
            )}
            {showClose && (
                <div
                    style={{ 
                        display: 'inline-block' 
                    }}
                    onDragEnter={e => {
                        e.preventDefault();
                        dragCounter.current++;
                        if (!targetDate) {
                            setTargetDate(Date.now() + 3000);
                        }
                    }}
                    onDragLeave={e => {
                        e.preventDefault();
                        dragCounter.current--;
                        if (dragCounter.current === 0 && targetDate) {
                            setTargetDate(undefined);
                        }
                    }}
                >
                    <Button
                        type="default"
                        style={{ 
                            marginLeft: "8px",
                            display: "flex",
                            alignItems: "center",
                            position: "relative",
                            cursor: "pointer",
                            justifyContent: "center",
                            alignContent: "center",
                            flexWrap: "wrap",
                            width: 150
                        }}
                        tabIndex={-1}
                    >
                        {targetDate
                            ? (
                                <Typography 
                                    style={{ 
                                        color: '#ff4d4f', 
                                        fontWeight: 500 
                                    }}
                                >
                                    {`   Close in ${Math.ceil(countdown / 1000)}s   `}
                                </Typography>
                            ) : (
                                <Typography 
                                    style={{ 
                                        color: '#888', 
                                        fontWeight: 400 
                                    }}
                                >
                                    Hover to close 3s
                                </Typography>
                            )
                        }
                    </Button>
                </div>
            )}
            {activeFilter && (
                <Tag
                    color="blue"
                    closable
                    closeIcon={<CloseOutlined />}
                    onClose={clearFilter}
                    style={{ fontSize: 13, padding: '2px 8px' }}
                >
                    {activeFilter.by === 'model' ? 'Model' : 'Prompt'}: {activeFilter.label}
                </Tag>
            )}
            <AutoComplete
                options={
                    autoCompleteOptions && autoCompleteOptions.length > 0 
                        ? autoCompleteOptions 
                        : imagesAutoCompleteNames
                    }
                style={{ 
                    width: '40%' 
                }}
                onSearch={text => setSearch(text)}
                value={search}
                onChange={val => setSearch(val)}
                placeholder="Search for file name"
                allowClear={{ 
                    clearIcon: <CloseSquareFilled /> 
                }}
            />
            <Segmented<ViewMode>
                options={VIEW_MODE_OPTIONS}
                value={viewMode}
                onChange={v => {
                    setViewMode(v);
                    // Switching away from model/prompt view clears the filter
                    if (v !== 'model' && v !== 'prompt') {
                        clearFilter();
                    }
                }}
            />
            <Segmented<string>
                style={{ 
                    marginRight: 15 
                }}
                options={['Newest', 'Oldest', 'Name ↑', 'Name ↓']}
                value={sortMethod}
                onChange={value => setSortMethod(value as any)}
            />
        </Flex>
    );
};

export default GalleryHeader;
