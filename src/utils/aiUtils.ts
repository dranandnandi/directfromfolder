import { GoogleGenerativeAI } from '@google/generative-ai';
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

    const prompt = `
You are a medical task parser for "${organizationName}". Convert the following text into a structured task. 
The task MUST be of type "${selectedType}".
Return ONLY a valid JSON object without any additional text or formatting.

Available team members for assignment:
${availableTeamMembers.map(member => `- ${member.name} (${member.role}, ${member.department})`).join('\n')}

Input text to parse: "${text}"

When extracting assignee information, look for:
- Exact names: "assign to Dr. Smith"
- Partial names: "give this to John" (match with John Doe)
- Roles: "assign to the nurse" (match with nurses)
- Departments: "give to cardiology team"

The JSON must follow this exact structure:
{
  "title": "Brief, clear task title",
  "description": "Detailed task description",
  "type": "${selectedType}", // This must be exactly this value
  "priority": "critical" | "moderate" | "lessImportant",
  "patientId": "If mentioned, otherwise null",
  "location": "For clinical rounds, room/location if mentioned, otherwise null",
  "roundType": "For clinical rounds: ${organizationSettings.roundTypes.join('/')}, otherwise null",
  "advisoryType": "For quick advisory: ${organizationSettings.advisoryTypes.join('/')}, otherwise null",
  "followUpType": "For follow-ups: ${organizationSettings.followUpTypes.join('/')}, otherwise null",
  "assigneeName": "Name or role mentioned for assignment (from available team members), otherwise null",
  "hoursToComplete": "For clinical rounds, extract number of hours mentioned (e.g., '4' for '4 hours'), otherwise null",
  "contactNumber": "Extract any phone number mentioned (e.g., +91-1234567890, 123-456-7890), otherwise null",
  "whatsappNumber": "Extract WhatsApp number if mentioned separately, otherwise null",
  "taskDate": "Extract due date if mentioned, format as YYYY-MM-DD, otherwise null",
  "taskTime": "Extract due time if mentioned, format as HH:MM, otherwise null"
}

Medical abbreviations understanding:
- "round" = clinical round
- "f/u" or "follow up" = follow up task
- "pt" = patient
- "ward" = location
- "stat" = urgent/critical priority
- "routine" = moderate priority
- "Dr." = doctor
- "nurse" = nursing staff

Rules:
1. ONLY return valid JSON, no other text
2. All fields must be present
3. Use null for optional fields that don't apply
4. Type must be exactly one of: quickAdvisory, clinicalRound, followUp, personalTask
5. Priority must be exactly one of: critical, moderate, lessImportant
6. For assigneeName, extract the most relevant team member name or role from the available list
   - If no hours mentioned for clinical rounds, default to 4 hours
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

    if (!['quickAdvisory', 'clinicalRound', 'followUp'].includes(taskData.type)) {
      taskData.type = 'quickAdvisory';
    }

    if (!['critical', 'moderate', 'lessImportant'].includes(taskData.priority)) {
      taskData.priority = 'moderate';
    }

    // Set default hours for clinical rounds
    if (taskData.type === 'clinicalRound') {
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
      type: 'quickAdvisory',
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
Create a clear, professional, and well-formatted WhatsApp message for a clinical task.
Use emojis appropriately and include all relevant details in a structured format.

Task details:
Assigned to: ${assigneeName}
Created by: ${creatorName}
Title: ${task.title}
Description: ${task.description}
Priority: ${priority}
Due Date: ${dueDate}
${task.patientId ? `Patient ID: ${task.patientId}` : ''}
${task.location ? `Location: ${task.location}` : ''}
${task.roundType ? `Round Type: ${task.roundType}` : ''}
${task.type === 'clinicalRound' && task.hoursToComplete ? `Due: Complete within ${task.hoursToComplete} hours` : ''}

Required Format:
Hi [assignee name], 

This task was assigned by [creator name].

📝 Task: [task title]
🕒 Due: [due date/time]
🔴 Priority: [priority level]

[task description]

${task.location ? '📍 Location: [location]' : ''}
${task.patientId ? '👤 Patient ID: [patient ID]' : ''}

Please confirm receipt and update status accordingly.

Thanks!

IMPORTANT: 
1. DO NOT include the task type (like "quickAdvisory") in the message
2. DO NOT include "Sample ID: N/A" if there is no patient ID
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
${task.patientId ? `👤 Patient ID: ${task.patientId}\n` : ''}
Please confirm receipt and update status accordingly.

Thanks!`;
  }
};