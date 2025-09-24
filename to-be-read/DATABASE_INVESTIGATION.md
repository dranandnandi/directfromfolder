# 🔍 Database Investigation Queries

## Check Failed Conversations

Use these queries in your Supabase SQL Editor to investigate the transcription issues:

### 1. Check Recent Conversation Logs with Errors
```sql
SELECT 
  id,
  employee_id,
  audio_file_url,
  duration,
  status,
  error_message,
  transcribed_text,
  created_at,
  updated_at
FROM conversation_logs 
WHERE status = 'error' 
   OR error_message IS NOT NULL
   OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
ORDER BY created_at DESC
LIMIT 20;
```

### 2. Check Audio File Sizes (if you have access to file info)
```sql
SELECT 
  id,
  audio_file_url,
  duration,
  status,
  LENGTH(transcribed_text) as transcript_length,
  created_at
FROM conversation_logs 
WHERE created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### 3. Check Conversations Stuck in Processing
```sql
SELECT 
  id,
  employee_id,
  status,
  error_message,
  created_at,
  updated_at,
  EXTRACT(EPOCH FROM (NOW() - updated_at))/60 as minutes_stuck
FROM conversation_logs 
WHERE status = 'processing'
  AND updated_at < NOW() - INTERVAL '5 minutes'
ORDER BY updated_at ASC;
```

### 4. Update Stuck Conversations to Allow Retry
```sql
-- Reset stuck conversations to pending so they can be reprocessed
UPDATE conversation_logs 
SET status = 'pending', 
    error_message = 'Reset due to stuck processing - retry with fixed function'
WHERE status = 'processing' 
  AND updated_at < NOW() - INTERVAL '10 minutes';
```

### 5. Check Environment Variables
Check in your Supabase Dashboard > Settings > Environment Variables:
- `ALLGOOGLE_KEY` should be set (used for both Gemini AI and Google Cloud Speech-to-Text)
- `SUPABASE_URL` should be set
- `SUPABASE_SERVICE_ROLE_KEY` should be set

## 🔧 Fixed Issues in Latest Deployment

### Problem: Maximum Call Stack Size Exceeded
**Root Cause**: Large audio files caused stack overflow when converting to base64
```typescript
// OLD (problematic):
const base64Audio = btoa(String.fromCharCode(...audioBytes));

// NEW (fixed):
// Process in 8KB chunks to avoid stack overflow
```

### Improvements Added:
1. **Chunked Base64 Conversion**: Processes large audio files safely
2. **File Size Limits**: 25MB maximum to prevent resource exhaustion  
3. **Better Logging**: Detailed progress tracking for debugging
4. **Error Handling**: More specific error messages

## 🎯 Next Steps

1. **Check Database**: Run the queries above to see failed conversations
2. **Test Function**: Try uploading a new conversation recording
3. **Monitor Logs**: Check the Supabase function logs for detailed output
4. **Retry Failed**: Reset any stuck conversations to retry with the fixed function

## 📊 Expected Behavior Now

With the fix deployed:
- ✅ Small audio files (< 1MB): Should work immediately
- ✅ Medium audio files (1-10MB): Should work with chunk processing
- ✅ Large audio files (10-25MB): Should work but take longer
- ❌ Huge audio files (> 25MB): Will fail with clear error message

The "Maximum call stack size exceeded" error should be completely resolved!
