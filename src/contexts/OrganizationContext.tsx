import { createContext, useContext, ReactNode } from 'react';

export interface OrganizationContextType {
  organizationId: string;
  organizationName?: string;
}

const OrganizationContext = createContext<OrganizationContextType | null>(null);

export interface OrganizationProviderProps {
  children: ReactNode;
  organizationId: string;
  organizationName?: string;
}

export function OrganizationProvider({ children, organizationId, organizationName }: OrganizationProviderProps) {
  return (
    <OrganizationContext.Provider value={{ organizationId, organizationName }}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextType {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}