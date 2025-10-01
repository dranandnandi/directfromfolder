#!/bin/bash

# Supabase Edge Functions Deployment Script
# Make sure you have Supabase CLI installed and logged in

echo "🚀 Deploying Supabase Edge Functions..."

# Deploy conversation functions
echo "📼 Deploying process-conversation function..."
supabase functions deploy process-conversation

echo "� Deploying analyze-conversation function..."
supabase functions deploy analyze-conversation

# Deploy AI functions
echo "🧠 Deploying AI functions..."
supabase functions deploy ai-ctc-composer
supabase functions deploy ai-attendance-import-intake
supabase functions deploy ai-attendance-import-validate-apply
supabase functions deploy ai-payroll-audit
supabase functions deploy ai-compliance-explainer
supabase functions deploy ai-challan-assist
supabase functions deploy ai-attendance-basis-explain
supabase functions deploy ai-compensation-assistant
supabase functions deploy ai-compensation-chat
supabase functions deploy ai-component-mapper

# Deploy attendance import workflow functions
echo "� Deploying attendance import functions..."
supabase functions deploy attendance-latest-batch-for-period
supabase functions deploy attendance-upload-file
supabase functions deploy attendance-upload-file-chunk
supabase functions deploy attendance-detect-format
supabase functions deploy attendance-save-mapping
supabase functions deploy attendance-parse-and-stage
supabase functions deploy attendance-discard-batch

echo "✅ All edge functions deployed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Set environment variables in Supabase Dashboard:"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_SERVICE_ROLE_KEY" 
echo "   - SUPABASE_ANON_KEY"
echo "   - GEMINI_API_KEY (your Google Cloud API key)"
echo ""
echo "2. Enable required Google Cloud APIs:"
echo "   - Cloud Speech-to-Text API"
echo "   - Generative AI API"
echo ""
echo "3. Test the functions with a conversation recording"
