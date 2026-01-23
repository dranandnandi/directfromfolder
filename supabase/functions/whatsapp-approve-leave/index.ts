import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ApproveLeaveInput {
  userId: string;           // Admin taking action
  organizationId: string;
  action: 'approve' | 'reject';
  reason?: string;          // Optional reason (mainly for rejection)
  employeeName?: string;    // Optional: filter by employee name
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== WhatsApp Approve Leave ===');

    // Verify service role key (for DigitalOcean bot)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Missing or invalid authorization header');
    }

    const providedKey = authHeader.replace('Bearer ', '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (providedKey !== serviceRoleKey) {
      throw new Error('Unauthorized: Invalid service role key');
    }

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Parse request body
    const requestBody: ApproveLeaveInput = await req.json();
    const { 
      userId, 
      organizationId, 
      action,
      reason,
      employeeName
    } = requestBody;

    console.log('Request params:', { userId, organizationId, action, reason, employeeName });

    // Validate required fields
    if (!userId) throw new Error('userId is required');
    if (!organizationId) throw new Error('organizationId is required');
    if (!action || !['approve', 'reject'].includes(action)) {
      throw new Error('action must be "approve" or "reject"');
    }

    // Verify admin exists and has admin role
    const { data: adminData, error: adminError } = await supabaseAdmin
      .from('users')
      .select('id, name, role, organization_id')
      .eq('id', userId)
      .single();

    if (adminError || !adminData) {
      throw new Error('Admin user not found');
    }

    if (adminData.organization_id !== organizationId) {
      throw new Error('Admin does not belong to this organization');
    }

    if (!['admin', 'superadmin'].includes(adminData.role)) {
      throw new Error('Only admins can approve/reject leave requests');
    }

    console.log('Admin verified:', adminData.name, adminData.role);

    // Build query for pending leave requests
    // Leave requests are stored as tasks with title starting with "Leave Request:"
    let query = supabaseAdmin
      .from('tasks')
      .select(`
        id,
        title,
        description,
        created_by,
        assigned_to,
        status,
        created_at,
        creator:users!tasks_created_by_fkey(id, name, phone_number)
      `)
      .eq('organization_id', organizationId)
      .eq('assigned_to', userId) // Assigned to this admin
      .eq('status', 'pending')
      .ilike('title', 'Leave Request:%')
      .order('created_at', { ascending: false });

    const { data: leaveRequests, error: queryError } = await query;

    if (queryError) {
      console.error('Query error:', queryError);
      throw new Error('Failed to fetch leave requests');
    }

    if (!leaveRequests || leaveRequests.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No pending leave requests found'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${leaveRequests.length} pending leave request(s)`);

    // If employeeName specified, filter by it
    let targetRequest = leaveRequests[0]; // Default to most recent
    
    if (employeeName) {
      const nameLower = employeeName.toLowerCase();
      const matchingRequest = leaveRequests.find((req: any) => 
        req.creator?.name?.toLowerCase().includes(nameLower) ||
        req.title.toLowerCase().includes(nameLower)
      );
      
      if (matchingRequest) {
        targetRequest = matchingRequest;
        console.log(`Found matching request for employee: ${employeeName}`);
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: `No pending leave request found for "${employeeName}"`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Parse leave details from title and description
    const titleMatch = targetRequest.title.match(/Leave Request: (.+?) - (.+)/);
    const creatorName = (targetRequest as any).creator?.name || (titleMatch ? titleMatch[1] : 'Employee');
    const leaveType = titleMatch ? titleMatch[2].toLowerCase().replace(' (post facto)', '') : 'full day';
    
    // Extract dates from description
    const descText = targetRequest.description || '';
    const startDateMatch = descText.match(/Start Date: (\d{4}-\d{2}-\d{2})/);
    const endDateMatch = descText.match(/End Date: (\d{4}-\d{2}-\d{2})/);
    const reasonMatch = descText.match(/Reason: (.+?)(?:\n|$)/);
    
    const startDate = startDateMatch ? startDateMatch[1] : 'N/A';
    const endDate = endDateMatch ? endDateMatch[1] : startDate;
    const leaveReason = reasonMatch ? reasonMatch[1].trim() : 'Not specified';

    console.log('Processing leave request:', {
      id: targetRequest.id,
      employee: creatorName,
      leaveType,
      startDate,
      endDate
    });

    // Update task status
    const newStatus = action === 'approve' ? 'completed' : 'rejected';
    const updateComment = action === 'approve' 
      ? `✅ APPROVED by ${adminData.name} via WhatsApp`
      : `❌ REJECTED by ${adminData.name} via WhatsApp${reason ? `\nReason: ${reason}` : ''}`;

    const { error: updateError } = await supabaseAdmin
      .from('tasks')
      .update({
        status: newStatus,
        description: targetRequest.description + `\n\n---\n${updateComment}\nProcessed: ${new Date().toISOString()}`
      })
      .eq('id', targetRequest.id);

    if (updateError) {
      console.error('Update error:', updateError);
      throw new Error('Failed to update leave request status');
    }

    console.log(`Leave request ${action}ed successfully`);

    // Get employee's phone number for notification
    const employeePhone = (targetRequest as any).creator?.phone_number;
    let employeeNotified = false;

    // Create notification for the employee
    if (targetRequest.created_by) {
      const notificationTitle = action === 'approve'
        ? `✅ Leave Approved!`
        : `❌ Leave Request Rejected`;
      
      const notificationMessage = action === 'approve'
        ? `Great news! Your leave request for ${startDate}${endDate !== startDate ? ` to ${endDate}` : ''} has been approved by ${adminData.name}. Enjoy your time off! 🎉`
        : `Your leave request for ${startDate}${endDate !== startDate ? ` to ${endDate}` : ''} has been rejected by ${adminData.name}.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease contact your admin if you have questions.`;

      const { error: notifError } = await supabaseAdmin
        .from('notifications')
        .insert([{
          user_id: targetRequest.created_by,
          organization_id: organizationId,
          title: notificationTitle,
          message: notificationMessage,
          type: 'leave_response',
          read: false,
          // WhatsApp notification fields
          whatsapp_number: employeePhone,
          ai_generated_message: notificationMessage,
          whatsapp_sent: false
        }]);

      if (notifError) {
        console.error('Notification error:', notifError);
        // Don't fail the whole operation for notification error
      } else {
        employeeNotified = !!employeePhone;
        console.log('Employee notification created', employeeNotified ? '(WhatsApp pending)' : '(no phone)');
      }
    }

    // Prepare response
    const responseMessage = action === 'approve'
      ? `Leave request for ${creatorName} has been approved! ${employeeNotified ? 'They will be notified via WhatsApp.' : ''}`
      : `Leave request for ${creatorName} has been rejected. ${employeeNotified ? 'They will be notified via WhatsApp.' : ''}`;

    return new Response(
      JSON.stringify({
        success: true,
        message: responseMessage,
        data: {
          employeeName: creatorName,
          leaveType,
          startDate,
          endDate,
          reason: leaveReason,
          action,
          adminReason: reason,
          employeeNotified
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in whatsapp-approve-leave:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});
