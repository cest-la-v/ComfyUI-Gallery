import React, { useMemo, useCallback, memo, useRef, useState } from 'react';
import { Folder, ChevronRight, Loader2 } from 'lucide-react';
import { useGalleryContext } from './GalleryContext';
import type { FilesTree } from './types';
import { useDrop } from 'ahooks';
import { ComfyAppApi } from './ComfyAppApi';
import { cn } from '@/lib/utils';

interface TreeDataNode {
    title: string;
    key: string;
    children?: TreeDataNode[];
    isLeaf?: boolean;
}

const foldersToTreeData = (data: FilesTree): TreeDataNode[] => {
    const paths = Object.keys(data.folders);
    if (paths.length > 1) paths.sort();
    const tree: TreeDataNode[] = [];
    const nodeMap = new Map<string, TreeDataNode>();
    for (const fullPath of paths) {
        const segments = fullPath.split('/');
        let currentPath = "";
        for (let i = 0; i < segments.length; i++) {
            if (i > 0) currentPath += "/";
            currentPath += segments[i];
            if (!nodeMap.has(currentPath)) {
                const node: TreeDataNode = { title: segments[i], key: currentPath, children: [] };
                nodeMap.set(currentPath, node);
                if (i === 0) tree.push(node);
                else nodeMap.get(segments.slice(0, i).join('/'))?.children!.push(node);
            }
        }
    }
    for (const node of nodeMap.values()) {
        if (!node.children?.length) node.isLeaf = true;
    }
    return tree;
};

// Folder title — handles drag-drop target and ctrl+click image selection
const FolderTitle = memo(({ nodeData }: { nodeData: TreeDataNode }) => {
    const folderRef = useRef<HTMLSpanElement>(null);
    const { data, selectedImages, setSelectedImages } = useGalleryContext();

    const folderImages = useMemo(() => {
        if (!data?.folders?.[nodeData.key]) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return Object.values(data.folders[nodeData.key]).filter((img: any) => img?.url).map((img: any) => img.url);
    }, [data, nodeData.key]);

    const allSelected = folderImages.length > 0 && folderImages.every(url => selectedImages.includes(url));

    const handleClick = (e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            e.preventDefault();
            setSelectedImages(prev =>
                allSelected ? prev.filter(u => !folderImages.includes(u)) : Array.from(new Set([...prev, ...folderImages]))
            );
        } else {
            setSelectedImages([]);
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useDrop(folderRef, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onDom: (content: any) => {
            try {
                const d = typeof content === 'string' ? JSON.parse(content) : content;
                if (d?.name && d?.folder && d.folder !== nodeData.key) {
                    ComfyAppApi.moveImage(`${d.folder}/${d.name}`, `${nodeData.key}/${d.name}`);
                }
            } catch (err) { console.error('Error parsing drag data:', err); }
        },
    });

    return (
        <span
            ref={folderRef}
            className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded transition-colors cursor-pointer text-sm",
                allSelected && "bg-blue-500/15 ring-1 ring-blue-500"
            )}
            onClick={handleClick}
        >
            {nodeData.title}
        </span>
    );
});
FolderTitle.displayName = 'FolderTitle';

// Recursive tree node
function CustomTreeNode({
    node,
    selectedKey,
    onSelect,
    defaultExpandAll,
    depth,
}: {
    node: TreeDataNode;
    selectedKey: string;
    onSelect: (key: string) => void;
    defaultExpandAll: boolean;
    depth: number;
}) {
    const [expanded, setExpanded] = useState(defaultExpandAll);
    const hasChildren = !node.isLeaf && !!node.children?.length;

    return (
        <div>
            <div
                style={{ paddingLeft: depth * 16 }}
                className={cn(
                    "flex items-center gap-0.5 py-0.5 pr-2 cursor-pointer rounded-sm text-sm select-none",
                    selectedKey === node.key ? "bg-primary/20" : "hover:bg-accent/40"
                )}
                onClick={() => onSelect(node.key)}
            >
                <span
                    className="flex items-center justify-center h-5 w-5 shrink-0"
                    onClick={e => { e.stopPropagation(); if (hasChildren) setExpanded(x => !x); }}
                >
                    {hasChildren && (
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", expanded && "rotate-90")} />
                    )}
                </span>
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground mr-1" />
                <FolderTitle nodeData={node} />
            </div>
            {hasChildren && expanded && (
                <div>
                    {node.children!.map(child => (
                        <CustomTreeNode
                            key={child.key}
                            node={child}
                            selectedKey={selectedKey}
                            onSelect={onSelect}
                            defaultExpandAll={defaultExpandAll}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

const GallerySidebar = () => {
    const { data, loading, currentFolder, setCurrentFolder, siderCollapsed, settings } = useGalleryContext();

    const treeData = useMemo(() => {
        if (loading || !data) return [];
        return foldersToTreeData(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, data && JSON.stringify(data.folders)]);

    const handleSelect = useCallback((key: string) => setCurrentFolder(key), [setCurrentFolder]);

    if (siderCollapsed) return null;

    return (
        <div className="gallery-sidebar relative h-full">
            {loading && (
                <div className="absolute inset-0 bg-zinc-900/50 z-[100] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}
            <div className="relative h-full overflow-y-auto p-1">
                {treeData.map(node => (
                    <CustomTreeNode
                        key={node.key}
                        node={node}
                        selectedKey={currentFolder ?? ''}
                        onSelect={handleSelect}
                        defaultExpandAll={settings.expandAllFolders}
                        depth={0}
                    />
                ))}
            </div>
        </div>
    );
};

export default GallerySidebar;
