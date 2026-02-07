# Organization-Based User Management System - Architecture Documentation

## 📋 Overview

This document explains the **organization-based user management system** in the Task Manager application, where:
- **Admin users** can create new users for their organization
- Users are automatically scoped to their organization (organization-based isolation)
- Backend creates entries in both **`auth.users`** (Supabase Auth) and **`public.users`** (Application data)
- Role-based access control (RBAC) with admin permissions

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Management Flow                         │
└─────────────────────────────────────────────────────────────────┘

Admin UI (React)
    │
    ├── UserManagement.tsx (Frontend Component)
    │   └── Collects: email, password, name, role, organization, etc.
    │
    ↓
authService.createUser() (Service Layer)
    │
    ├── 1. Calls Supabase Auth Admin API
    │   └── supabase.auth.admin.createUser({ email, password })
    │       └── Creates entry in auth.users table ✅
    │
    ├── 2. Calls authService.createProfile()
    │   └── INSERT into public.users table
    │       ├── Links to auth.users via auth_id (FK)
    │       ├── Stores organization_id (multi-tenancy)
    │       ├── Stores role (RBAC)
    │       └── Stores contact information ✅
    │
    ↓
Database Tables Updated
    │
    ├── auth.users (Supabase Auth Schema)
    │   └── Stores: id, email, encrypted_password, email_confirmed_at
    │
    └── public.users (Application Schema)
        └── Stores: id, auth_id, organization_id, name, role, etc.
```

---

## 🔑 Key Components

### 1. **Frontend: UserManagement.tsx**

**Location:** `src/components/UserManagement.tsx`

**Purpose:** Admin interface for creating and managing users

**Key Features:**
- **Permission-gated:** Only users with `admin` or `superadmin` role can access
- **Create/Edit/Delete** users
- **Role assignment** (user, admin, superadmin)
- **Organization scoping:** Automatically assigns current user's `organization_id` to new users
- **Comprehensive form validation:** Email, password, phone number validation
- **Real-time statistics:** Total users, admins, departments

**Code Snippet:**
```typescript
const handleSaveUser = async () => {
  if (!validateForm()) return;

  if (selectedUser) {
    // Update existing user
    await authService.updateProfile(selectedUser.id, {...});
  } else {
    // Create new user
    await authService.createUser({
      ...formData,
      name: toTitleCase(formData.name),
      organizationId: organizationId  // ← Automatic organization scoping
    });
  }
}
```

---

### 2. **Backend: authService.createUser()**

**Location:** `src/services/authService.ts`

**Flow:**
```typescript
async createUser(userData: CreateUserData) {
  // Step 1: Create auth user via Supabase Auth Admin API
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: userData.email,
    password: userData.password,
    email_confirm: true // Auto-confirm email
  });

  // Step 2: Create profile in public.users table
  return await createProfile(authData.user.id, {
    organizationId: userData.organizationId,  // ← Multi-tenancy key
    name: userData.name,
    email: userData.email,
    whatsappNumber: userData.whatsappNumber,
    role: userData.role,
    department: userData.department
  });
}
```

**What Happens:**

1. **`supabase.auth.admin.createUser()`** → Creates entry in **`auth.users`** table
   - Stores authentication credentials (email, hashed password)
   - Returns `user.id` (UUID)
   - Email is auto-confirmed (`email_confirm: true`)

2. **`createProfile()`** → Creates entry in **`public.users`** table
   - Links to `auth.users` via `auth_id` foreign key
   - Stores application-specific data (name, role, organization, etc.)
   - Handles cleanup if profile creation fails (deletes auth user)

---

### 3. **Backend: authService.createProfile()**

**Location:** `src/services/authService.ts`

**Purpose:** Create application profile linked to auth user

**Code:**
```typescript
async function createProfile(authUserId: string, profileData) {
  // Prepare database record (camelCase → snake_case)
  const dbProfile = {
    auth_id: authUserId,              // Link to auth.users
    organization_id: profileData.organizationId,  // ← Multi-tenancy
    name: toTitleCase(profileData.name),
    email: profileData.email,
    whatsapp_number: profileData.whatsappNumber.startsWith('+91') 
      ? profileData.whatsappNumber 
      : `+91${profileData.whatsappNumber}`,
    phone: profileData.phone,
    role: profileData.role,
    department: profileData.department,
    onboarding_state: 'completed' // Admin-created users are pre-onboarded
  };

  // Insert into users table with error handling
  const { data, error } = await supabase
    .from('users')
    .insert([dbProfile])
    .select('*')
    .single();

  if (error) {
    // Cleanup: Delete auth user if profile creation fails
    await supabase.auth.admin.deleteUser(authUserId);
    throw error;
  }

  return convertDatabaseProfile(data);
}
```

**Database Mapping:**
| Frontend (camelCase) | Database (snake_case) |
|----------------------|-----------------------|
| `authUserId` | `auth_id` |
| `organizationId` | `organization_id` |
| `whatsappNumber` | `whatsapp_number` |
| `onboardingState` | `onboarding_state` |

---

## 🗄️ Database Schema

### **auth.users** (Supabase Auth Schema)
```sql
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  encrypted_password TEXT NOT NULL,
  email_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
  -- ... other Supabase-managed fields
);
```

### **public.users** (Application Schema)
```sql
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  
  -- User Information
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  whatsapp_number TEXT NOT NULL,
  phone TEXT,
  
  -- Role Information
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'user')),
  department TEXT NOT NULL,
  
  -- Status
  onboarding_state TEXT DEFAULT 'new' CHECK (onboarding_state IN ('new', 'invited', 'completed')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX idx_users_auth_id ON public.users(auth_id);
CREATE INDEX idx_users_organization_id ON public.users(organization_id);
CREATE INDEX idx_users_email ON public.users(email);
```

---

## 🔐 Multi-Tenancy (Organization-Based Isolation)

### **How It Works:**

1. **Organization Scoping:** Every user belongs to **one organization** (`organization_id`)
2. **RLS Policies:** Row-Level Security ensures users only see data from their organization
3. **Automatic Assignment:** When admin creates a user, `organization_id` is auto-assigned

**Example RLS Policy:**
```sql
CREATE POLICY "users_read_org"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.users 
      WHERE auth_id = auth.uid()
    )
  );

