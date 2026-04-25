import { Images, Box, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Sidebar, SidebarContent, SidebarMenu,
    SidebarMenuButton, SidebarMenuItem, SidebarRail,
} from '@/components/ui/sidebar';
import { useGalleryContext } from './GalleryContext';
import type { GallerySection } from './GalleryContext';

const SECTIONS: { id: GallerySection; label: string; icon: React.ElementType }[] = [
    { id: 'assets',  label: 'Assets',  icon: Images },
    { id: 'models',  label: 'Models',  icon: Box },
    { id: 'prompts', label: 'Prompts', icon: MessageSquare },
];

/** Icon rail for center layout. SidebarProvider must be an ancestor. */
const GallerySidebar = () => {
    const { gallerySection, setGallerySection, setGroupFilter } = useGalleryContext();

    const handleClick = (id: GallerySection) => {
        // Returning to Assets explicitly clears any group filter (clean slate).
        if (id === 'assets') setGroupFilter('');
        setGallerySection(id);
    };

    return (
        <Sidebar collapsible="icon">
            <SidebarContent>
                <SidebarMenu>
                    {SECTIONS.map(({ id, label, icon: Icon }) => (
                        <SidebarMenuItem key={id}>
                            <SidebarMenuButton
                                isActive={gallerySection === id}
                                tooltip={label}
                                onClick={() => handleClick(id)}
                                onMouseDown={(e) => e.preventDefault()}
                            >
                                <Icon />
                                <span>{label}</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ))}
                </SidebarMenu>
            </SidebarContent>
            <SidebarRail />
        </Sidebar>
    );
};

/** Tab strip for bottom-sheet layout (horizontal, top-aligned). */
export const GallerySidebarTabStrip = () => {
    const { gallerySection, setGallerySection, setGroupFilter } = useGalleryContext();

    const handleClick = (id: GallerySection) => {
        if (id === 'assets') setGroupFilter('');
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
