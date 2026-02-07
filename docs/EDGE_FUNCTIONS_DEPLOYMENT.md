# User Management Edge Functions - Deployment Guide

## 📋 Overview

The user management system uses Supabase Edge Functions to securely handle user creation, updates, and deletion. These functions run on the backend with service role permissions, ensuring security and proper authentication.

---

## 🔧 Edge Functions

### 1. **create-user**
- **Path:** `supabase/functions/create-user/index.ts`
- **Purpose:** Create a new user with both `auth.users` and `public.users` entries
- **Permissions:** Requires admin role
- **Validates:**
  - User is authenticated
  - User has admin/superadmin role
  - User is creating in their own organization
  - Email format
  - Password length (min 6 characters)
  - WhatsApp number (10 digits)

### 2. **update-user**
- **Path:** `supabase/functions/update-user/index.ts`
- **Purpose:** Update user profile information
- **Permissions:** Requires admin role
- **Validates:**
  - User is authenticated
  - User has admin/superadmin role
  - Target user is in same organization

### 3. **delete-user**
- **Path:** `supabase/functions/delete-user/index.ts`
- **Purpose:** Delete user from both auth and database
- **Permissions:** Requires admin role
- **Validates:**
  - User is authenticated
  - User has admin/superadmin role
  - Target user is in same organization
  - Cannot delete yourself

---

## 🚀 Deployment

### Prerequisites
1. Supabase CLI installed: `npm install -g supabase`
2. Logged into Supabase: `supabase login`
3. Linked to your project: `supabase link --project-ref your-project-ref`

### Deploy All Functions

**Linux/Mac:**
```bash
chmod +x deploy-user-functions.sh
./deploy-user-functions.sh
```

**Windows PowerShell:**
```powershell
.\deploy-user-functions.ps1
```

### Deploy Individual Functions

```bash
# Create User
supabase functions deploy create-user --no-verify-jwt

# Update User
supabase functions deploy update-user --no-verify-jwt

# Delete User
supabase functions deploy delete-user --no-verify-jwt
```

---

## 🔐 Environment Variables

Set these in your Supabase Dashboard under **Edge Functions > Settings**:

| Variable | Description | Where to Find |
|----------|-------------|---------------|
| `SUPABASE_URL` | Your project URL | Project Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (secret) | Project Settings > API > service_role key |
| `SUPABASE_ANON_KEY` | Anon public key | Project Settings > API > anon key |

**Note:** These are automatically available in edge functions, but verify they're set correctly.

---

## 📡 API Endpoints

### Base URL
```
https://your-project-ref.supabase.co/functions/v1
```

### 1. Create User

**Endpoint:** `POST /create-user`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "name": "John Doe",
  "whatsappNumber": "9876543210",
  "phone": "9876543210",
  "role": "user",
  "department": "Medical",
  "organizationId": "uuid-here"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "auth_id": "uuid",
    "organization_id": "uuid",
    "name": "John Doe",
    "email": "user@example.com",
    "whatsapp_number": "+919876543210",
    "phone": "9876543210",
    "role": "user",
    "department": "Medical",
    "created_at": "2026-01-02T10:30:00Z",
    "updated_at": "2026-01-02T10:30:00Z"
  },
  "message": "User created successfully"
}
```

**Error Response (400/401/403/500):**
```json
{
  "success": false,
  "error": "Error message here"
}
```

---

### 2. Update User

**Endpoint:** `POST /update-user`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "userId": "uuid-here",
  "name": "John Smith",
  "whatsappNumber": "9876543210",
  "phone": "9876543210",
  "department": "Management",
  "role": "admin"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "auth_id": "uuid",
    "organization_id": "uuid",
    "name": "John Smith",
    "email": "user@example.com",
    "whatsapp_number": "+919876543210",
    "phone": "9876543210",
    "role": "admin",
    "department": "Management",
    "created_at": "2026-01-02T10:30:00Z",
    "updated_at": "2026-01-02T11:45:00Z"
  },
  "message": "User updated successfully"
}
```

---

### 3. Delete User

**Endpoint:** `POST /delete-user`

**Headers:**
```
Authorization: Bearer <user-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "userId": "uuid-here"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

---

## 🧪 Testing

### Using cURL

**Create User:**
```bash
curl -X POST https://your-project.supabase.co/functions/v1/create-user \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123",
    "name": "Test User",
    "whatsappNumber": "9876543210",
    "role": "user",
    "department": "Medical",
    "organizationId": "your-org-id"
  }'
```

**Update User:**
```bash
curl -X POST https://your-project.supabase.co/functions/v1/update-user \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-id-here",
    "name": "Updated Name",
    "role": "admin"
  }'
```

**Delete User:**
```bash
curl -X POST https://your-project.supabase.co/functions/v1/delete-user \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-id-here"
  }'
```

---

## 🛡️ Security Features

### 1. **Authentication Required**
- All endpoints require valid JWT token
- Token verified via Supabase Auth

### 2. **Role-Based Authorization**
- Only admins and superadmins can manage users
- Checked on every request

### 3. **Organization Isolation**
- Admins can only manage users in their organization
- Cross-organization operations blocked

### 4. **Self-Protection**
- Users cannot delete themselves
- Prevents accidental account loss

### 5. **Input Validation**
- Email format validation
- Password strength (min 6 chars)
- Phone number format (10 digits)
- Required field checks

### 6. **Error Handling**
- Automatic cleanup on failures
- If profile creation fails, auth user is deleted
- Prevents orphaned records

---

## 🔍 Troubleshooting

### Function Not Found (404)
```bash
# Redeploy the function
supabase functions deploy create-user --no-verify-jwt
```

### Unauthorized (401)
- Check if JWT token is valid
- Verify user is logged in
- Token might be expired

### Forbidden (403)
- User doesn't have admin role
- Trying to access different organization
- Check user permissions in database

### Internal Server Error (500)
- Check function logs in Supabase Dashboard
- Verify environment variables are set
- Check for database connectivity issues

### View Logs
```bash
# Real-time logs
supabase functions serve create-user

# Dashboard logs
# Go to Supabase Dashboard > Edge Functions > Logs
```

---

## 📊 Flow Diagram

```
Frontend (authService.ts)
        │
        │ Calls supabase.functions.invoke()
        │ with JWT token
        ↓
Edge Function (Deno Runtime)
        │
        ├─→ 1. Verify JWT token
        ├─→ 2. Check admin role
        ├─→ 3. Validate organization
        ├─→ 4. Validate input
        │
        ├─→ 5a. Create auth user (service role)
        └─→ 5b. Create profile in public.users
        │
        ├─→ Success: Return user data
        └─→ Error: Cleanup & return error
```

---

## 📝 Notes

1. **Service Role Key:** Never expose this in frontend code. It's only used in edge functions.

2. **CORS:** Functions are configured to accept requests from any origin (`*`). Adjust `corsHeaders` if needed.

3. **Error Messages:** Functions return descriptive error messages for debugging. Consider sanitizing in production.

4. **Rate Limiting:** Consider adding rate limiting for production use.

5. **Logging:** Functions log detailed information. Review logs regularly.

---

**Last Updated:** January 2, 2026  
**Status:** Production Ready 🚀
