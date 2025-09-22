#!/bin/bash

# Supabase Edge Functions Deployment Script
# Make sure you have Supabase CLI installed and logged in

echo "🚀 Deploying Supabase Edge Functions..."

# Deploy process-conversation function (main audio processing)
echo "📼 Deploying process-conversation function..."
supabase functions deploy process-conversation

# Deploy analyze-conversation function (manual analysis)
echo "🔍 Deploying analyze-conversation function..."
supabase functions deploy analyze-conversation

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
