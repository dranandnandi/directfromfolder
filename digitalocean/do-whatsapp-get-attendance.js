/**
 * DigitalOcean Function: WhatsApp Get Attendance
 * Fetches today's attendance (present/absent employees) from WhatsApp bot
 * 
 * Usage:
 * {
 *   "organizationId": "550e8400-e29b-41d4-a716-446655440000",
 *   "date": "2026-01-06"    // Optional, defaults to today (YYYY-MM-DD)
 * }
 */

const SUPABASE_URL = 'https://hnyqfasddflqzfibtjjz.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'YOUR_SERVICE_ROLE_KEY_HERE'; // Replace with actual key

async function main(args) {
  const organizationId = args.organizationId || '';
  const date = args.date || ''; // Optional, defaults to today if not provided

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
    console.log('Fetching attendance for organization:', organizationId, 'date:', date || 'today');

    // Call Supabase edge function
    const requestBody = {
      organizationId,
      ...(date && { date })
    };

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/whatsapp-get-attendance`,
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
    
    console.log('Get attendance result:', JSON.stringify(result, null, 2));
    
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
