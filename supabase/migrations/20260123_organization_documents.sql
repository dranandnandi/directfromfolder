-- Organization Documents Table
-- Stores metadata for documents uploaded per organization
-- Actual files stored in Supabase Storage bucket: organization-documents

CREATE TABLE IF NOT EXISTS public.organization_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  file_name text NOT NULL,
  original_file_name text NOT NULL,
  file_path text NOT NULL,
  file_url text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL,
  category text DEFAULT 'general',
  description text,
  tags text[] DEFAULT '{}',
  is_public boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone, -- Soft delete
  CONSTRAINT organization_documents_pkey PRIMARY KEY (id),
  CONSTRAINT organization_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id)
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_org_documents_organization_id ON public.organization_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_documents_uploaded_by ON public.organization_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_org_documents_category ON public.organization_documents(category);
CREATE INDEX IF NOT EXISTS idx_org_documents_created_at ON public.organization_documents(created_at DESC);

-- RLS Policies
ALTER TABLE public.organization_documents ENABLE ROW LEVEL SECURITY;

-- Users can view documents from their organization
CREATE POLICY "Users can view their organization's documents"
  ON public.organization_documents
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.users WHERE auth_id = auth.uid()
    )
  );

-- Only admins can insert documents
CREATE POLICY "Admins can upload documents"
  ON public.organization_documents
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE auth_id = auth.uid() 
      AND organization_id = organization_documents.organization_id
      AND role IN ('admin', 'superadmin')
    )
  );

-- Only admins can update documents
CREATE POLICY "Admins can update documents"
  ON public.organization_documents
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE auth_id = auth.uid() 
      AND organization_id = organization_documents.organization_id
      AND role IN ('admin', 'superadmin')
    )
  );

-- Only admins can delete documents
CREATE POLICY "Admins can delete documents"
  ON public.organization_documents
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE auth_id = auth.uid() 
      AND organization_id = organization_documents.organization_id
      AND role IN ('admin', 'superadmin')
    )
  );

-- Create storage bucket for organization documents (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('organization-documents', 'organization-documents', false);

-- Storage policies for organization-documents bucket
-- These need to be created in Supabase Dashboard > Storage > Policies

-- Policy: Users can view files from their organization
-- SELECT: organization_documents/{organization_id}/*

-- Policy: Admins can upload files to their organization folder
-- INSERT: organization_documents/{organization_id}/*

-- Policy: Admins can delete files from their organization folder
-- DELETE: organization_documents/{organization_id}/*

COMMENT ON TABLE public.organization_documents IS 'Stores metadata for organization documents. Files stored in organization-documents bucket with path: {org_id}/{category}/{filename}';
