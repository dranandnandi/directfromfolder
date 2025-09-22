param(
    [Parameter(Mandatory=$false)]
    [string]$conversationId = ""
)

$functionUrl = "https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/process-conversation"
$audioUrl = "https://hnyqfasddflqzfibtjjz.supabase.co/storage/v1/object/public/conversation-recordings/00000000-0000-0000-0000-000000000018_2025-08-18T09-33-13-141Z.webm"

Write-Host "Testing process-conversation function" -ForegroundColor Yellow
Write-Host "Audio URL: $audioUrl" -ForegroundColor Gray
Write-Host "File size: 257117 bytes (251 KB)" -ForegroundColor Gray
Write-Host "Content-Type: audio/webm" -ForegroundColor Gray

if ($conversationId -eq "") {
    Write-Host "`n❌ Conversation ID required" -ForegroundColor Red
    Write-Host "Usage: .\test-specific-conversation.ps1 -conversationId 'your-conversation-id'" -ForegroundColor Yellow
    Write-Host "`nTo find the conversation ID, run this SQL in Supabase:" -ForegroundColor Cyan
    Write-Host "SELECT id, status, error_message FROM conversation_logs WHERE audio_file_url = '$audioUrl';" -ForegroundColor White
    exit 1
}

Write-Host "`n🧪 Testing with conversation ID: $conversationId" -ForegroundColor Cyan

# Test the function
try {
    $headers = @{
        'Content-Type' = 'application/json'
        'Authorization' = 'Bearer YOUR_SUPABASE_ANON_KEY_HERE'  # You'll need to replace this
    }
    
    $body = @{
        conversationId = $conversationId
    } | ConvertTo-Json
    
    Write-Host "Calling function..." -ForegroundColor Yellow
    
    $response = Invoke-RestMethod -Uri $functionUrl -Method POST -Headers $headers -Body $body -ErrorAction Stop
    
    Write-Host "✅ Function call successful!" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor White
    $response | ConvertTo-Json -Depth 3
    
} catch {
    Write-Host "❌ Function call failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
        
        try {
            $errorResponse = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($errorResponse)
            $errorBody = $reader.ReadToEnd()
            Write-Host "Error details: $errorBody" -ForegroundColor Red
        } catch {
            Write-Host "Could not read error details" -ForegroundColor Red
        }
    }
}

Write-Host "`n💡 Note: You may need to update the Authorization header with your actual Supabase anon key" -ForegroundColor Yellow
