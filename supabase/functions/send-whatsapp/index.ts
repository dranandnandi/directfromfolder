import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

interface WhatsAppRequest {
  phoneNumber: string;
  message: string;
  patientName?: string;
  testName?: string;
  doctorName?: string;
  taskId?: string;
  notificationId?: string;
}

interface WhatsAppResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

const WHATSAPP_API_URL = Deno.env.get('WHATSAPP_API_URL') || 'http://134.209.145.186:3001/api/send-message';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing required environment variables');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Server configuration error' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const requestBody: WhatsAppRequest = await req.json();
    const { phoneNumber, message, patientName, testName, doctorName, taskId, notificationId } = requestBody;

    // Validate required fields
    if (!phoneNumber || !message) {
      return new Response(
        JSON.stringify({ error: 'Phone number and message are required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Default to environment API URL
    let EFFECTIVE_API_URL = WHATSAPP_API_URL;

    // Check organization WhatsApp settings if notification ID is provided
    if (notificationId) {
      const { data: notificationData } = await supabase
        .from('notifications')
        .select(`
          *,
          users!inner(organization_id),
          organizations!inner(whatsapp_enabled, auto_alerts_enabled, whatsapp_api_endpoint)
        `)
        .eq('id', notificationId)
        .single();

      if (notificationData) {
        const org = notificationData.organizations;
        
        // Check if WhatsApp is enabled for this organization
        if (!org.whatsapp_enabled) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'WhatsApp is disabled for this organization',
              skipped: true 
            }),
            { 
              status: 200, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        // Use organization-specific API endpoint if configured
        EFFECTIVE_API_URL = org.whatsapp_api_endpoint || WHATSAPP_API_URL;
      }
    }

    // Format phone number (ensure it starts with country code)
    const formattedPhone = formatPhoneNumber(phoneNumber);

    // Prepare WhatsApp API request
    const whatsappPayload = {
      phoneNumber: formattedPhone,
      message: message,
      patientName: patientName || '',
      testName: testName || '',
      doctorName: doctorName || ''
    };

    console.log('Sending WhatsApp message:', {
      phoneNumber: formattedPhone,
      messageLength: message.length,
      taskId,
      notificationId,
      apiUrl: EFFECTIVE_API_URL
    });

    // Send message to WhatsApp API
    const whatsappResponse = await fetch(EFFECTIVE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(whatsappPayload),
    });

    const whatsappResult = await whatsappResponse.json();

    if (!whatsappResponse.ok) {
      console.error('WhatsApp API error:', whatsappResult);
      
      // Log failed attempt to database
      if (notificationId) {
        await logWhatsAppAttempt(supabase, notificationId, false, whatsappResult.error || 'API request failed');
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: whatsappResult.error || 'Failed to send WhatsApp message' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Update notification status in database
    if (notificationId) {
      await logWhatsAppAttempt(supabase, notificationId, true, null, whatsappResult.messageId);
    }

    console.log('WhatsApp message sent successfully:', whatsappResult);

    const response: WhatsAppResponse = {
      success: true,
      messageId: whatsappResult.messageId || whatsappResult.id
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in send-whatsapp function:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If it starts with 91 (India), keep as is
  if (cleaned.startsWith('91')) {
    return '+' + cleaned;
  }
  
  // If it starts with 0, remove the 0 and add +91
  if (cleaned.startsWith('0')) {
    return '+91' + cleaned.substring(1);
  }
  
  // If it's 10 digits and doesn't start with country code, assume India
  if (cleaned.length === 10) {
    return '+91' + cleaned;
  }
  
  // If it doesn't start with +, add it
  if (!phone.startsWith('+')) {
    return '+' + cleaned;
  }
  
  return phone;
}

async function logWhatsAppAttempt(
  supabase: any,
  notificationId: string,
  success: boolean,
  error: string | null,
  messageId?: string
) {
  try {
    const updateData: any = {
      whatsapp_sent: success,
      whatsapp_sent_at: new Date().toISOString(),
    };

    if (messageId) {
      updateData.whatsapp_message_id = messageId;
    }

    if (error) {
      updateData.whatsapp_error = error;
    }

    const { error: updateError } = await supabase
      .from('notifications')
      .update(updateData)
      .eq('id', notificationId);

    if (updateError) {
      console.error('Failed to update notification status:', updateError);
    }
  } catch (err) {
    console.error('Error logging WhatsApp attempt:', err);
  }
}
