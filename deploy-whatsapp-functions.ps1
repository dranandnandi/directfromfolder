# Deploy WhatsApp bot integration edge functions

Write-Host "🚀 Deploying WhatsApp Bot Integration Edge Functions..." -ForegroundColor Cyan
Write-Host ""

# Check if Supabase CLI is available
$supabaseCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseCmd) {
    Write-Host "❌ Supabase CLI not found. Please install it first." -ForegroundColor Red
    Write-Host "   https://supabase.com/docs/guides/cli" -ForegroundColor Yellow
    exit 1
}

Write-Host "📦 Deploying edge functions..." -ForegroundColor Yellow
supabase functions deploy whatsapp-get-users whatsapp-create-task whatsapp-get-attendance --no-verify-jwt

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Edge functions deployed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next Steps:" -ForegroundColor Cyan
    Write-Host "1. Get your service_role key from Supabase Dashboard:" -ForegroundColor White
    Write-Host "   Settings → API → service_role key" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Update the DigitalOcean functions:" -ForegroundColor White
    Write-Host "   - digitalocean/do-whatsapp-get-users.js" -ForegroundColor Gray
    Write-Host "   - digitalocean/do-whatsapp-create-task.js" -ForegroundColor Gray
    Write-Host "   - digitalocean/do-whatsapp-get-attendance.js" -ForegroundColor Gray
    Write-Host "   Replace SUPABASE_SERVICE_ROLE_KEY with your actual key" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Deploy to DigitalOcean Functions" -ForegroundColor White
    Write-Host ""
    Write-Host "4. Test the endpoints using the examples in docs/WHATSAPP_BOT_INTEGRATION.md" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Deployment failed. Please check the error messages above." -ForegroundColor Red
    exit 1
}
