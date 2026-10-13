import { GoogleGenerativeAI } from '@google/generative-ai';
import { withDefaultAdvisoryTypes, withDefaultFollowUpTypes, withDefaultRoundTypes } from '../constants/taskOptions';
import { User, TaskType, OrganizationSettings } from '../models/task';
import { supabase } from './supabaseClient';

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

export const generateTaskFromText = async (
  text: string,
  teamMembers: User[],
  selectedType: TaskType,
  organizationSettings: OrganizationSettings,
  enhancedContext?: {
    availableTeamMembers: { name: string; role: string; department: string; }[];
    organizationName: string;
  }
) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const organizationName = enhancedContext?.organizationName || organizationSettings.name;
    const availableTeamMembers = enhancedContext?.availableTeamMembers || 
      teamMembers.map(member => ({ name: member.name, role: member.role, department: member.department }));

    const roundTypeOptions = withDefaultRoundTypes(organizationSettings?.roundTypes);
    const followUpTypeOptions = withDefaultFollowUpTypes(organizationSettings?.followUpTypes);
    const advisoryTypeOptions = withDefaultAdvisoryTypes(organizationSettings?.advisoryTypes);

    const prompt = `
You are a task parser for "${organizationName}". Convert the following text into a structured task.
The task MUST be of type "${selectedType}".
Return ONLY a valid JSON object without any additional text or formatting.

Available team members for assignment:
${availableTeamMembers.map(member => `- ${member.name} (${member.role}, ${member.department})`).join('\n')}

Input text to parse: "${text}"

When extracting assignee information, look for:
- Exact names: "assign to Priya Sharma"
- Partial names: "give this to John" (match with John Doe)
- Roles: "assign to the supervisor" (match with supervisors)
- Departments: "give to the accounts team"

The JSON must follow this exact structure:
{
  "title": "Brief, clear task title",
  "description": "Detailed task description",
  "type": "${selectedType}", // This must be exactly this value
  "priority": "critical" | "moderate" | "lessImportant",
  "patientId": "Reference ID (client/case/record number) if mentioned, otherwise null",
  "location": "Site/room/branch/location if mentioned, otherwise null",
  "roundType": "Visit type for client tracking tasks, one of: ${roundTypeOptions.join(' / ')}, otherwise null",
  "advisoryType": "Task category for regular tasks, one of: ${advisoryTypeOptions.join(' / ')}, otherwise null",
  "followUpType": "Follow-up type for client tracking or audit tasks, one of: ${followUpTypeOptions.join(' / ')}, otherwise null",
  "assigneeName": "Name or role mentioned for assignment (from available team members), otherwise null",
  "hoursToComplete": "Number of hours mentioned to complete the task (e.g., '4' for '4 hours'), otherwise null",
  "contactNumber": "Extract any phone number mentioned (e.g., +91-1234567890, 123-456-7890), otherwise null",
  "whatsappNumber": "Extract WhatsApp number if mentioned separately, otherwise null",
  "taskDate": "Extract due date if mentioned, format as YYYY-MM-DD, otherwise null",
  "taskTime": "Extract due time if mentioned, format as HH:MM, otherwise null"
}

Common shorthand understanding:
- "round" or "visit" = a scheduled visit / inspection (client tracking task)
- "f/u" or "follow up" = follow up task
- "ref" or "ref id" = reference ID
- "site", "floor" or "branch" = location
- "asap" or "urgent" = urgent/critical priority
- "routine" = moderate priority

Rules:
1. ONLY return valid JSON, no other text
2. All fields must be present
3. Use null for optional fields that don't apply
4. Type must be exactly one of: ${Object.values(TaskType).join(', ')}
5. Priority must be exactly one of: critical, moderate, lessImportant
6. For assigneeName, extract the most relevant team member name or role from the available list
   - If no hours mentioned for tracking tasks, default to 4 hours
9. If sub-tasks are mentioned, include them in the subTasks array
10. PRESERVE ALL original values mentioned in the text, do not modify or generate new ones
11. Correct any spelling or grammar mistakes in the input text
12. Ensure the output is clear and concise for text-to-speech systems

Available team members: ${teamMembers.map(m => m.name).join(', ')}

Text to parse: ${text}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const textContent = response.text().trim();

    // Clean up the JSON string
    const jsonStr = textContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');

    // Parse the JSON string
    const taskData = JSON.parse(jsonStr);

    // Validate and process the task data
    if (!taskData.title || !taskData.description || !taskData.type || !taskData.priority) {
      throw new Error('Missing required fields in the generated task');
    }

    if (!(Object.values(TaskType) as string[]).includes(taskData.type)) {
      taskData.type = selectedType;
    }

    if (!['critical', 'moderate', 'lessImportant'].includes(taskData.priority)) {
      taskData.priority = 'moderate';
    }

    // Set default hours for tracking tasks
    if (taskData.type === TaskType.ClientTracking) {
      taskData.hoursToComplete = taskData.hoursToComplete || 4;
    } else {
      taskData.hoursToComplete = null;
    }

    // Assign the task to a team member if mentioned
    if (taskData.assigneeName) {
      const assignee = teamMembers.find(member =>
        member.name.toLowerCase().includes(taskData.assigneeName.toLowerCase())
      );
      if (assignee) {
        taskData.assignee = assignee;
      }
    }

    return taskData;
  } catch (error) {
    console.error('Error generating task:', error);
    return {
      title: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
      description: text,
      type: selectedType,
      priority: 'moderate',
      patientId: null,
      location: null,
      roundType: null,
      advisoryType: null,
      followUpType: null,
      assigneeName: null,
      hoursToComplete: null,
      contactNumber: null,
      dueDate: null,
      subTasks: []
    };
  }
};

export const generateWhatsAppMessage = async (task: any): Promise<string> => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const assigneeName = task.assignees?.[0]?.name || 'Team member';
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'Not specified';
    const priority = task.priority || 'moderate';
    
    // Get creator name
    let creatorName = 'Your team';
    if (task.createdBy) {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.id === task.createdBy) {
          creatorName = 'You';
        } else {
          const { data: creatorData } = await supabase
            .from('users')
            .select('name')
            .eq('auth_id', task.createdBy)
            .single();
          
          if (creatorData?.name) {
            creatorName = creatorData.name;
          }
        }
      } catch (err) {
        console.error('Error fetching creator name:', err);
      }
    }

    const prompt = `
