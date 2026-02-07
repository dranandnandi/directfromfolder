#!/bin/bash

# Deploy User Management Edge Functions
# This script deploys all edge functions related to user management

echo "🚀 Deploying User Management Edge Functions..."

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI is not installed. Please install it first:"
    echo "   npm install -g supabase"
    exit 1
fi

# Check if logged in
if ! supabase projects list &> /dev/null; then
    echo "❌ Not logged in to Supabase. Please login first:"
    echo "   supabase login"
    exit 1
fi

echo ""
echo "📦 Deploying create-user function..."
supabase functions deploy create-user --no-verify-jwt

echo ""
echo "📦 Deploying update-user function..."
supabase functions deploy update-user --no-verify-jwt

echo ""
echo "📦 Deploying delete-user function..."
supabase functions deploy delete-user --no-verify-jwt

echo ""
echo "✅ All user management functions deployed successfully!"
echo ""
echo "📝 Make sure to set environment variables in Supabase Dashboard:"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_SERVICE_ROLE_KEY"
echo "   - SUPABASE_ANON_KEY"
echo ""
echo "🔗 Test the functions at:"
echo "   https://your-project.supabase.co/functions/v1/create-user"
echo "   https://your-project.supabase.co/functions/v1/update-user"
echo "   https://your-project.supabase.co/functions/v1/delete-user"
