# DCP Task Management Copilot Instructions

## Project Overview
This is a **hybrid mobile/web task management application** for pathology labs/healthcare organizations built with **React + TypeScript + Capacitor + Supabase**. The system features real-time task management, conversation recording/analysis, HR attendance tracking, and WhatsApp-based notifications.

## Architecture & Tech Stack

### Core Technologies
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Mobile**: Capacitor 7 (iOS/Android hybrid app)
- **Backend**: Supabase (PostgreSQL + Edge Functions + Real-time)
- **AI**: Google Generative AI (@google/generative-ai)
- **Communication**: WhatsApp Business API integration
- **Charts**: Recharts for analytics dashboards

### Key Architectural Patterns

**Multi-Platform Build System:**
```bash
npm run dev          # Web development server
npm run build        # Production web build  
npx cap sync android # Sync to Android platform
npx cap run android  # Run on Android device
```

**Supabase Edge Functions Pattern:**
- Located in `supabase/functions/`
- Deploy with `./deploy-functions.ps1` (Windows) or `./deploy-functions.sh` (Unix)
- Functions: `send-whatsapp`, `process-conversation`, `analyze-conversation`, `batch-whatsapp`

## Critical Development Workflows

### Environment Setup
```typescript
// Required environment variables in .env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GOOGLE_AI_API_KEY=your_gemini_api_key
```

### Data Layer Architecture
- **Models**: All TypeScript interfaces in `src/models/task.ts`
- **Supabase Client**: `src/utils/supabaseClient.ts` with retry logic
- **Real-time subscriptions**: Used extensively for task updates, notifications

### Component Architecture Patterns

**Lazy Loading Pattern (App.tsx):**
```typescript
const Settings = lazy(() => import('./components/Settings'));
// All major components are lazy-loaded for performance
```

**Service Layer Pattern:**
- `src/services/` contains business logic services
- `NotificationService.ts` - Capacitor local notifications
- `BackgroundSyncService.ts` - Offline data sync
- `attendanceService.ts` - HR attendance logic

## Project-Specific Conventions

### Task Management Core Types
```typescript
// From src/models/task.ts
enum TaskType {
  RegularTask = 'regularTask',
  PatientTracking = 'patientTracking', 
  AuditTask = 'auditTask',
  PersonalTask = 'personalTask'
}

enum TaskPriority {
  Critical = 'critical',
  Moderate = 'moderate', 
  LessImportant = 'lessImportant'
}
```

### Supabase Integration Patterns
- **Retry Operations**: Use `retryOperation()` from `utils/supabaseClient.ts` for all database calls
- **RLS Security**: Row Level Security enabled - check `tablescema.md` for schema
- **Real-time**: Subscribe to `tasks`, `notifications`, `conversation_logs` tables

### WhatsApp Integration Architecture
- **Frontend**: Components in `src/components/WhatsApp*` for admin panels
- **Backend**: Edge functions handle actual API calls to external WhatsApp service
- **Queue System**: `whatsapp_queue` table for message batching
- **API Endpoint**: External service at `http://134.209.145.186:3001/api/send-message`

### Conversation Recording System
- **Audio Recording**: `src/utils/audioRecorder.ts` + `SimplifiedConversationRecorder.tsx`
- **AI Analysis**: Google Gemini API integration for conversation analysis
- **Database Flow**: `conversation_logs` → `conversation_analysis` tables
- **File Storage**: Supabase Storage for audio files

## Key Integration Points

### Mobile-Specific Features (Capacitor)
```typescript
// From capacitor.config.ts
plugins: {
  PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  LocalNotifications: { smallIcon: "ic_stat_icon_config_sample" },
  SplashScreen: { launchShowDuration: 2000 }
}
```

### Android Build Configuration
- **App ID**: `com.dcptaskmanagmentapp.taskmanager`
- **Keystore**: `anandkeyfile.jks` for release builds
- **Build Path**: `android/app/build/outputs/apk/release/`

### Performance Optimizations
```typescript
// From vite.config.ts - Manual chunk splitting
manualChunks: {
  vendor: ['react', 'react-dom', 'react-icons'],
  ui: ['clsx', 'date-fns'],
  supabase: ['@supabase/supabase-js']
}
```

## Critical File Locations

- **Main App Logic**: `src/App.tsx` (1000+ lines - central routing & state)
- **Database Schema**: `tablescema.md` (reference for all table structures)
- **Android Config**: `android/app/build.gradle` + `capacitor.config.ts`
- **Deployment Scripts**: `deploy-functions.ps1/.sh` for Supabase functions
- **Edge Functions**: `supabase/functions/*/index.ts` for server-side logic

## Development Guidelines

### When Adding New Features
1. **Models First**: Define TypeScript interfaces in `src/models/`
2. **Services Layer**: Add business logic to `src/services/`
3. **Components**: Use lazy loading for major components
4. **Database**: Update schema in Supabase, document in `tablescema.md`
5. **Mobile Testing**: Always test with `npx cap run android`

### When Working with External APIs
- **WhatsApp**: Use edge functions, never direct frontend calls
- **AI Features**: Leverage Google Generative AI via `src/utils/aiUtils.ts`
- **File Uploads**: Use Supabase Storage with proper bucket policies

### Debugging Common Issues
- **Supabase Connection**: Check environment variables in `supabaseClient.ts`
- **Android Build**: Verify `google-services.json` and keystore files
- **WhatsApp Queue**: Monitor `whatsapp_queue` table for message status
- **Real-time Issues**: Check RLS policies and subscription filters

This is a **production healthcare application** - prioritize data security, offline capability, and real-time synchronization in all development decisions.