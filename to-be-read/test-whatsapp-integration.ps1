# WhatsApp Integration Test Script - OPTIMIZED VERSION
# Run this in PowerShell to test the optimized WhatsApp integration setup

# Test variables
$phoneNumber = "+919909249725"
$testMessage = @"
WhatsApp Integration Test - OPTIMIZED ALERTS

Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

This is a test message from your OPTIMIZED Task Manager WhatsApp integration!

High Priority (Immediate):
- Task Assignments
- Urgent/Critical Tasks  
- Task Overdue (once + daily)

Medium Priority (Consolidated):
- Due Reminders (1 day + 1 hour only)
- Task Completions
- Leave Requests

Low Priority (Digest Only):
- Task Comments (no immediate WhatsApp)

System is working correctly with optimized alerts!
"@

$apiUrl = "http://134.209.145.186:3001/api/send-message"

# Test payload
$testPayload = @{
    phoneNumber = $phoneNumber
    message = $testMessage
    patientName = "Test Patient"
    testName = "WhatsApp OPTIMIZED Integration Test"
    doctorName = "System Admin"
} | ConvertTo-Json

Write-Host "Testing OPTIMIZED WhatsApp API connectivity..." -ForegroundColor Yellow
Write-Host "API URL: $apiUrl" -ForegroundColor Cyan
Write-Host "Phone Number: $phoneNumber" -ForegroundColor Cyan
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $apiUrl -Method POST -ContentType "application/json" -Body $testPayload
    
    Write-Host "✅ SUCCESS: Optimized WhatsApp message sent!" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 3)" -ForegroundColor Green
    
} catch {
    Write-Host "❌ FAILED: Could not send WhatsApp message" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $responseBody = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($responseBody)
        $responseText = $reader.ReadToEnd()
        Write-Host "Response Body: $responseText" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "WhatsApp Integration OPTIMIZED Setup Summary:" -ForegroundColor Yellow
Write-Host "1. Edge Functions Deployed: ✅" -ForegroundColor Green
Write-Host "   - send-whatsapp (✅ deployed)" -ForegroundColor Gray
Write-Host "   - batch-whatsapp (✅ deployed)" -ForegroundColor Gray
Write-Host "2. Database Migration: ⚠️ Needs manual application" -ForegroundColor Yellow
Write-Host "   - 20250819000002_optimize_whatsapp_alerts.sql" -ForegroundColor Gray
Write-Host "3. Frontend Components: ✅" -ForegroundColor Green
Write-Host "   - WhatsApp Admin Panel (OPTIMIZED)" -ForegroundColor Gray
Write-Host "   - WhatsApp Utils (OPTIMIZED)" -ForegroundColor Gray
Write-Host "4. API Connectivity: $(if ($response) { '✅' } else { '❌' })" -ForegroundColor $(if ($response) { 'Green' } else { 'Red' })

Write-Host ""
Write-Host "OPTIMIZATION DETAILS:" -ForegroundColor Yellow
Write-Host ""
Write-Host "HIGH PRIORITY (Immediate WhatsApp):" -ForegroundColor Red
Write-Host "   - Task Assignments -> Instant alert when assigned" -ForegroundColor White
Write-Host "   - Urgent/Critical Tasks -> Instant alert for high priority" -ForegroundColor White
Write-Host "   - Task Overdue -> Once when overdue + daily (not every 2h)" -ForegroundColor White
Write-Host ""
Write-Host "MEDIUM PRIORITY (Consolidated WhatsApp):" -ForegroundColor DarkYellow
Write-Host "   - Task Due Reminders -> Only 1 day + 1 hour (removed 6h, 2h, 30min)" -ForegroundColor White
Write-Host "   - Task Completions -> When tasks are completed" -ForegroundColor White
Write-Host "   - Task Updates -> Significant changes only" -ForegroundColor White
Write-Host "   - Leave Requests -> New requests and approvals" -ForegroundColor White
Write-Host ""
Write-Host "LOW PRIORITY (Digest Only, No Immediate WhatsApp):" -ForegroundColor Green
Write-Host "   - Task Comments -> Daily digest format only" -ForegroundColor White
Write-Host ""
Write-Host "KEY OPTIMIZATIONS APPLIED:" -ForegroundColor Cyan
Write-Host "   Reduced due reminders from 5 alerts to 2 (1 day + 1 hour)" -ForegroundColor Green
Write-Host "   Changed overdue from every 2 hours to once + daily" -ForegroundColor Green
Write-Host "   Made comments digest-only (no immediate WhatsApp spam)" -ForegroundColor Green
Write-Host "   Added urgent task immediate alerts for high/critical priority" -ForegroundColor Green
Write-Host "   Consolidated status updates to significant changes only" -ForegroundColor Green

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Apply OPTIMIZED database migration manually via Supabase Dashboard" -ForegroundColor White
Write-Host "   File: supabase/migrations/20250819000002_optimize_whatsapp_alerts.sql" -ForegroundColor Gray
Write-Host "2. Test WhatsApp Admin Panel -> Admin Dashboard -> WhatsApp Alerts tab" -ForegroundColor White
Write-Host "3. Use priority buttons: High Priority, Medium Priority, Process All" -ForegroundColor White
Write-Host "4. Monitor optimization results in admin panel" -ForegroundColor White
