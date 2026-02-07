// Supabase Edge Function: whatsapp-get-tasks
// Fetches tasks for a user

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { 
      userId, 
      organizationId, 
      status = 'pending', 
      assignedToMe = true,
      createdByMe = false,
      limit = 10 
    } = await req.json()

    // Validate
    if (!userId || !organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'userId and organizationId are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Build query
    let query = supabaseClient
      .from('tasks')
      .select(`
        id,
        title,
        description,
        status,
        priority,
        due_date,
        created_at,
        assignee:assignee_id(id, full_name),
        creator:created_by(id, full_name)
      `)
      .eq('organization_id', organizationId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: true })
      .limit(limit)

    // Filter by status
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    // Filter by user relationship
    if (assignedToMe && createdByMe) {
      query = query.or(`assignee_id.eq.${userId},created_by.eq.${userId}`)
    } else if (assignedToMe) {
      query = query.eq('assignee_id', userId)
    } else if (createdByMe) {
      query = query.eq('created_by', userId)
    }

    const { data: tasks, error } = await query

    if (error) {
      console.error('Query error:', error)
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch tasks' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Format tasks for WhatsApp-friendly display
    const formattedTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.due_date,
      assignee: task.assignee?.full_name || 'Unassigned',
      creator: task.creator?.full_name || 'Unknown',
      createdAt: task.created_at
    }))

    return new Response(
      JSON.stringify({ 
        success: true, 
        count: formattedTasks.length,
        tasks: formattedTasks
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
