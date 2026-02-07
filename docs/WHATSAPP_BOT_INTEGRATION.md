# WhatsApp Bot Integration

## Overview
Integration between WhatsApp bot (hosted on DigitalOcean) and DCP Task Management system.

## Architecture
```
WhatsApp Message → DigitalOcean Functions → Supabase Edge Functions → Database
```

## Components

### 1. Supabase Edge Functions
Location: `supabase/functions/`

#### `whatsapp-get-users`
Searches organization users for task assignment.

**Request:**
```json
{
  "organizationId": "uuid",
  "searchQuery": "john",        // Optional
  "role": "user",               // Optional
  "department": "Medical"       // Optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "uuid",
      "name": "Clinic Name"
    },
    "users": [
      {
        "id": "uuid",
        "name": "Dr. John",
        "role": "user",
        "department": "Medical",
        "whatsapp_number": "+919876543210"
      }
    ],
    "count": 1
  }
}
```

#### `whatsapp-create-task`
Creates a task from WhatsApp command.

#### `whatsapp-get-attendance`
Fetches today's attendance with present/absent employee lists.

**Request:**
```json
{
  "userId": "uuid",             // Required - Creator
  "organizationId": "uuid",     // Required
  "title": "Check reports",     // Required
  "description": "...",         // Optional
  "assigneeId": "uuid",         // Optional (null = unassigned)
  "priority": "high",           // Optional (high/medium/low)
  "dueDate": "2026-01-10",      // Optional (ISO date)
  "type": "Advisory"            // Optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "task": {
      "id": "uuid",
      "title": "Check reports",
      "assigned_to_name": "Dr. John",
      "due_date": "2026-01-10",
      "created_at": "2026-01-06T10:30:00Z"
    }
  },
  "message": "Task created successfully and assigned to Dr. John"
}
```

#### `whatsapp-get-attendance`
Fetches today's attendance summary.

**Request:**
```json
{
  "organizationId": "uuid",     // Required
  "date": "2026-01-06"          // Optional (defaults to today, YYYY-MM-DD)
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "uuid",
      "name": "Clinic Name"
    },
    "date": "2026-01-06",
    "statistics": {
      "total_employees": 15,
      "present_count": 12,
      "absent_count": 3,
      "late_count": 2,
      "early_out_count": 1,
      "attendance_percentage": 80
    },
    "present": [
      {
        "id": "uuid",
        "name": "Dr. John",
        "department": "Medical",
        "whatsapp_number": "+919876543210",
        "punch_in_time": "2026-01-06T09:15:00Z",
        "punch_out_time": "2026-01-06T18:00:00Z",
        "total_hours": 8.75,
        "shift_name": "Morning Shift",
        "is_late": true,
        "is_early_out": false
      }
    ],
    "absent": [
      {
        "id": "uuid",
        "name": "Dr. Sarah",
        "department": "Medical",
        "whatsapp_number": "+919876543211"
      }
    ],
    "late": [],
    "early_out": []
  }
}
```

### 2. DigitalOcean Functions
Location: `digitalocean/`

#### `do-whatsapp-get-users.js`
Wrapper function that calls the Supabase edge function.

#### `do-whatsapp-create-task.js`
Wrapper function that calls the Supabase edge function.

#### `do-whatsapp-get-attendance.js`
Wrapper function that calls the Supabase edge function.

## Setup

### Step 1: Deploy Supabase Edge Functions
```bash
# Deploy all functions
supabase functions deploy whatsapp-get-users whatsapp-create-task whatsapp-get-attendance --no-verify-jwt
```

### Step 2: Get Service Role Key
1. Go to Supabase Dashboard → Settings → API
2. Copy the `service_role` key (NOT the anon key)
3. This key bypasses RLS and has full access

### Step 3: Configure DigitalOcean Functions
1. Update `SUPABASE_SERVICE_ROLE_KEY` in both DigitalOcean functions:
   - `do-whatsapp-get-users.js`
   - `do-whatsapp-create-task.js`

2. Deploy to DigitalOcean Functions

