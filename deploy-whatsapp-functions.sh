#!/bin/bash
# Deploy WhatsApp bot integration edge functions

echo "🚀 Deploying WhatsApp Bot Integration Edge Functions..."
echo ""

# Check if Supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first."
    echo "   https://supabase.com/docs/guides/cli"
    exit 1
fi

echo "📦 Deploying edge functions..."
supabase functions deploy whatsapp-get-users whatsapp-create-task whatsapp-get-attendance --no-verify-jwt

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Edge functions deployed successfully!"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Get your service_role key from Supabase Dashboard:"
    echo "   Settings → API → service_role key"
    echo ""
    echo "2. Update the DigitalOcean functions:"
    echo "   - digitalocean/do-whatsapp-get-users.js"
    echo "   - digitalocean/do-whatsapp-create-task.js"
    echo "   - digitalocean/do-whatsapp-get-attendance.js"
    echo "   Replace SUPABASE_SERVICE_ROLE_KEY with your actual key"
    echo ""
    echo "3. Deploy to DigitalOcean Functions"
    echo ""
    echo "4. Test the endpoints using the examples in docs/WHATSAPP_BOT_INTEGRATION.md"
    echo ""
else
    echo ""
    echo "❌ Deployment failed. Please check the error messages above."
    exit 1
fi
