import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  whatsappNumber: string;
  phone?: string;
  role: 'user' | 'admin' | 'superadmin';
  department: string;
  organizationId: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Extract JWT token from Bearer header
    const token = authHeader.replace('Bearer ', '');

    // Create Supabase client with service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verify the JWT token and get user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError);
      throw new Error('Unauthorized: Invalid or expired token');
    }

    // Verify the requesting user is an admin in their organization
    const { data: adminUser, error: adminCheckError } = await supabaseAdmin
      .from('users')
      .select('role, organization_id')
      .eq('auth_id', user.id)
      .single();

    if (adminCheckError || !adminUser) {
      throw new Error('User not found in database');
    }

    if (!['admin', 'superadmin'].includes(adminUser.role)) {
      throw new Error('Forbidden: Only admins can create users');
    }

    // Parse request body
    const requestBody: CreateUserRequest = await req.json();
    const { email, password, name, whatsappNumber, phone, role, department, organizationId } = requestBody;

    // Validate that admin is creating user in their own organization
    if (adminUser.organization_id !== organizationId) {
      throw new Error('Forbidden: Cannot create users in other organizations');
    }

    // Validate required fields
    if (!email || !password || !name || !whatsappNumber || !role || !department || !organizationId) {
      throw new Error('Missing required fields');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password length
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Validate and format WhatsApp number
    let formattedWhatsApp = whatsappNumber;
    
    // If WhatsApp number doesn't start with +, assume it needs country code
    if (!whatsappNumber.startsWith('+')) {
      // Check if it's 10 digits (India) or 9 digits (UAE)
      const cleanedWhatsApp = whatsappNumber.replace(/\D/g, '');
      if (cleanedWhatsApp.length === 10) {
        formattedWhatsApp = `+91${cleanedWhatsApp}`;
      } else if (cleanedWhatsApp.length === 9) {
        formattedWhatsApp = `+971${cleanedWhatsApp}`;
      } else {
        throw new Error('WhatsApp number must be 10 digits (India) or 9 digits (UAE)');
      }
    } else {
      // Already has country code, validate format
      const match = whatsappNumber.match(/^\+(\d{1,4})(\d+)$/);
      if (!match) {
        throw new Error('Invalid WhatsApp number format');
      }
      const countryCode = match[1];
      const number = match[2];
      
      if (countryCode === '91' && number.length !== 10) {
        throw new Error('Indian WhatsApp number must be 10 digits');
      } else if (countryCode === '971' && number.length !== 9) {
        throw new Error('UAE WhatsApp number must be 9 digits');
      }
    }

    // Title case the name
    const titleCaseName = name
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    console.log('Creating auth user for:', email);

    // Step 1: Create user in Supabase Auth
    const { data: authData, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: titleCaseName,
        role: role
      }
    });

    if (authCreateError) {
      console.error('Auth user creation error:', authCreateError);
      throw new Error(`Failed to create auth user: ${authCreateError.message}`);
    }

    if (!authData.user) {
      throw new Error('No user data returned from auth creation');
    }

    console.log('Auth user created successfully:', authData.user.id);

    // Step 2: Create user profile in public.users table
    const profileData = {
      auth_id: authData.user.id,
      organization_id: organizationId,
      name: titleCaseName,
      email: email,
      whatsapp_number: formattedWhatsApp,
      phone: phone || null,
      role: role,
      department: department,
      onboarding_state: 'completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating user profile with data:', JSON.stringify(profileData, null, 2));

    const { data: profileResult, error: profileError } = await supabaseAdmin
      .from('users')
      .insert([profileData])
      .select('*')
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      console.error('Profile error details:', JSON.stringify(profileError, null, 2));
      console.error('Profile error code:', profileError.code);
      console.error('Profile error message:', profileError.message);
      console.error('Profile error hint:', profileError.hint);
      
      // Cleanup: Delete auth user if profile creation fails
      console.log('Cleaning up auth user due to profile creation failure...');
      try {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        console.log('Auth user cleanup successful');
      } catch (cleanupError) {
        console.error('Failed to cleanup auth user:', cleanupError);
      }
      
      throw new Error(`Failed to create user profile: ${profileError.message}`);
    }

    console.log('User profile created successfully:', profileResult.id);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: profileResult.id,
          auth_id: profileResult.auth_id,
          organization_id: profileResult.organization_id,
          name: profileResult.name,
          email: profileResult.email,
          whatsapp_number: profileResult.whatsapp_number,
          phone: profileResult.phone,
          role: profileResult.role,
          department: profileResult.department,
          created_at: profileResult.created_at,
          updated_at: profileResult.updated_at
        },
        message: 'User created successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Error in create-user function:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Unauthorized') ? 401 :
               error.message.includes('Forbidden') ? 403 :
               error.message.includes('Missing required fields') || 
               error.message.includes('Invalid') ? 400 : 500,
      }
    );
  }
});
