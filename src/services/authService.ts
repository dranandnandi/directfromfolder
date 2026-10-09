import { supabase } from '../utils/supabaseClient';

interface EdgeFunctionErrorPayload {
  success?: boolean;
  error?: string;
  code?: string;
  details?: string[];
}

async function extractEdgeFunctionError(error: any, fallbackMessage: string): Promise<Error> {
  try {
    const response = error?.context;
    if (response && typeof response.json === 'function') {
      const payload = (await response.json()) as EdgeFunctionErrorPayload;
      if (payload?.error) {
        const detailText = payload.details?.length ? ` ${payload.details.join(' ')}` : '';
        return new Error(`${payload.error}${detailText}`.trim());
      }
    }
  } catch (parseError) {
    console.error('Failed to parse edge function error response:', parseError);
  }

  return new Error(error?.message || fallbackMessage);
}

export interface CreateUserData {
  email: string;
  password: string;
  name: string;
  whatsappNumber: string;
  role: 'user' | 'admin' | 'superadmin';
  department: string;
  organizationId: string;
  phone: string;
}

export interface UpdateProfileData {
  name?: string;
  whatsappNumber?: string;
  department?: string;
  role?: string;
  phone?: string;
}

export interface UserProfile {
  id: string;
  auth_id: string;
  organization_id: string;
  name: string;
  email: string;
  whatsapp_number: string;
  phone?: string;
  role: string;
  department: string;
  created_at: string;
  updated_at: string;
  onboarding_state?: string;
  last_active_at?: string;
  is_active: boolean;
}

/**
 * Title case converter utility
 */
// Unused - title casing is done in edge functions
// function toTitleCase(str: string): string {
//   return str
//     .toLowerCase()
//     .split(' ')
//     .map(word => word.charAt(0).toUpperCase() + word.slice(1))
//     .join(' ');
// }

/**
 * Create a new user with both auth.users and public.users entries
 * Uses Edge Function to handle auth user creation securely
 */
export async function createUser(userData: CreateUserData): Promise<UserProfile> {
  try {
    console.log('Creating user with data:', { ...userData, password: '***' });

    // Get current session for authorization
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('No active session. Please log in again.');
    }

    console.log('Session token available:', !!session.access_token);

    // Call edge function to create user (handles both auth.users and public.users)
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: {
        email: userData.email,
        password: userData.password,
        name: userData.name,
        whatsappNumber: userData.whatsappNumber,
        phone: userData.phone,
        role: userData.role,
        department: userData.department,
        organizationId: userData.organizationId
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    console.log('Edge function response:', { data, error });

    if (error) {
      console.error('Edge function error:', error);
      throw await extractEdgeFunctionError(error, 'Failed to create user');
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to create user');
    }

    console.log('User created successfully:', data.data.id);
    return convertDatabaseProfile(data.data);

  } catch (error: any) {
    console.error('Error in createUser:', error);
    throw error;
  }
}

// Note: createProfile function is no longer needed as edge function handles both auth and profile creation

/**
 * Update user profile
 * Uses Edge Function for admin-level updates
 */
export async function updateProfile(
  userId: string, 
  updates: UpdateProfileData
): Promise<UserProfile> {
  try {
    // Get current session for authorization
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('No active session. Please log in again.');
    }

    // Call edge function to update user
    const { data, error } = await supabase.functions.invoke('update-user', {
      body: {
        userId: userId,
        name: updates.name,
        whatsappNumber: updates.whatsappNumber,
        phone: updates.phone,
        department: updates.department,
        role: updates.role
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    if (error) {
      console.error('Edge function error:', error);
      throw await extractEdgeFunctionError(error, 'Failed to update user');
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to update user');
    }

    return convertDatabaseProfile(data.data);

  } catch (error: any) {
    console.error('Error updating profile:', error);
    throw error;
  }
}

/**
 * Delete user (removes from both auth.users and public.users)
 * Uses Edge Function for secure deletion
 */
export async function deleteUser(userId: string): Promise<void> {
  try {
    // Get current session for authorization
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('No active session. Please log in again.');
    }

    // Call edge function to delete user
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: {
        userId: userId
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    if (error) {
      console.error('Edge function error:', error);
      throw await extractEdgeFunctionError(error, 'Failed to delete user');
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to delete user');
    }

    console.log('User deleted successfully');

  } catch (error: any) {
    console.error('Error deleting user:', error);
    throw error;
  }
}

export async function restoreUser(userId: string): Promise<void> {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('No active session. Please log in again.');
    }

    const { data, error } = await supabase.functions.invoke('restore-user', {
      body: { userId },
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    if (error) {
      throw await extractEdgeFunctionError(error, 'Failed to restore user');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Failed to restore user');
    }
  } catch (error: any) {
    console.error('Error restoring user:', error);
    throw error;
  }
}

/**
 * Get all users for an organization
 */
export async function getOrganizationUsers(organizationId: string): Promise<UserProfile[]> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch users: ${error.message}`);
    }

    return (data || []).map(convertDatabaseProfile);

  } catch (error: any) {
    console.error('Error fetching organization users:', error);
    throw error;
  }
}

export async function resetUserPassword(
  userId: string,
  newPassword: string
): Promise<void> {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('No active session. Please log in again.');
    }

    const { data, error } = await supabase.functions.invoke('reset-user-password', {
      body: { userId, newPassword },
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });

    if (error) {
      throw await extractEdgeFunctionError(error, 'Failed to reset password');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Failed to reset password');
    }

  } catch (error: any) {
    console.error('Error resetting password:', error);
    throw error;
  }
}

/**
 * Convert database record (snake_case) to frontend model (camelCase)
 */
function convertDatabaseProfile(dbRecord: any): UserProfile {
  return {
    id: dbRecord.id,
    auth_id: dbRecord.auth_id,
    organization_id: dbRecord.organization_id,
    name: dbRecord.name,
    email: dbRecord.email,
    whatsapp_number: dbRecord.whatsapp_number,
    phone: dbRecord.phone,
    role: dbRecord.role,
    department: dbRecord.department,
    created_at: dbRecord.created_at,
    updated_at: dbRecord.updated_at,
    onboarding_state: dbRecord.onboarding_state,
    last_active_at: dbRecord.last_active_at,
    is_active: dbRecord.is_active !== false
  };
}

export const authService = {
  createUser,
  updateProfile,
  deleteUser,
  restoreUser,
  getOrganizationUsers,
  resetUserPassword
};