CREATE POLICY "admins_create_users"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users admin
      WHERE admin.auth_id = auth.uid()
      AND admin.role IN ('admin', 'superadmin')
      AND admin.organization_id = organization_id
    )
  );
```

**Effect:** 
- Organization A's admin can only see/manage users from Organization A
- Organization B's admin can only see/manage users from Organization B
- Data isolation at database level ✅

---

## 🎭 Role-Based Access Control (RBAC)

### **User Roles:**

| Role | Description | Permissions |
|------|-------------|-------------|
| **superadmin** | System administrator | Full system access, can create other superadmins |
| **admin** | Organization administrator | User management, organization settings, can create users and admins |
| **user** | Regular user | Standard task management, no admin access |

### **Permission Check:**
```typescript
// In UserManagement component
const { data: userData } = await supabase
  .from('users')
  .select('role')
  .eq('auth_id', session.user.id)
  .single();

// Check if user has admin permissions
if (!['admin', 'superadmin'].includes(userData.role)) {
  throw new Error('You do not have permission to access user management');
}
```

---

## 🔄 Complete User Creation Flow

### **Step-by-Step:**

```
1. Admin opens "User Management"
   └── UserManagement.tsx renders
   └── Checks permission: role IN ('admin', 'superadmin')

2. Admin clicks "Add User"
   └── Modal opens with form

3. Admin fills form:
   ├── Name: "John Doe"
   ├── Email: "john@example.com"
   ├── Password: "SecurePass123"
   ├── WhatsApp: "9876543210"
   ├── Phone: "9876543210" (optional)
   ├── Role: "user"
   └── Department: "Medical"

4. Admin clicks "Create User"
   └── handleSaveUser() triggered
   └── Form validation runs

5. Frontend Service Call:
   authService.createUser({
     email: "john@example.com",
     password: "SecurePass123",
     name: "John Doe",
     whatsappNumber: "9876543210",
     phone: "9876543210",
     role: "user",
     department: "Medical",
     organizationId: "uuid-org-a"  // Auto-assigned
   })

6. Backend Step 1: Create Auth User
   supabase.auth.admin.createUser({
     email: "john@example.com",
     password: "SecurePass123",
     email_confirm: true
   })
   └── ✅ Entry created in auth.users
   └── Returns: { user: { id: "new-uuid-123" } }

7. Backend Step 2: Create Profile
   createProfile("new-uuid-123", {
     organizationId: "uuid-org-a",
     name: "John Doe",
     email: "john@example.com",
     whatsappNumber: "9876543210",
     role: "user",
     department: "Medical"
   })
   └── ✅ Entry created in public.users
   └── Returns: UserProfile object

8. UI Updates:
   └── Success message: "User created successfully!"
   └── User list refreshes
   └── John Doe appears in list
