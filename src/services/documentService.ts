/**
 * Document Service - Handles organization document uploads, retrieval, and deletion
 * 
 * Storage Structure:
 * organization-documents/
 *   {organization_id}/
 *     {category}/
 *       {timestamp}_{sanitized_filename}
 * 
 * Example: organization-documents/abc123/policies/1706000000000_employee_handbook.pdf
 */

import { supabase } from '../utils/supabaseClient';

export interface OrganizationDocument {
  id: string;
  organization_id: string;
  uploaded_by: string;
  file_name: string;
  original_file_name: string;
  file_path: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  category: string;
  description?: string;
  tags: string[];
  is_public: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  // Joined fields
  uploader_name?: string;
}

export interface UploadDocumentParams {
  file: File;
  organizationId: string;
  uploadedBy: string;
  category?: string;
  description?: string;
  tags?: string[];
  isPublic?: boolean;
}

export interface DocumentFilter {
  organizationId: string;
  category?: string;
  searchTerm?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

const BUCKET_NAME = 'organization-documents';

// Allowed file types
const ALLOWED_MIME_TYPES = [
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // Archives (optional)
  'application/zip',
  'application/x-rar-compressed',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Sanitize filename for storage
 */
function sanitizeFileName(fileName: string): string {
  // Remove special characters, keep extension
  const ext = fileName.split('.').pop() || '';
  const name = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
  const sanitized = name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
  return `${sanitized}.${ext}`;
}

export const documentService = {
  /**
   * Upload a document to organization storage
   */
  async uploadDocument(params: UploadDocumentParams): Promise<OrganizationDocument> {
    const {
      file,
      organizationId,
      uploadedBy,
      category = 'general',
      description,
      tags = [],
      isPublic = false
    } = params;

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      throw new Error(`File type not allowed: ${file.type}. Allowed types: PDF, Word, Excel, PowerPoint, images, CSV, TXT`);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Generate unique file name
    const timestamp = Date.now();
    const sanitizedName = sanitizeFileName(file.name);
    const fileName = `${timestamp}_${sanitizedName}`;
    const filePath = `${organizationId}/${category}/${fileName}`;

    console.log(`[DocumentService] Uploading file: ${filePath}`);

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('[DocumentService] Storage upload error:', uploadError);
      throw new Error(`Failed to upload file: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    const fileUrl = urlData.publicUrl;

    // Create database record
    const { data: document, error: dbError } = await supabase
      .from('organization_documents')
      .insert({
        organization_id: organizationId,
        uploaded_by: uploadedBy,
        file_name: fileName,
        original_file_name: file.name,
        file_path: filePath,
        file_url: fileUrl,
        file_size: file.size,
        mime_type: file.type,
        category,
        description,
        tags,
        is_public: isPublic
      })
      .select()
      .single();

    if (dbError) {
      // Rollback: delete uploaded file
      await supabase.storage.from(BUCKET_NAME).remove([filePath]);
      console.error('[DocumentService] Database insert error:', dbError);
      throw new Error(`Failed to save document record: ${dbError.message}`);
    }

    console.log(`[DocumentService] Document uploaded successfully: ${document.id}`);
    return document;
  },

  /**
   * Get documents for an organization with optional filters
   */
  async getDocuments(filter: DocumentFilter): Promise<OrganizationDocument[]> {
    const {
      organizationId,
      category,
      searchTerm,
      tags,
      limit = 50,
      offset = 0
    } = filter;

    let query = supabase
      .from('organization_documents')
      .select(`
        *,
        uploader:users!uploaded_by(name)
      `)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    if (searchTerm) {
      query = query.or(`original_file_name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    }

    if (tags && tags.length > 0) {
      query = query.contains('tags', tags);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[DocumentService] Get documents error:', error);
      throw new Error(`Failed to fetch documents: ${error.message}`);
    }

    // Map uploader name
    return (data || []).map(doc => ({
      ...doc,
      uploader_name: doc.uploader?.name || 'Unknown'
    }));
  },

  /**
   * Get a single document by ID
   */
  async getDocument(documentId: string): Promise<OrganizationDocument | null> {
    const { data, error } = await supabase
      .from('organization_documents')
      .select(`
        *,
        uploader:users!uploaded_by(name)
      `)
      .eq('id', documentId)
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('[DocumentService] Get document error:', error);
      throw new Error(`Failed to fetch document: ${error.message}`);
    }

    return {
      ...data,
      uploader_name: data.uploader?.name || 'Unknown'
    };
  },

  /**
   * Update document metadata
   */
  async updateDocument(
    documentId: string,
    updates: Partial<Pick<OrganizationDocument, 'category' | 'description' | 'tags' | 'is_public'>>
  ): Promise<OrganizationDocument> {
    const { data, error } = await supabase
      .from('organization_documents')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId)
      .select()
      .single();

    if (error) {
      console.error('[DocumentService] Update document error:', error);
      throw new Error(`Failed to update document: ${error.message}`);
    }

    return data;
  },

