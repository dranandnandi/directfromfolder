# 🎙️ Whisper.cpp Integration Setup Guide

## Overview
This guide explains how to set up Whisper.cpp integration in your Supabase Edge Functions for offline speech-to-text transcription.

## Architecture
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Web App        │    │  Edge Function   │    │  Whisper.cpp    │
│  (Recording)    │───▶│  (Processing)    │───▶│  (Local STT)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Google Cloud    │
                       │  Speech-to-Text  │
                       │  (Fallback)      │
                       └──────────────────┘
```

## Current Implementation Status

### ✅ Completed Features
- **Hybrid Transcription Pipeline**: Multiple transcription methods with fallback
- **Google Cloud Speech-to-Text**: Primary cloud-based transcription
- **Real-time Web Speech API**: Browser-based live transcription
- **Fallback System**: Graceful degradation when services are unavailable

### 🔄 In Progress
- **Whisper.cpp Integration**: Local edge function transcription (architecture ready)
- **Model Optimization**: Performance tuning for edge deployment

## Whisper.cpp Setup Instructions

### 1. Edge Function Environment Setup

The edge function already includes Whisper.cpp integration code. To enable it:

```bash
# 1. Set environment variables in Supabase Dashboard
WHISPER_CPP_PATH=/usr/local/bin/whisper
WHISPER_MODEL_PATH=/models/ggml-base.en.bin

# 2. Deploy updated edge function
supabase functions deploy process-conversation
```

### 2. Whisper Model Setup

Choose your model based on accuracy vs. speed requirements:

| Model | Size | Speed | Accuracy | Use Case |
|-------|------|-------|----------|----------|
| tiny.en | 39 MB | Fastest | Good | Real-time, mobile |
| base.en | 142 MB | Fast | Better | Edge functions |
| small.en | 244 MB | Medium | Good | Production |
| medium.en | 769 MB | Slow | Excellent | High accuracy |

**Recommended for edge functions**: `base.en` (good balance)

### 3. Container Configuration (If Using Docker)

```dockerfile
# Add to your edge function container
FROM deno:latest

# Install whisper.cpp
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/ggerganov/whisper.cpp.git \
    && cd whisper.cpp \
    && make \
    && cp main /usr/local/bin/whisper

# Download model
RUN mkdir -p /models \
    && wget -O /models/ggml-base.en.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

### 4. Local Development Setup

For testing Whisper.cpp locally:

```bash
# Install whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
make

# Download model
./models/download-ggml-model.sh base.en

# Test transcription
./main -m models/ggml-base.en.bin -f test.wav
```

## Transcription Flow

### Current Implementation
```typescript
async function transcribeAudioFile(audioUrl: string): Promise<string> {
  // Method 1: Try Whisper.cpp (local/offline)
  try {
    const whisperTranscript = await transcribeWithWhisper(audioBlob);
    if (whisperTranscript) return whisperTranscript;
  } catch (error) {
    console.log("Whisper.cpp not available, trying Google Speech-to-Text");
  }

  // Method 2: Google Cloud Speech-to-Text (cloud)
  try {
    const googleTranscript = await transcribeWithGoogleSpeech(audioBlob, apiKey);
    if (googleTranscript) return googleTranscript;
  } catch (error) {
    console.error("Google Speech-to-Text failed:", error);
  }

  // Method 3: Fallback placeholder
  return generateFallbackTranscript(audioUrl);
}
```

## Performance Considerations

### Latency Comparison
- **Web Speech API** (Real-time): ~0ms (instant)
- **Whisper.cpp** (Local): ~2-5 seconds
- **Google Cloud** (Network): ~1-3 seconds
- **Combined Approach**: Best of both worlds

### Cost Analysis
- **Web Speech API**: Free (browser-based)
- **Whisper.cpp**: Free (self-hosted)
- **Google Cloud**: $0.006/15-second chunk
- **Hybrid Approach**: Minimal cloud costs

## Environment Variables

Add these to your Supabase project settings:

```bash
# Required for Google Cloud Speech-to-Text
GOOGLE_CLOUD_API_KEY=your_google_cloud_api_key

# Optional for Whisper.cpp
WHISPER_CPP_PATH=/usr/local/bin/whisper
WHISPER_MODEL_PATH=/models/ggml-base.en.bin

# Existing Gemini API
GEMINI_API_KEY=your_gemini_api_key
```

## Testing

### 1. Test Transcription Methods
```bash
# Test Google Cloud Speech-to-Text
curl -X POST https://your-project.supabase.co/functions/v1/process-conversation \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"audio_url": "https://your-audio-file.wav"}'

# Check logs
supabase functions logs process-conversation
```

### 2. Monitor Performance
```bash
# Check transcription times in logs
supabase functions logs process-conversation --follow
```

## Deployment Steps

### 1. Update Edge Functions
```bash
# Deploy with Whisper support
supabase functions deploy process-conversation
supabase functions deploy analyze-conversation
```

### 2. Test Integration
```bash
# Run test script
powershell .\test-functions.ps1
```

### 3. Monitor Health
```bash
# Check function status
supabase functions list
```

## Troubleshooting

### Common Issues

1. **Whisper.cpp not found**
   - Check `WHISPER_CPP_PATH` environment variable
   - Verify binary is installed in edge function container

2. **Model not found**
   - Check `WHISPER_MODEL_PATH` environment variable
   - Ensure model file is accessible

3. **Transcription fails**
   - Check audio format compatibility (WAV, MP3, OGG)
   - Verify audio file size limits

4. **Performance issues**
   - Use smaller Whisper models for faster processing
   - Implement audio preprocessing (noise reduction)

### Fallback Behavior
The system is designed to gracefully fall back:
1. Whisper.cpp (fastest, offline)
2. Google Speech-to-Text (reliable, cloud)
3. Placeholder transcript (always works)

## Next Steps

1. **Enable Whisper.cpp**: Set up container environment
2. **Performance Testing**: Benchmark different models
3. **Model Optimization**: Fine-tune for your audio characteristics
4. **Monitoring**: Set up alerting for transcription failures
5. **Scaling**: Implement audio preprocessing pipeline

## Related Files
- `supabase/functions/process-conversation/index.ts` - Main transcription logic
- `src/utils/voiceUtils.ts` - Web Speech API integration
- `src/components/ConversationRecorder.tsx` - Recording interface
- `test-functions.ps1` - Testing utilities