### Step 4: Test
```bash
# Test get users
curl -X POST https://your-digitalocean-function.com/do-whatsapp-get-users \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "550e8400-e29b-41d4-a716-446655440000"
  }'

# Test create task
curl -X POST https://your-digitalocean-function.com/do-whatsapp-create-task \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid",
    "organizationId": "org-uuid",
    "title": "Check patient reports",
    "assigneeId": "assignee-uuid",
    "priority": "high"
  }'
```

## Security

### Authentication
- Uses **service role key** authentication
- Only DigitalOcean functions can call these endpoints
- No user JWT required (bot is trusted)

### Validation
- Organization existence verified
- User-organization membership validated
- Assignee-organization membership validated
- Input sanitization on all fields

### Best Practices
1. **Keep service role key secure** - Never expose in client code
2. **Rate limiting** - Add rate limiting on DigitalOcean side
3. **Logging** - All operations are logged for audit
4. **Error handling** - Proper error messages without exposing internals

## WhatsApp Bot Integration

### Organization-User Mapping
You need to maintain a mapping table in your WhatsApp bot backend:

```sql
CREATE TABLE whatsapp_org_mapping (
  whatsapp_number TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Bot Command Flow

#### Example 1: Assign Task to Someone
```
User: /task assign @Dr.John Check patient blood reports urgent
Bot: Searching team members...
Bot: Found Dr. John (Medical)
Bot: ✅ Task created and assigned to Dr. John
     Priority: High
     Due: Today
```

**Backend Logic:**
1. Parse command: `/task assign @Dr.John ...`
2. Look up user's organization from mapping table
3. Call `do-whatsapp-get-users` with searchQuery="Dr.John"
4. Call `do-whatsapp-create-task` with assigneeId

#### Example 2: Create Self Reminder
```
User: /remind me Call pharmacy at 3pm
Bot: ✅ Reminder set for yourself
     Due: Today 3:00 PM
```

**Backend Logic:**
1. Parse command: `/remind me ...`
2. Look up user's ID from mapping table
3. Call `do-whatsapp-create-task` with assigneeId=userId (self-assign)

#### Example 3: List Team Members
```
User: /team list medical
Bot: Team members (Medical):
     1. Dr. John (+919876543210)
     2. Dr. Sarah (+919876543211)
     3. Nurse Alice (+919876543212)
```

**Backend Logic:**
1. Parse command: `/team list medical`
2. Look up organization from mapping table
3. Call `do-whatsapp-get-users` with department="Medical"

#### Example 4: Check Today's Attendance
```
User: /attendance today
Bot: 📊 Attendance Report (2026-01-06)
     Total: 15 employees
     ✅ Present: 12 (80%)
     ❌ Absent: 3
     ⚠️ Late: 2
     
     Absent Today:
     • Dr. Sarah (Medical)
     • Nurse Tom (Nursing)
     • Admin Alice (Management)
```

**Backend Logic:**
1. Parse command: `/attendance today`
2. Look up organization from mapping table
3. Call `do-whatsapp-get-attendance` with organizationId
4. Format and display summary

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Unauthorized: Invalid service role key` | Wrong key used | Use service_role key from Supabase dashboard |
| `Organization not found` | Invalid org ID | Verify organizationId in mapping table |
| `User not found` | Invalid user ID | Verify userId in mapping table |
| `User does not belong to this organization` | Mismatched org | Update mapping table |
| `Assignee not found` | Invalid assignee | Search users first before assigning |

## Monitoring

### Logs Location
- **Supabase Edge Functions**: Dashboard → Functions → Logs
- **DigitalOcean Functions**: DigitalOcean Dashboard → Functions → Logs

### Key Metrics
- Request count per hour
- Success/failure rate
- Average response time
- Common error types

## Future Enhancements
1. **Bulk task creation** - Create multiple tasks at once
2. **Task updates** - Update task status from WhatsApp
3. **Rich task queries** - Search tasks by filters
4. **File attachments** - Support image/document uploads
5. **Notifications** - Send WhatsApp notifications when assigned

## Support
For issues or questions, check:
1. Supabase function logs
2. DigitalOcean function logs
3. Database RLS policies
4. Service role key validity
