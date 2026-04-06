import * as React from 'react';

const PortalContext = React.createContext<HTMLElement | null>(null);

export function usePortal(): HTMLElement | null {
    return React.useContext(PortalContext);
}

export const PortalProvider = PortalContext.Provider;