```

---

## 🛡️ Security Features

### 1. **Permission-Based Access**
```typescript
// Only admins can access user management
if (!['admin', 'superadmin'].includes(userData.role)) {
  throw new Error('You do not have permission');
}
```

### 2. **Organization Isolation**
```typescript
// Automatic organization scoping
organizationId: user?.organizationId  // Current user's org only
```

### 3. **RLS Policies**
- Database-level enforcement
- Prevents cross-organization data access
- Applies to all queries automatically

### 4. **Password Requirements**
- Minimum 6 characters (enforced by Supabase)
- Stored encrypted in `auth.users`
- Never returned to frontend

### 5. **Email Validation**
```typescript
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(formData.email)) {
  setFormError('Please enter a valid email address');
}
```

### 6. **Error Handling with Cleanup**
```typescript
// If profile creation fails, cleanup auth user
if (error) {
  await supabase.auth.admin.deleteUser(authUserId);
  throw error;
}
```

---

## 📊 Data Flow Diagram

```
┌─────────────────┐
│  Admin Browser  │
└────────┬────────┘
         │ 1. Submit form
         ↓
┌─────────────────────────────┐
│  UserManagement.tsx         │
│  - Validates input          │
│  - Formats data             │
│  - Adds organizationId      │
└────────┬────────────────────┘
         │ 2. createUser()
         ↓
┌─────────────────────────────┐
│  authService.ts             │
│  - createUser()             │
│  - createProfile()          │
└────┬────────────────┬───────┘
     │ 3a. admin.     │ 3b. INSERT
     │ createUser()   │
     ↓                ↓
┌────────────┐  ┌──────────────┐
│ auth.users │  │ public.users │
│  (Supabase │  │ (Application │
│    Auth)   │  │     Data)    │
└────────────┘  └──────────────┘
     │                │
     └────────┬───────┘
              │ 4. Return Profile
              ↓
     ┌─────────────────┐
     │  Admin Browser  │
     │  - Success msg  │
     │  - Refresh list │
     └─────────────────┘
```

---

## 🚀 Key Advantages

1. **✅ Automatic Sync:** `auth.users` and `public.users` stay in sync
2. **✅ Multi-Tenancy:** Organization-based isolation at database level
3. **✅ RBAC:** Role-based permissions for fine-grained access control
4. **✅ Clean Architecture:** Separation of auth vs. application data
5. **✅ Error Handling:** Automatic cleanup on failures
6. **✅ Security:** RLS policies + permission checks + password encryption
7. **✅ Maintainable:** Service layer pattern for business logic

---

## 🔧 API Reference

### **authService.createUser()**
```typescript
createUser(userData: CreateUserData): Promise<UserProfile>

interface CreateUserData {
  email: string;
  password: string;
  name: string;
  whatsappNumber: string;
  role: 'user' | 'admin' | 'superadmin';
  department: string;
  organizationId: string;
  phone?: string;
}
```

### **authService.updateProfile()**
```typescript
updateProfile(userId: string, updates: UpdateProfileData): Promise<UserProfile>

interface UpdateProfileData {
  name?: string;
  whatsappNumber?: string;
  department?: string;
  role?: string;
  phone?: string;
}
```

### **authService.deleteUser()**
```typescript
deleteUser(userId: string): Promise<void>
```

### **authService.getOrganizationUsers()**
```typescript
getOrganizationUsers(organizationId: string): Promise<UserProfile[]>
```

### **authService.resetUserPassword()**
```typescript
resetUserPassword(authUserId: string, newPassword: string): Promise<void>
```

---

## 🔄 Migration from Current System

### **Current System:**
- Manual user creation in `public.users` only
- No `auth.users` link
- Limited validation
- No cleanup on errors

### **New System:**
- ✅ Automatic `auth.users` + `public.users` creation
- ✅ Linked via `auth_id` FK
- ✅ Comprehensive validation
- ✅ Error handling with cleanup
- ✅ Service layer architecture
- ✅ Admin-only access control

---

## 📝 Usage Examples

### **Creating a User:**
```typescript
import { authService } from '../services/authService';

const newUser = await authService.createUser({
  email: 'john@example.com',
  password: 'SecurePass123',
  name: 'John Doe',
  whatsappNumber: '9876543210',
  phone: '9876543210',
  role: 'user',
  department: 'Medical',
  organizationId: currentOrg.id
});

console.log('User created:', newUser.id);
```

### **Updating a User:**
```typescript
await authService.updateProfile(userId, {
  name: 'John Smith',
  department: 'Management',
  role: 'admin'
});
```

### **Deleting a User:**
```typescript
await authService.deleteUser(userId);
// Deletes from both public.users and auth.users
```

---

**Implementation Date:** January 2026  
**Status:** Production Ready 🚀  
**Architecture Pattern:** Multi-Tenant SaaS with RBAC + Service Layer
