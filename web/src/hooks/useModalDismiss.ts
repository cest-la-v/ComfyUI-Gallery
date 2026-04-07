/**
 * Encapsulates the explicit modal-dismiss pattern for gallery dialogs.
 *
 * WHY THIS EXISTS:
 * Radix Dialog auto-dismisses on any pointer-down outside DialogContent
 * (`onInteractOutside`) and on Escape (`onEscapeKeyDown`). Both fire before
 * the triggering element's own click handler runs.
 *
 * Gallery dialogs use portals for toolbar buttons / MetadataPanel — these are
 * DOM-outside DialogContent even though they're visually inside the modal.
 * Auto-dismiss would close the modal before toolbar button clicks could fire.
 *
 * PATTERN:
 * - `onInteractOutside`: always prevented (never auto-dismiss from outside click)
 * - `onEscapeKeyDown`: close explicitly, unless `disabled` (e.g. child modal open)
 * - `onOverlayClick`: close via backdrop click, unless `disabled`
 *
 * When `disabled`, Escape is also prevented so a parent modal doesn't close
 * while a child modal (e.g. settings) is open.
 */
export function useModalDismiss(
    onClose: () => void,
    options?: { disabled?: boolean },
) {
    return {
        onInteractOutside: (e: Event) => {
            e.preventDefault();
        },
        onEscapeKeyDown: (e: KeyboardEvent) => {
            if (options?.disabled) {
                e.preventDefault();
                return;
            }
            onClose();
        },
        onOverlayClick: () => {
            if (!options?.disabled) onClose();
        },
    };
}
