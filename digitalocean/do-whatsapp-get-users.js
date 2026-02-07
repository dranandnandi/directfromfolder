/**
 * DigitalOcean Function: WhatsApp Get Organization Users
 * Fetches team members for task assignment from WhatsApp bot
 * 
 * Usage:
 * {
 *   "organizationId": "550e8400-e29b-41d4-a716-446655440000",
 *   "searchQuery": "john",     // Optional
 *   "role": "user",            // Optional: user|admin|superadmin
 *   "department": "Medical"    // Optional
 * }
 */

const SUPABASE_URL = 'https://hnyqfasddflqzfibtjjz.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'YOUR_SERVICE_ROLE_KEY_HERE'; // Replace with actual key

async function main(args) {
  const organizationId = args.organizationId || '';
  const searchQuery = args.searchQuery || '';
  const role = args.role || '';
  const department = args.department || '';

  // Validate required fields
  if (!organizationId) {
    return { 
      body: { 
        success: false, 
        error: 'organizationId is required' 
      } 
    };
  }

  try {
    console.log('Fetching users for organization:', organizationId);

    // Call Supabase edge function
    const requestBody = {
      organizationId,
      ...(searchQuery && { searchQuery }),
      ...(role && { role }),
      ...(department && { department })
    };

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/whatsapp-get-users`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    const result = await response.json();
    
    console.log('Get users result:', JSON.stringify(result, null, 2));
    
    return { body: result };

  } catch (error) {
    console.error('DigitalOcean function error:', error);
    return { 
      body: { 
        success: false, 
        error: error.message 
      } 
    };
  }
}
