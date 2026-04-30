import { Images, Box, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Sidebar, SidebarContent, SidebarRail,
    useSidebar,
} from '@/components/ui/sidebar';
import {
    Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { useGalleryContext } from './GalleryContext';
import type { GallerySection } from './GalleryContext';

const SECTIONS: { id: GallerySection; label: string; icon: React.ElementType }[] = [
    { id: 'assets',  label: 'Assets',  icon: Images },
    { id: 'models',  label: 'Models',  icon: Box },
    { id: 'prompts', label: 'Prompts', icon: MessageSquare },
];

/** Inner nav — rendered after SidebarProvider context is available. */
const SidebarNav = () => {
    const { gallerySection, setGallerySection } = useGalleryContext();
    const { state } = useSidebar();
    const collapsed = state === 'collapsed';

    const handleClick = (id: GallerySection) => {
        setGallerySection(id);
    };

    return (
        <div className="flex flex-col gap-1 p-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
                const isActive = gallerySection === id;
                const btn = (
                    <button
                        key={id}
                        onClick={() => handleClick(id)}
                        onMouseDown={(e) => e.preventDefault()}
                        className={cn(
                            "flex items-center gap-2 rounded-md transition-colors duration-150",
                            "text-sm font-medium",
                            collapsed ? "w-8 h-8 justify-center p-0" : "w-full px-2 py-1.5",
                            isActive
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
                        )}
                    >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{label}</span>}
                    </button>
                );

                if (!collapsed) return btn;

                return (
                    <Tooltip key={id}>
                        <TooltipTrigger asChild>{btn}</TooltipTrigger>
                        <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                );
            })}
        </div>
    );
};

/** Icon rail for center layout. SidebarProvider must be an ancestor. */
const GallerySidebar = () => (
    <Sidebar collapsible="icon">
        <SidebarContent>
            <SidebarNav />
        </SidebarContent>
        <SidebarRail />
    </Sidebar>
);

/** Tab strip for bottom-sheet layout (horizontal, top-aligned). */
export const GallerySidebarTabStrip = () => {
    const { gallerySection, setGallerySection } = useGalleryContext();

    const handleClick = (id: GallerySection) => {
        setGallerySection(id);
    };

    return (
        <div className="flex items-center gap-1 border-b px-2 shrink-0">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
                <button
                    key={id}
                    onClick={() => handleClick(id)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
                        "border-b-2 -mb-px",
                        gallerySection === id
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                </button>
            ))}
        </div>
    );
};

export default GallerySidebar;
