<#
    Supabase Edge Functions Deployment Script (Windows)
    - Ensures Supabase CLI present
    - Requires SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF env vars
    - Logs in and links the project
    - Deploys all required edge functions
#>

$ErrorActionPreference = "Stop"

Write-Host "\n=== Deploying Supabase Edge Functions ===" -ForegroundColor Green

# Resolve Supabase CLI path
$supabaseCmd = "supabase"
try {
    if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
        if (Test-Path "supabase.exe") {
            $supabaseCmd = ".\supabase.exe"
            Write-Host "ℹ Using local Supabase CLI" -ForegroundColor Yellow
        } else {
            Write-Host "Downloading Supabase CLI..." -ForegroundColor Yellow
            $cliUrl = "https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.tar.gz"
            Invoke-WebRequest -Uri $cliUrl -OutFile "supabase.tar.gz"
            tar -xzf supabase.tar.gz
            Remove-Item supabase.tar.gz -Force
            if (-not (Test-Path "supabase.exe")) { throw "Supabase CLI download/extract failed." }
            $supabaseCmd = ".\supabase.exe"
            Write-Host "✔ Supabase CLI downloaded" -ForegroundColor Green
        }
    }
} catch {
    Write-Error "Failed to resolve Supabase CLI: $($_.Exception.Message)"
    exit 1
}

# Validate required env vars
if (-not $env:SUPABASE_ACCESS_TOKEN) {
    Write-Error "Environment variable SUPABASE_ACCESS_TOKEN is not set. Get a personal access token from https://supabase.com/dashboard/account/tokens and set it before running this script."
    Write-Host "Example (PowerShell):`n  $Env:SUPABASE_ACCESS_TOKEN = 'xxxx'" -ForegroundColor DarkGray
    exit 1
}
if (-not $env:SUPABASE_PROJECT_REF) {
    Write-Error "Environment variable SUPABASE_PROJECT_REF is not set. Copy your project ref from the Supabase dashboard (Settings → General) and set it before running this script."
    Write-Host "Example (PowerShell):`n  $Env:SUPABASE_PROJECT_REF = 'your-project-ref'" -ForegroundColor DarkGray
    exit 1
}

# Login and link
Write-Host "Logging in to Supabase CLI..." -ForegroundColor Yellow
& $supabaseCmd login --token $env:SUPABASE_ACCESS_TOKEN | Out-Null

Write-Host "Linking project $($env:SUPABASE_PROJECT_REF)..." -ForegroundColor Yellow
& $supabaseCmd link --project-ref $env:SUPABASE_PROJECT_REF | Out-Null

# Helper to deploy a function and stop on failure
function Deploy-Function([string]$name) {
    Write-Host "Deploying function: $name" -ForegroundColor Yellow
    & $supabaseCmd functions deploy $name
}

# Change to repo root containing supabase/functions (this script runs from project root)
if (-not (Test-Path "supabase/functions")) {
    Write-Error "Could not find 'supabase/functions' folder in the current directory: $(Get-Location)"
    exit 1
}

# Deploy functions
Deploy-Function "process-conversation"
Deploy-Function "analyze-conversation"
Deploy-Function "ai-ctc-composer"
Deploy-Function "ai-attendance-import-intake"
Deploy-Function "ai-attendance-import-validate-apply"
Deploy-Function "ai-payroll-audit"
Deploy-Function "ai-compliance-explainer"
Deploy-Function "ai-challan-assist"
Deploy-Function "ai-attendance-basis-explain"
Deploy-Function "ai-compensation-assistant"
Deploy-Function "ai-compensation-chat"
Deploy-Function "ai-component-mapper"

Write-Host "\n✔ All edge functions deployed successfully!" -ForegroundColor Green
Write-Host "\nNext steps:" -ForegroundColor Cyan
Write-Host "1) Ensure required environment variables are configured in your Supabase project:" -ForegroundColor White
Write-Host "   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, ALLGOOGLE_KEY" -ForegroundColor Gray
Write-Host "2) Enable Google Cloud APIs used by functions (Speech-to-Text, Generative AI)" -ForegroundColor White
Write-Host "3) Test the functions using your frontend or HTTP tools" -ForegroundColor White
