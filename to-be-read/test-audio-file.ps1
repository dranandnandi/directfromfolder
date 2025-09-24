# Test the process-conversation function with a specific file

$audioUrl = "https://hnyqfasddflqzfibtjjz.supabase.co/storage/v1/object/public/conversation-recordings/00000000-0000-0000-0000-000000000018_2025-08-18T09-33-13-141Z.webm"

Write-Host "Testing process-conversation function with audio file:" -ForegroundColor Yellow
Write-Host $audioUrl -ForegroundColor Gray

# First, let's check if the audio file is accessible
try {
    Write-Host "`nChecking audio file accessibility..." -ForegroundColor Cyan
    $audioCheck = Invoke-WebRequest -Uri $audioUrl -Method HEAD -ErrorAction Stop
    Write-Host "✅ Audio file accessible - Size: $($audioCheck.Headers.'Content-Length') bytes" -ForegroundColor Green
    
    if ($audioCheck.Headers.'Content-Type') {
        Write-Host "   Content-Type: $($audioCheck.Headers.'Content-Type')" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Audio file not accessible: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Now test the function (you'll need to provide a valid conversation ID)
Write-Host "`nTo test the function, we need a conversation ID from your database." -ForegroundColor Yellow
Write-Host "Please run this SQL query in Supabase to find a conversation with this audio file:" -ForegroundColor Yellow
Write-Host ""
Write-Host "SELECT id, status, error_message FROM conversation_logs WHERE audio_file_url = '$audioUrl';" -ForegroundColor White
Write-Host ""
Write-Host "Then we can test with:" -ForegroundColor Yellow
Write-Host ".\test-specific-conversation.ps1 -conversationId 'your-conversation-id-here'" -ForegroundColor White