Create a clear, professional, and well-formatted WhatsApp message for a work task.
Use emojis appropriately and include all relevant details in a structured format.

Task details:
Assigned to: ${assigneeName}
Created by: ${creatorName}
Title: ${task.title}
Description: ${task.description}
Priority: ${priority}
Due Date: ${dueDate}
${task.patientId ? `Reference ID: ${task.patientId}` : ''}
${task.location ? `Location: ${task.location}` : ''}
${task.roundType ? `Visit Type: ${task.roundType}` : ''}
${task.followUpType ? `Follow-up Type: ${task.followUpType}` : ''}
${task.advisoryType ? `Task Category: ${task.advisoryType}` : ''}
${task.type === TaskType.ClientTracking && task.hoursToComplete ? `Due: Complete within ${task.hoursToComplete} hours` : ''}

Required Format:
Hi [assignee name], 

This task was assigned by [creator name].

📝 Task: [task title]
🕒 Due: [due date/time]
🔴 Priority: [priority level]

[task description]

${task.location ? '📍 Location: [location]' : ''}
${task.patientId ? '👤 Reference ID: [reference ID]' : ''}

Please confirm receipt and update status accordingly.

Thanks!

IMPORTANT: 
1. DO NOT include the task type (like "regularTask") in the message
2. DO NOT include "Reference ID: N/A" if there is no reference ID
3. Keep it professional, clear, and use appropriate emojis for visual clarity.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Error generating WhatsApp message:', error);
    const assigneeName = task.assignees?.[0]?.name || 'Team member';
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'Not specified';
    
    // Fallback message with improved formatting
    return `Hi ${assigneeName},

This task was assigned by your team.

📝 Task: ${task.title}
🕒 Due: ${dueDate}
🔴 Priority: ${task.priority || 'moderate'}

${task.description}

${task.location ? `📍 Location: ${task.location}\n` : ''}
${task.patientId ? `👤 Reference ID: ${task.patientId}\n` : ''}
Please confirm receipt and update status accordingly.

Thanks!`;
  }
};