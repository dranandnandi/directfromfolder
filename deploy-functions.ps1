# Supabase Edge Functions Deployment Script for Windows
# This script will install Supabase CLI if needed and deploy functions

Write-Host "🚀 Deploying Supabase Edge Functions..." -ForegroundColor Green

# Check if supabase is available globally or locally
$supabaseCmd = "supabase"
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    if (Test-Path "supabase.exe") {
        $supabaseCmd = ".\supabase.exe"
        Write-Host "ℹ️ Using local Supabase CLI" -ForegroundColor Yellow
    } else {
        Write-Host "⬇️ Downloading Supabase CLI..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri "https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.tar.gz" -OutFile "supabase.tar.gz"
        tar -xzf supabase.tar.gz
        Remove-Item supabase.tar.gz
        $supabaseCmd = ".\supabase.exe"
        Write-Host "✅ Supabase CLI downloaded" -ForegroundColor Green
    }
}

# Deploy process-conversation function (main audio processing)
Write-Host "📼 Deploying process-conversation function..." -ForegroundColor Yellow
& $supabaseCmd functions deploy process-conversation

# Deploy analyze-conversation function (manual analysis)
Write-Host "🔍 Deploying analyze-conversation function..." -ForegroundColor Yellow
& $supabaseCmd functions deploy analyze-conversation

Write-Host "✅ All edge functions deployed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Set environment variables in Supabase Dashboard:" -ForegroundColor White
Write-Host "   - SUPABASE_URL" -ForegroundColor Gray
Write-Host "   - SUPABASE_SERVICE_ROLE_KEY" -ForegroundColor Gray
Write-Host "   - SUPABASE_ANON_KEY" -ForegroundColor Gray
Write-Host "   - GEMINI_API_KEY (your Google Cloud API key)" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Enable required Google Cloud APIs:" -ForegroundColor White
Write-Host "   - Cloud Speech-to-Text API" -ForegroundColor Gray
Write-Host "   - Generative AI API" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Test the functions with a conversation recording" -ForegroundColor White
