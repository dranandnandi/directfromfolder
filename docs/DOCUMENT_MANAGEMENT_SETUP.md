# Organization Documents Setup Guide

This guide walks through setting up the organization document management feature.

## 1. Database Migration

Run the SQL migration in Supabase SQL Editor:

```sql
-- Copy contents from: supabase/migrations/20260123_organization_documents.sql
```

## 2. Create Storage Bucket

In Supabase Dashboard → Storage → Create New Bucket:

- **Bucket Name**: `organization-documents`
- **Public bucket**: `false` (private)
- **File size limit**: 50MB

## 3. Storage Policies

In Supabase Dashboard → Storage → `organization-documents` bucket → Policies:

### SELECT Policy (View Files)
```sql
-- Policy name: Users can view their organization's documents
-- Allowed operation: SELECT
-- Policy definition:
(bucket_id = 'organization-documents'::text) AND (
  (storage.foldername(name))[1] IN (
    SELECT organization_id::text FROM public.users WHERE auth_id = auth.uid()
  )
)
```

### INSERT Policy (Upload Files)
```sql
-- Policy name: Admins can upload to their organization folder
-- Allowed operation: INSERT
-- Policy definition:
(bucket_id = 'organization-documents'::text) AND (
  (storage.foldername(name))[1] IN (
    SELECT organization_id::text FROM public.users 
    WHERE auth_id = auth.uid() AND role IN ('admin', 'superadmin')
  )
)
```

### DELETE Policy (Delete Files)
```sql
-- Policy name: Admins can delete from their organization folder
-- Allowed operation: DELETE
-- Policy definition:
(bucket_id = 'organization-documents'::text) AND (
  (storage.foldername(name))[1] IN (
    SELECT organization_id::text FROM public.users 
    WHERE auth_id = auth.uid() AND role IN ('admin', 'superadmin')
  )
)
```

## 4. Folder Structure

Documents are automatically organized:
```
organization-documents/
  {organization_id}/
    general/
      1706000000000_document.pdf
    policies/
      1706000001000_employee_handbook.pdf
    hr/
      1706000002000_leave_policy.pdf
    training/
      ...
```

## 5. Available Categories

- `general` - General documents
- `policies` - Policies & Procedures
- `hr` - HR Documents
- `training` - Training Materials
- `templates` - Templates
- `reports` - Reports
- `compliance` - Compliance documents
- `contracts` - Contracts

## 6. Access Control

| Role | View | Upload | Delete |
|------|------|--------|--------|
| admin | ✅ | ✅ | ✅ |
| superadmin | ✅ | ✅ | ✅ |
| user | ✅ | ❌ | ❌ |

## 7. File Types Supported

- **Documents**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV
- **Images**: JPG, PNG, GIF, WEBP
- **Archives**: ZIP, RAR

Maximum file size: **50MB**

## 8. Accessing the Feature

1. Login as admin/superadmin
2. Go to Admin Dashboard
3. Click "Documents" tab
4. Upload, view, download, or delete documents

## 9. WhatsApp Integration (Future)

The document service can be extended to:
- Send document links via WhatsApp
- Share documents with specific users
- Trigger document notifications

Example integration code:
```typescript
// In WhatsApp backend
import { documentService } from './services/documentService';

// Get document URL to share
const doc = await documentService.getDocument(documentId);
const downloadUrl = await documentService.getDownloadUrl(documentId);

// Send via WhatsApp
await whatsAppService.sendMessage(phoneNumber, 
  `📄 Document: ${doc.original_file_name}\n\nDownload: ${downloadUrl}`
);
```
