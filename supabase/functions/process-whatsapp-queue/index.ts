import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

interface BatchProcessRequest {
  batchSize?: number;
}

interface ProcessingResult {
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
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

    const requestBody: BatchProcessRequest = await req.json().catch(() => ({}));
    const batchSize = requestBody.batchSize || 25;

    console.log(`Starting batch WhatsApp processing, batch size: ${batchSize}`);

    // Get pending notifications from the queue
    const { data: pendingNotifications, error: fetchError } = await supabase
      .rpc('get_pending_whatsapp_notifications', { batch_size: batchSize });

    if (fetchError) {
      console.error('Error fetching pending notifications:', fetchError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to fetch pending notifications' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (!pendingNotifications || pendingNotifications.length === 0) {
      console.log('No pending notifications to process');
      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0,
          successful: 0,
          failed: 0,
          message: 'No pending notifications'
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Processing ${pendingNotifications.length} notifications`);

    const result: ProcessingResult = {
      processed: pendingNotifications.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process each notification
    for (const notification of pendingNotifications) {
      try {
        const success = await processWhatsAppNotification(notification, supabase);
        if (success) {
          result.successful++;
        } else {
          result.failed++;
        }
      } catch (error) {
        console.error(`Error processing notification ${notification.id}:`, error);
        result.failed++;
        result.errors.push(`Notification ${notification.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        // Mark as failed in database
        await supabase.rpc('mark_whatsapp_notification_status', {
          notification_id: notification.id,
          success: false,
          error_message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`Batch processing complete:`, result);

    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in process-whatsapp-queue function:', error);
    
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

async function processWhatsAppNotification(notification: any, supabase: any): Promise<boolean> {
  try {
    // Format phone number (remove any leading +91 and ensure 10 digits for API)
    const formattedPhone = formatPhoneForAPI(notification.whatsapp_number);

    // Prepare WhatsApp API request
    const whatsappPayload = {
      phoneNumber: formattedPhone,
      message: notification.ai_generated_message
    };

    console.log(`Sending WhatsApp to ${formattedPhone} for notification ${notification.id}`);

    // Send message to WhatsApp API
    const whatsappResponse = await fetch(WHATSAPP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(whatsappPayload),
    });

    const whatsappResult = await whatsappResponse.json();

    if (!whatsappResponse.ok) {
      console.error('WhatsApp API error for notification', notification.id, ':', whatsappResult);
      
      // Mark as failed
      await supabase.rpc('mark_whatsapp_notification_status', {
        notification_id: notification.id,
        success: false,
        error_message: whatsappResult.error || 'API request failed'
      });
      
      return false;
    }

    // Mark as successful
    await supabase.rpc('mark_whatsapp_notification_status', {
      notification_id: notification.id,
      success: true,
      error_message: null
    });

    console.log(`WhatsApp sent successfully for notification ${notification.id}`);
    return true;

  } catch (error) {
    console.error(`Error processing notification ${notification.id}:`, error);
    throw error;
  }
}

function formatPhoneForAPI(phone: string): string {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // Remove country code (91) if present to get 10-digit number for API
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return cleaned.substring(2);
  }
  
  // If it starts with 0, remove it
  if (cleaned.startsWith('0')) {
    return cleaned.substring(1);
  }
  
  // Return 10-digit number
  if (cleaned.length === 10) {
    return cleaned;
  }
  
  // If longer than 10, take last 10 digits
  if (cleaned.length > 10) {
    return cleaned.slice(-10);
  }
  
  return cleaned;
}
