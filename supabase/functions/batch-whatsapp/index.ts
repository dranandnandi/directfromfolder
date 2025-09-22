import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BatchWhatsAppRequest {
  limit?: number;
  notificationTypes?: string[];
}

interface BatchWhatsAppResponse {
  success: boolean;
  processed: number;
  sent: number;
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const requestBody: BatchWhatsAppRequest = await req.json();
    const { limit = 50, notificationTypes } = requestBody;

    console.log('Processing batch WhatsApp notifications:', { limit, notificationTypes });

    // Query pending WhatsApp notifications
    let query = supabase
      .from('notifications')
      .select(`
        id,
        user_id,
        task_id,
        type,
        title,
        message,
        whatsapp_number,
        ai_generated_message,
        scheduled_for,
        created_at
      `)
      .eq('whatsapp_sent', false)
      .not('whatsapp_number', 'is', null)
      .not('ai_generated_message', 'is', null)
      .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
      .order('created_at', { ascending: true })
      .limit(limit);

    // Filter by notification types if specified
    if (notificationTypes && notificationTypes.length > 0) {
      query = query.in('type', notificationTypes);
    }

    const { data: notifications, error: queryError } = await query;

    if (queryError) {
      console.error('Error querying notifications:', queryError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to query notifications' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const response: BatchWhatsAppResponse = {
      success: true,
      processed: 0,
      sent: 0,
      failed: 0,
      errors: []
    };

    if (!notifications || notifications.length === 0) {
      console.log('No pending WhatsApp notifications found');
      return new Response(
        JSON.stringify(response),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Found ${notifications.length} pending notifications`);

    // Process each notification
    for (const notification of notifications) {
      response.processed++;

      try {
        const formattedPhone = formatPhoneNumber(notification.whatsapp_number);
        
        const whatsappPayload = {
          phoneNumber: formattedPhone,
          message: notification.ai_generated_message,
          patientName: '',
          testName: notification.title,
          doctorName: ''
        };

        console.log(`Sending WhatsApp for notification ${notification.id}:`, {
          phoneNumber: formattedPhone,
          type: notification.type
        });

        const whatsappResponse = await fetch(WHATSAPP_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(whatsappPayload),
        });

        const whatsappResult = await whatsappResponse.json();

        if (whatsappResponse.ok) {
          // Success - update notification
          await supabase
            .from('notifications')
            .update({
              whatsapp_sent: true,
              whatsapp_sent_at: new Date().toISOString(),
              whatsapp_message_id: whatsappResult.messageId || whatsappResult.id
            })
            .eq('id', notification.id);

          response.sent++;
          console.log(`✅ WhatsApp sent for notification ${notification.id}`);
        } else {
          // Failed - log error
          const errorMsg = whatsappResult.error || 'API request failed';
          
          await supabase
            .from('notifications')
            .update({
              whatsapp_sent: true, // Mark as processed to avoid retry loops
              whatsapp_sent_at: new Date().toISOString(),
              whatsapp_error: errorMsg
            })
            .eq('id', notification.id);

          response.failed++;
          response.errors.push(`Notification ${notification.id}: ${errorMsg}`);
          console.error(`❌ WhatsApp failed for notification ${notification.id}:`, errorMsg);
        }

        // Add small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        response.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        response.errors.push(`Notification ${notification.id}: ${errorMsg}`);
        console.error(`❌ Error processing notification ${notification.id}:`, error);

        // Mark as processed with error to avoid retry loops
        try {
          await supabase
            .from('notifications')
            .update({
              whatsapp_sent: true,
              whatsapp_sent_at: new Date().toISOString(),
              whatsapp_error: errorMsg
            })
            .eq('id', notification.id);
        } catch (updateError) {
          console.error('Failed to update notification with error:', updateError);
        }
      }
    }

    console.log('Batch processing complete:', response);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in batch-whatsapp function:', error);
    
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
