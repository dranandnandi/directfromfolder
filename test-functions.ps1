# Test Supabase Edge Functions
# This script tests if the deployed functions are working

Write-Host "🧪 Testing Supabase Edge Functions..." -ForegroundColor Green

# Test process-conversation function
Write-Host "📼 Testing process-conversation function..." -ForegroundColor Yellow
$testUrl = "https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/process-conversation"

try {
    $response = Invoke-RestMethod -Uri $testUrl -Method POST -Body '{"test": true}' -ContentType "application/json"
    Write-Host "✅ process-conversation function is accessible" -ForegroundColor Green
} catch {
    Write-Host "⚠️ process-conversation function test failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test analyze-conversation function  
Write-Host "🔍 Testing analyze-conversation function..." -ForegroundColor Yellow
$testUrl2 = "https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/analyze-conversation"

try {
    $response2 = Invoke-RestMethod -Uri $testUrl2 -Method POST -Body '{"test": true}' -ContentType "application/json"
    Write-Host "✅ analyze-conversation function is accessible" -ForegroundColor Green
} catch {
    Write-Host "⚠️ analyze-conversation function test failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "📋 Function URLs:" -ForegroundColor Cyan
Write-Host "process-conversation: https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/process-conversation" -ForegroundColor Gray
Write-Host "analyze-conversation: https://hnyqfasddflqzfibtjjz.supabase.co/functions/v1/analyze-conversation" -ForegroundColor Gray
Write-Host ""
Write-Host "📊 Dashboard: https://supabase.com/dashboard/project/hnyqfasddflqzfibtjjz/functions" -ForegroundColor Cyan
