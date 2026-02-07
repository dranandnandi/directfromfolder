/**
 * DigitalOcean Function: WhatsApp Create Task
 * Creates a task from WhatsApp bot command
 * 
 * Usage:
 * {
 *   "userId": "user-uuid",                  // Required - Who creates the task
 *   "organizationId": "org-uuid",           // Required
 *   "title": "Check patient reports",       // Required
 *   "description": "...",                   // Optional
 *   "assigneeId": "assignee-uuid",          // Optional (null = unassigned, userId = self)
 *   "priority": "high",                     // Optional: high|medium|low (default: medium)
 *   "dueDate": "2026-01-10",                // Optional: ISO date string
 *   "type": "Advisory"                      // Optional (default: Advisory)
 * }
 */

const SUPABASE_URL = 'https://hnyqfasddflqzfibtjjz.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'YOUR_SERVICE_ROLE_KEY_HERE'; // Replace with actual key

async function main(args) {
  const userId = args.userId || '';
  const organizationId = args.organizationId || '';
  const title = args.title || '';
  const description = args.description || '';
  const assigneeId = args.assigneeId || null;
  const priority = args.priority || 'medium';
  const dueDate = args.dueDate || null;
  const type = args.type || 'Advisory';

  // Validate required fields
  if (!userId) {
    return { 
      body: { 
        success: false, 
        error: 'userId is required' 
      } 
    };
  }

  if (!organizationId) {
    return { 
      body: { 
        success: false, 
        error: 'organizationId is required' 
      } 
    };
  }

  if (!title || title.trim().length === 0) {
    return { 
      body: { 
        success: false, 
        error: 'title is required' 
      } 
    };
  }

  try {
    console.log('Creating task:', { 
      userId, 
      organizationId, 
      title, 
      assigneeId 
    });

    // Call Supabase edge function
    const requestBody = {
      userId,
      organizationId,
      title,
      ...(description && { description }),
      ...(assigneeId && { assigneeId }),
      ...(priority && { priority }),
      ...(dueDate && { dueDate }),
      ...(type && { type })
    };

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/whatsapp-create-task`,
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
    
    console.log('Create task result:', JSON.stringify(result, null, 2));
    
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
