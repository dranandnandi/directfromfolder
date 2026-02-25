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

    // Build query - fetch raw columns (no joins, avoids PostgREST FK cache issues)
    let query = supabaseClient
      .from('tasks')
      .select('id, title, description, status, priority, due_date, created_at, assigned_to, created_by')
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
      query = query.or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    } else if (assignedToMe) {
      query = query.eq('assigned_to', userId)
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

    // Collect unique user IDs to resolve names
    const userIds = new Set<string>()
    for (const task of tasks) {
      if (task.assigned_to) userIds.add(task.assigned_to)
      if (task.created_by) userIds.add(task.created_by)
    }

    // Fetch user names in one query
    const userMap: Record<string, string> = {}
    if (userIds.size > 0) {
      const { data: users } = await supabaseClient
        .from('users')
        .select('id, name')
        .in('id', Array.from(userIds))
      if (users) {
        for (const u of users) {
          userMap[u.id] = u.name
        }
      }
    }

    // Format tasks for WhatsApp-friendly display
    const formattedTasks = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.due_date,
      assignee: userMap[task.assigned_to] || 'Unassigned',
      creator: userMap[task.created_by] || 'Unknown',
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
