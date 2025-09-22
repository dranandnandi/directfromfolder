import { supabase } from './supabaseClient';

export interface WhatsAppSendRequest {
  phoneNumber: string;
  message: string;
  patientName?: string;
  testName?: string;
  doctorName?: string;
  taskId?: string;
  notificationId?: string;
}

export interface WhatsAppSendResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface BatchWhatsAppResponse {
  success: boolean;
  processed: number;
  sent: number;
  failed: number;
  errors: string[];
}

export interface WhatsAppStats {
  total_notifications: number;
  pending_notifications: number;
  sent_notifications: number;
  failed_notifications: number;
  success_rate: number;
}

/**
 * Send a single WhatsApp message
 */
export async function sendWhatsAppMessage(request: WhatsAppSendRequest): Promise<WhatsAppSendResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('send-whatsapp', {
      body: request
    });

    if (error) {
      console.error('Error calling send-whatsapp function:', error);
      return {
        success: false,
        error: error.message || 'Failed to send WhatsApp message'
      };
    }

    return data as WhatsAppSendResponse;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Process batch WhatsApp notifications with priority filtering
 */
export async function processBatchWhatsApp(
  limit: number = 50,
  notificationTypes?: string[]
): Promise<BatchWhatsAppResponse> {
  try {
    // Default to high and medium priority types if none specified
    const defaultHighPriorityTypes = ['task_assigned', 'task_urgent', 'task_overdue'];
    const defaultMediumPriorityTypes = ['task_due', 'task_completed', 'task_updated', 'leave_request_new', 'leave_request_approved', 'leave_request_rejected'];
    
    const typesToProcess = notificationTypes || [...defaultHighPriorityTypes, ...defaultMediumPriorityTypes];

    const { data, error } = await supabase.functions.invoke('batch-whatsapp', {
      body: {
        limit,
        notificationTypes: typesToProcess
      }
    });

    if (error) {
      console.error('Error calling batch-whatsapp function:', error);
      return {
        success: false,
        processed: 0,
        sent: 0,
        failed: 0,
        errors: [error.message || 'Failed to process batch WhatsApp']
      };
    }

    return data as BatchWhatsAppResponse;
  } catch (error) {
    console.error('Error processing batch WhatsApp:', error);
    return {
      success: false,
      processed: 0,
      sent: 0,
      failed: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error occurred']
    };
  }
}

/**
 * Get WhatsApp notification statistics with optimized categories
 */
export async function getWhatsAppStats(): Promise<WhatsAppStats> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('whatsapp_sent, whatsapp_number, type')
      .not('whatsapp_number', 'is', null);

    if (error) {
      console.error('Error fetching WhatsApp stats:', error);
      return {
        total_notifications: 0,
        pending_notifications: 0,
        sent_notifications: 0,
        failed_notifications: 0,
        success_rate: 0
      };
    }

    const total = data.length;
    const sent = data.filter(n => n.whatsapp_sent === true).length;
    const pending = data.filter(n => n.whatsapp_sent === false).length;
    const failed = total - sent - pending;

    return {
      total_notifications: total,
      pending_notifications: pending,
      sent_notifications: sent,
      failed_notifications: failed,
      success_rate: total > 0 ? Math.round((sent / total) * 100) : 0
    };
  } catch (error) {
    console.error('Error calculating WhatsApp stats:', error);
    return {
      total_notifications: 0,
      pending_notifications: 0,
      sent_notifications: 0,
      failed_notifications: 0,
      success_rate: 0
    };
  }
}

/**
 * Get pending WhatsApp notifications
 */
export async function getPendingWhatsAppNotifications(limit: number = 20) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select(`
        id,
        type,
        title,
        message,
        whatsapp_number,
        ai_generated_message,
        scheduled_for,
        created_at,
        task_id,
        tasks(title, priority, due_date)
      `)
      .eq('whatsapp_sent', false)
      .not('whatsapp_number', 'is', null)
      .not('ai_generated_message', 'is', null)
      .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Error fetching pending WhatsApp notifications:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching pending notifications:', error);
    return [];
  }
}

/**
 * Trigger overdue task alerts
 */
export async function triggerOverdueAlerts(): Promise<{ success: boolean; alerts_created?: number; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('trigger_overdue_alerts');

    if (error) {
      console.error('Error triggering overdue alerts:', error);
      return {
        success: false,
        error: error.message || 'Failed to trigger overdue alerts'
      };
    }

    return data;
  } catch (error) {
    console.error('Error calling trigger_overdue_alerts:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Create a leave request notification
 */
export async function createLeaveRequestNotification(
  leaveRequestId: string,
  employeeId: string,
  managerId: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  reason: string,
  status: string = 'pending'
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc('create_leave_request_notification', {
      p_leave_request_id: leaveRequestId,
      p_employee_id: employeeId,
      p_manager_id: managerId,
      p_leave_type: leaveType,
      p_start_date: startDate,
      p_end_date: endDate,
      p_reason: reason,
      p_status: status
    });

    if (error) {
      console.error('Error creating leave request notification:', error);
      return {
        success: false,
        error: error.message || 'Failed to create leave request notification'
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Error calling create_leave_request_notification:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Format phone number for WhatsApp (add country code if missing)
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  
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

/**
 * Generate WhatsApp Web link for direct messaging
 */
export function generateWhatsAppLink(phoneNumber: string, message: string): string {
  const formattedPhone = formatPhoneNumber(phoneNumber).replace('+', '');
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
}

/**
 * Test WhatsApp connectivity with your DigitalOcean API
 */
export async function testWhatsAppConnectivity(): Promise<{ success: boolean; error?: string }> {
  try {
    const testMessage = {
      phoneNumber: '+919909249725', // Your test number
      message: `🧪 WhatsApp Integration Test\n\nTimestamp: ${new Date().toISOString()}\n\n✅ System is working correctly!`,
      patientName: 'Test Patient',
      testName: 'Connectivity Test',
      doctorName: 'System Admin'
    };

    const result = await sendWhatsAppMessage(testMessage);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Get the optimized WhatsApp alerts configuration summary
 */
export async function getWhatsAppOptimizationSummary(): Promise<any> {
  try {
    const { data, error } = await supabase.rpc('get_whatsapp_optimization_summary');

    if (error) {
      console.error('Error fetching optimization summary:', error);
      return {
        error: error.message || 'Failed to fetch optimization summary'
      };
    }

    return data;
  } catch (error) {
    console.error('Error calling get_whatsapp_optimization_summary:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Process only high priority notifications (immediate alerts)
 */
export async function processHighPriorityWhatsApp(limit: number = 25): Promise<BatchWhatsAppResponse> {
  const highPriorityTypes = ['task_assigned', 'task_urgent', 'task_overdue'];
  return processBatchWhatsApp(limit, highPriorityTypes);
}

/**
 * Process only medium priority notifications (consolidated alerts)
 */
export async function processMediumPriorityWhatsApp(limit: number = 25): Promise<BatchWhatsAppResponse> {
  const mediumPriorityTypes = ['task_due', 'task_completed', 'task_updated', 'leave_request_new', 'leave_request_approved', 'leave_request_rejected'];
  return processBatchWhatsApp(limit, mediumPriorityTypes);
}
