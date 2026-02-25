import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Debug environment variables
console.log('Environment debug:', {
  url: supabaseUrl,
  keyLength: supabaseAnonKey?.length || 0,
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseAnonKey
});

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables!', {
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 10)}...` : 'undefined'
  });
}

// Create a Supabase client with automatic retries
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  db: {
    schema: 'public'
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

// Make supabase available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).supabase = supabase;
  console.log('Supabase client attached to window object');
}

// Add a helper function to handle retries
function isErrorWithMessage(error: any): error is { message: string } {
  return error && typeof error === 'object' && typeof error.message === 'string';
}

export async function retryOperation<T = any>(
  operation: () => Promise<T> | PromiseLike<T>,
  maxRetries: number = 2,
  delay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (i > 0) {
        console.log(`Retry attempt ${i+1}/${maxRetries}`);
      } else {
        console.log('Executing operation (first attempt)');
      }
      return await operation();
    } catch (error) {
      lastError = error;
      console.error(`Operation failed (attempt ${i+1}/${maxRetries}):`, error);
      
      // Don't retry on authentication or permission errors
      if (isErrorWithMessage(error) && (
          error.message.includes('JWT') || 
          error.message.includes('permission') || 
          error.message.includes('policy') || 
          error.message.includes('auth') ||
          error.message.includes('401') ||
          error.message.includes('403'))) {
        console.warn('Not retrying due to auth/permission error');
        break;
      }
      
      if (i < maxRetries - 1) {
        const retryDelay = delay * Math.pow(2, i);
        console.log(`Waiting ${retryDelay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay)); 
      } else {
        console.warn('Maximum retry attempts reached');
      }
    }
  }
  
  console.error('All retry attempts failed');
  throw lastError;
}

export type ResolvedEntity = {
  type: 'user' | 'department' | 'shift';
  id?: string;
  name: string;
  confidence: number;
};

function scoreMatch(hay: string, needle: string) {
  const h = hay.toLowerCase().trim();
  const n = needle.toLowerCase().trim();
  if (!h || !n) return 0;
  if (h === n) return 1;
  if (h.includes(n)) return 0.85;
  const words = n.split(/\s+/).filter(Boolean);
  const hits = words.filter((w) => h.includes(w)).length;
  return hits > 0 ? Math.min(0.8, hits / words.length) : 0;
}

export const aiNative = {
  async fetchOrgContext(organizationId: string) {
    const [{ data: users, error: usersErr }, { data: shifts, error: shiftsErr }] = await Promise.all([
      supabase
        .from('users')
        .select('id,name,department')
        .eq('organization_id', organizationId)
        .limit(500),
      supabase
        .from('shifts')
        .select('id,name,start_time,end_time,is_active')
        .eq('organization_id', organizationId)
        .eq('is_active', true),
    ]);

    if (usersErr) throw usersErr;
    if (shiftsErr) throw shiftsErr;

    const departments = Array.from(new Set((users || []).map((u: any) => u.department).filter(Boolean)));
    return { users: users || [], shifts: shifts || [], departments };
  },

  async resolveEntitiesByText(organizationId: string, text: string): Promise<ResolvedEntity[]> {
    const ctx = await aiNative.fetchOrgContext(organizationId);
    const out: ResolvedEntity[] = [];

    for (const d of ctx.departments) {
      const score = scoreMatch(String(d), text);
      if (score >= 0.55) out.push({ type: 'department', name: String(d), confidence: score });
    }

    for (const s of ctx.shifts as any[]) {
      const score = scoreMatch(String(s.name), text);
      if (score >= 0.6) out.push({ type: 'shift', id: s.id, name: s.name, confidence: score });
    }

    for (const u of ctx.users as any[]) {
      const score = scoreMatch(String(u.name), text);
      if (score >= 0.72) out.push({ type: 'user', id: u.id, name: u.name, confidence: score });
    }

    return out.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
  },

  async invokeShiftConfigurator(payload: {
    organization_id: string;
    instruction_text: string;
    created_by?: string;
    policy_name?: string;
    dry_run?: boolean;
    model_preference?: 'haiku' | 'gemini';
    selected_entities?: Array<{ type: string; id?: string; name: string; confidence?: number }>;
  }) {
    return supabase.functions.invoke('ai-shift-configurator-haiky35', { body: payload });
  },

  async invokeWeeklyHydrator(payload: {
    organization_id: string;
    period_start?: string;
    period_end?: string;
    policy_id?: string;
    mode?: 'preview' | 'apply';
  }) {
    return supabase.functions.invoke('ai-weekly-attendance-hydrator-haiky35', { body: payload });
  },
};
