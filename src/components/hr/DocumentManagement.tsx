/**
 * DocumentManagement Component
 * 
 * Admin-only page for managing organization documents.
 * Supports upload, view, download, and delete operations.
 * Documents are stored in Supabase Storage with organization-based folders.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  HiUpload,
  HiDownload,
  HiTrash,
  HiSearch,
  HiFolder,
  HiDocumentText,
  HiEye,
  HiX,
  HiRefresh,
  HiChevronDown,
  HiCheck,
  HiExclamationCircle,
  HiInformationCircle
} from 'react-icons/hi';
import {
  documentService,
  OrganizationDocument,
  DEFAULT_DOCUMENT_CATEGORIES,
  getFileIcon,
  formatFileSize
} from '../../services/documentService';

interface DocumentManagementProps {
  organizationId: string;
  userId: string;
  userName?: string;
}

const DocumentManagement: React.FC<DocumentManagementProps> = ({
  organizationId,
  userId,
  userName
}) => {
  // State
  const [documents, setDocuments] = useState<OrganizationDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [stats, setStats] = useState<{ totalDocuments: number; totalSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Uploader name for display
  const uploaderName = userName || 'Admin';
  
  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState('general');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  
  // Preview modal state
  const [previewDoc, setPreviewDoc] = useState<OrganizationDocument | null>(null);
  
  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [docs, docStats] = await Promise.all([
        documentService.getDocuments({
          organizationId,
          category: selectedCategory !== 'all' ? selectedCategory : undefined,
          searchTerm: searchTerm || undefined
        }),
        documentService.getDocumentStats(organizationId)
      ]);
      
      setDocuments(docs);
      setStats(docStats);
    } catch (err: any) {
      console.error('Error fetching documents:', err);
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [organizationId, selectedCategory, searchTerm]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setShowUploadModal(true);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle upload
  const handleUpload = async () => {
    if (!uploadFile) return;
    
    try {
      setUploading(true);
      setError(null);
      
      await documentService.uploadDocument({
        file: uploadFile,
        organizationId,
        uploadedBy: userId,
        category: uploadCategory,
        description: uploadDescription || undefined,
        tags: uploadTags ? uploadTags.split(',').map(t => t.trim()).filter(Boolean) : []
      });
      
      setSuccess(`Document uploaded successfully by ${uploaderName}!`);
      setShowUploadModal(false);
      resetUploadForm();
      fetchDocuments();
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadCategory('general');
    setUploadDescription('');
    setUploadTags('');
  };

  // Handle download
  const handleDownload = async (doc: OrganizationDocument) => {
    try {
      const url = await documentService.getDownloadUrl(doc.id);
      window.open(url, '_blank');
    } catch (err: any) {
      setError(err.message || 'Failed to download document');
    }
  };

  // Handle delete
  const handleDelete = async (docId: string) => {
    try {
      setError(null);
      await documentService.deleteDocument(docId);
      setSuccess('Document deleted successfully!');
      setDeleteConfirm(null);
      fetchDocuments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete document');
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Can preview file type
  const canPreview = (mimeType: string) => {
    return mimeType.startsWith('image/') || mimeType === 'application/pdf';
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <HiFolder className="text-blue-500" />
            Document Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Upload and manage organization documents
          </p>
        </div>
        
        {stats && (
          <div className="flex items-center gap-4 text-sm">
            <div className="bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg">
              <span className="text-blue-600 dark:text-blue-400 font-medium">
                {stats.totalDocuments} Documents
              </span>
            </div>
            <div className="bg-green-50 dark:bg-green-900/30 px-3 py-2 rounded-lg">
              <span className="text-green-600 dark:text-green-400 font-medium">
                {formatFileSize(stats.totalSize)} Used
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <HiExclamationCircle className="text-red-500 text-xl flex-shrink-0" />
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
            <HiX />
          </button>
        </div>
      )}
      
      {success && (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-center gap-3">
          <HiCheck className="text-green-500 text-xl flex-shrink-0" />
          <p className="text-green-700 dark:text-green-300">{success}</p>
        </div>
      )}

      {/* Actions Bar */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* Upload Button */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp,.zip,.rar"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
        >
          <HiUpload className="text-lg" />
          Upload Document
        </button>
        
        {/* Search */}
        <div className="flex-1 relative">
          <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        
        {/* Category Filter */}
        <div className="relative">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="appearance-none pl-4 pr-10 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
          >
            <option value="all">All Categories</option>
            {DEFAULT_DOCUMENT_CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
          <HiChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        
        {/* Refresh */}
        <button
          onClick={fetchDocuments}
          disabled={loading}
          className="p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <HiRefresh className={`text-xl text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Documents Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <HiDocumentText className="mx-auto text-5xl text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No documents found
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {searchTerm || selectedCategory !== 'all'
              ? 'Try adjusting your search or filter'
              : 'Upload your first document to get started'}
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <HiUpload />
            Upload Document
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {documents.map(doc => (
            <div
              key={doc.id}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              {/* File Icon & Name */}
              <div className="flex items-start gap-3 mb-3">
                <span className="text-3xl">{getFileIcon(doc.mime_type)}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-white truncate" title={doc.original_file_name}>
                    {doc.original_file_name}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {formatFileSize(doc.file_size)}
                  </p>
                </div>
              </div>
              
              {/* Category Badge */}
              <div className="mb-3">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                  {doc.category}
                </span>
              </div>
              
              {/* Description */}
              {doc.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                  {doc.description}
                </p>
              )}
              
              {/* Meta */}
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                <p>Uploaded by {doc.uploader_name}</p>
                <p>{formatDate(doc.created_at)}</p>
              </div>
              
              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                {canPreview(doc.mime_type) && (
                  <button
                    onClick={() => setPreviewDoc(doc)}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                  >
                    <HiEye />
                    Preview
                  </button>
                )}
                <button
                  onClick={() => handleDownload(doc)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded transition-colors"
                >
                  <HiDownload />
                  Download
                </button>
                <button
                  onClick={() => setDeleteConfirm(doc.id)}
                  className="flex items-center justify-center p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                >
                  <HiTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && uploadFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Upload Document
                </h2>
                <button
                  onClick={() => { setShowUploadModal(false); resetUploadForm(); }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <HiX className="text-xl" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {/* File Info */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <span className="text-2xl">{getFileIcon(uploadFile.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">
                    {uploadFile.name}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {formatFileSize(uploadFile.size)}
                  </p>
                </div>
              </div>
              
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Category
                </label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                >
                  {DEFAULT_DOCUMENT_CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>
              
              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  rows={2}
                  placeholder="Brief description of the document..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              
              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Tags (optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="e.g., policy, 2026, important"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => { setShowUploadModal(false); resetUploadForm(); }}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
              >
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Uploading...
                  </>
                ) : (
                  <>
                    <HiUpload />
                    Upload
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                {previewDoc.original_file_name}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(previewDoc)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded transition-colors"
                >
                  <HiDownload />
                  Download
                </button>
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <HiX className="text-xl" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-gray-100 dark:bg-gray-900">
              {previewDoc.mime_type === 'application/pdf' ? (
                <iframe
                  src={previewDoc.file_url}
                  className="w-full h-full min-h-[60vh] rounded-lg"
                  title={previewDoc.original_file_name}
                />
              ) : previewDoc.mime_type.startsWith('image/') ? (
                <div className="flex items-center justify-center h-full">
                  <img
                    src={previewDoc.file_url}
                    alt={previewDoc.original_file_name}
                    className="max-w-full max-h-[70vh] object-contain rounded-lg"
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  Preview not available for this file type
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <HiTrash className="text-xl text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Delete Document
              </h2>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Are you sure you want to delete this document? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Note */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex items-start gap-3">
        <HiInformationCircle className="text-blue-500 text-xl flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 dark:text-blue-300">
          <p className="font-medium mb-1">Document Storage</p>
          <p>
            Documents are stored securely in your organization's folder. Only admins can upload and delete documents.
            All team members can view and download documents.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DocumentManagement;
