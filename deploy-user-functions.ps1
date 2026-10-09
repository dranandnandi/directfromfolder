# Deploy User Management Edge Functions
# This script deploys all edge functions related to user management

Write-Host "🚀 Deploying User Management Edge Functions..." -ForegroundColor Cyan

# Check if Supabase CLI is installed
$supabaseExists = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $supabaseExists) {
    Write-Host "❌ Supabase CLI is not installed. Please install it first:" -ForegroundColor Red
    Write-Host "   npm install -g supabase" -ForegroundColor Yellow
    exit 1
}

# Check if logged in (by trying to list projects)
try {
    $null = supabase projects list 2>&1
} catch {
    Write-Host "❌ Not logged in to Supabase. Please login first:" -ForegroundColor Red
    Write-Host "   supabase login" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "📦 Deploying create-user function..." -ForegroundColor Green
supabase functions deploy create-user --no-verify-jwt

Write-Host ""
Write-Host "📦 Deploying update-user function..." -ForegroundColor Green
supabase functions deploy update-user --no-verify-jwt

Write-Host ""
Write-Host "📦 Deploying delete-user function..." -ForegroundColor Green
supabase functions deploy delete-user --no-verify-jwt

Write-Host ""
Write-Host "Deploying reset-user-password function..." -ForegroundColor Green
supabase functions deploy reset-user-password --no-verify-jwt

Write-Host ""
Write-Host "Deploying restore-user function..." -ForegroundColor Green
supabase functions deploy restore-user --no-verify-jwt

Write-Host ""
Write-Host "✅ All user management functions deployed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Make sure to set environment variables in Supabase Dashboard:" -ForegroundColor Yellow
Write-Host "   - SUPABASE_URL"
Write-Host "   - SUPABASE_SERVICE_ROLE_KEY"
Write-Host "   - SUPABASE_ANON_KEY"
Write-Host ""
Write-Host "🔗 Test the functions at:" -ForegroundColor Cyan
Write-Host "   https://your-project.supabase.co/functions/v1/create-user"
Write-Host "   https://your-project.supabase.co/functions/v1/update-user"
Write-Host "   https://your-project.supabase.co/functions/v1/delete-user"