  /**
   * Soft delete a document (marks as deleted but keeps file)
   */
  async deleteDocument(documentId: string): Promise<void> {
    // Get document to find file path
    const doc = await this.getDocument(documentId);
    if (!doc) {
      throw new Error('Document not found');
    }

    // Soft delete in database
    const { error: dbError } = await supabase
      .from('organization_documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId);

    if (dbError) {
      console.error('[DocumentService] Delete document error:', dbError);
      throw new Error(`Failed to delete document: ${dbError.message}`);
    }

    // Also remove from storage (hard delete the file)
    const { error: storageError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([doc.file_path]);

    if (storageError) {
      console.warn('[DocumentService] Failed to delete file from storage:', storageError);
      // Don't throw - database record is already soft deleted
    }

    console.log(`[DocumentService] Document deleted: ${documentId}`);
  },

  /**
   * Permanently delete a document (use with caution)
   */
  async permanentlyDeleteDocument(documentId: string): Promise<void> {
    // Get document including soft-deleted
    const { data: doc, error: fetchError } = await supabase
      .from('organization_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (fetchError || !doc) {
      throw new Error('Document not found');
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([doc.file_path]);

    if (storageError) {
      console.warn('[DocumentService] Storage delete error:', storageError);
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('organization_documents')
      .delete()
      .eq('id', documentId);

    if (dbError) {
      throw new Error(`Failed to permanently delete: ${dbError.message}`);
    }
  },

  /**
   * Get download URL for a document (signed URL for private files)
   */
  async getDownloadUrl(documentId: string): Promise<string> {
    const doc = await this.getDocument(documentId);
    if (!doc) {
      throw new Error('Document not found');
    }

    // For public files, return the public URL
    if (doc.is_public) {
      return doc.file_url;
    }

    // For private files, create a signed URL (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(doc.file_path, 3600);

    if (error) {
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }

    return data.signedUrl;
  },

  /**
   * Get available categories for an organization
   */
  async getCategories(organizationId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('organization_documents')
      .select('category')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);

    if (error) {
      console.error('[DocumentService] Get categories error:', error);
      return ['general'];
    }

    const categories = [...new Set(data.map(d => d.category))];
    return categories.length > 0 ? categories : ['general'];
  },

  /**
   * Get document statistics for an organization
   */
  async getDocumentStats(organizationId: string): Promise<{
    totalDocuments: number;
    totalSize: number;
    byCategory: Record<string, number>;
  }> {
    const { data, error } = await supabase
      .from('organization_documents')
      .select('category, file_size')
      .eq('organization_id', organizationId)
      .is('deleted_at', null);

    if (error) {
      throw new Error(`Failed to get stats: ${error.message}`);
    }

    const stats = {
      totalDocuments: data.length,
      totalSize: data.reduce((sum, doc) => sum + doc.file_size, 0),
      byCategory: {} as Record<string, number>
    };

    data.forEach(doc => {
      stats.byCategory[doc.category] = (stats.byCategory[doc.category] || 0) + 1;
    });

    return stats;
  }
};

// Default categories for UI
export const DEFAULT_DOCUMENT_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'policies', label: 'Policies & Procedures' },
  { value: 'hr', label: 'HR Documents' },
  { value: 'training', label: 'Training Materials' },
  { value: 'templates', label: 'Templates' },
  { value: 'reports', label: 'Reports' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'contracts', label: 'Contracts' },
];

// File type icons mapping
export const FILE_TYPE_ICONS: Record<string, string> = {
  'application/pdf': '📄',
  'application/msword': '📝',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'application/vnd.ms-excel': '📊',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.ms-powerpoint': '📽️',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📽️',
  'text/plain': '📃',
  'text/csv': '📊',
  'image/jpeg': '🖼️',
  'image/png': '🖼️',
  'image/gif': '🖼️',
  'image/webp': '🖼️',
  'application/zip': '📦',
  'default': '📎'
};

export function getFileIcon(mimeType: string): string {
  return FILE_TYPE_ICONS[mimeType] || FILE_TYPE_ICONS['default'];
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
