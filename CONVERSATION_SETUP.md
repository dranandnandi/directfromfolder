# Conversation Analysis Setup Guide

## 🎯 Overview
The conversation analysis feature now properly transcribes audio recordings and analyzes them with AI using Google Cloud services.

## 🔧 Required Google Cloud APIs

### 1. Enable Required APIs in Google Cloud Console
Go to [Google Cloud Console](https://console.cloud.google.com/) and enable:

1. **Cloud Speech-to-Text API**
   - API Name: `speech.googleapis.com`
   - Purpose: Converts audio recordings to text
   - Pricing: $0.006 per 15 seconds (same as OpenAI Whisper)

2. **Generative AI API** 
   - API Name: `generativeai.googleapis.com`
   - Purpose: Analyzes transcribed text for conversation quality
   - Pricing: Free tier available

### 2. Get API Key
1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click "Create Credentials" → "API Key"
3. Copy the API key (you can use the same key for both services)
4. **Optional**: Restrict the key to only Speech-to-Text and Generative AI APIs for security

## 🚀 Deployment Setup

### For Netlify Deployment:
1. Build the project: `npm run build`
2. Deploy the `dist` folder to Netlify
3. Add environment variables in Netlify dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GEMINI_API_KEY` (your Google Cloud API key)

### For Supabase Edge Functions:
1. Set environment variables in Supabase dashboard (Settings > Edge Functions):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY` ⭐ **Your Google Cloud API key (works for both Speech-to-Text and Gemini)**

## 🎵 How It Works Now

### ✅ Google Cloud Flow:
1. **Record Audio** → Upload to Supabase Storage
2. **Download Audio** → Edge function downloads the actual audio file
3. **Transcribe Audio** → Google Cloud Speech-to-Text converts audio to text
4. **Analyze Text** → Google Gemini AI analyzes the transcript
5. **Store Results** → Save analysis in database

### ❌ Previous Flow (Broken):
1. ~~Record Audio → Upload to Supabase Storage~~
2. ~~Create fake transcript with URL only~~
3. ~~Pass URL to AI (which fails)~~

## � Cost Considerations

- **Google Cloud Speech-to-Text**: ~$0.006 per 15 seconds (~$0.024 per minute)
- **Google Gemini**: Free tier available (15 requests per minute)
- For a typical 5-minute conversation: ~$0.12 total
- **Advantage**: Single Google Cloud account for all services

## 🧪 Testing

1. Record a test conversation
2. Check `conversation_logs` table for the transcribed text
3. Verify the text is actual conversation content (not a URL)
4. Check `conversation_analysis` table for AI analysis results

## 🔍 Troubleshooting

### "Failed to transcribe audio"
- Check Google Cloud Speech-to-Text API is enabled
- Verify API key has access to Speech-to-Text API
- Check Supabase logs for detailed errors
- Ensure audio format is supported (WebM/OGG)

### "AI analysis failed"
- Check Google Generative AI API is enabled
- Verify API key has access to Generative AI API
- Check if API quota is exceeded

### Audio Format Issues
If transcription fails, try updating the audio encoding in the edge function:
- `WEBM_OPUS` → `OGG_OPUS` 
- Adjust `sampleRateHertz` (16000, 48000)

## 🔗 Quick Links
- [Google Cloud Console](https://console.cloud.google.com/)
- [Enable Speech-to-Text API](https://console.cloud.google.com/apis/library/speech.googleapis.com)
- [Enable Generative AI API](https://console.cloud.google.com/apis/library/generativeai.googleapis.com)
- [API Key Management](https://console.cloud.google.com/apis/credentials)
