# 🔐 WhatsApp Environment & Organization Controls Setup

## 🔑 **REQUIRED SECRET KEYS / ENVIRONMENT VARIABLES**

### **1. Supabase Edge Functions Environment Variables**
Set these in your **Supabase Dashboard → Edge Functions → Settings**:

```
WHATSAPP_API_URL = http://134.209.145.186:3001/api/send-message
```

**Optional Additional Variables:**
```
WHATSAPP_API_KEY = your_api_key_if_required  # Currently not needed for your DigitalOcean API
WHATSAPP_RATE_LIMIT = 30                     # Messages per minute (default: unlimited)
WHATSAPP_TIMEOUT = 10000                     # Request timeout in milliseconds
```

### **2. Current API Configuration**
✅ **DigitalOcean WhatsApp API**: `http://134.209.145.186:3001/api/send-message`
- **Status**: Working and tested
- **Authentication**: None required (public API)
- **Rate Limits**: Handled by our application
- **Message Format**: JSON with phone and message fields

---

## 🏢 **ORGANIZATION-LEVEL WHATSAPP CONTROLS**

### **Required Database Enhancements**
New columns needed in the `organizations` table:

```sql
-- WhatsApp feature controls for organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_alerts_enabled boolean DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_api_endpoint text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_settings jsonb DEFAULT '{}';
```

### **Control Features to Implement**

#### **🔘 Master WhatsApp Toggle**
- **`whatsapp_enabled`**: Global on/off for all WhatsApp features
- **Effect**: When `false`, no WhatsApp messages sent regardless of other settings
- **UI**: Main toggle in Organization Settings

#### **⚡ Auto Alerts Toggle**  
- **`auto_alerts_enabled`**: Enable/disable automatic alert processing
- **Effect**: When `false`, only manual WhatsApp sending from admin panel
- **UI**: Secondary toggle under WhatsApp settings

#### **⚙️ Advanced Settings**
- **`whatsapp_api_endpoint`**: Custom API endpoint per organization
- **`whatsapp_settings`**: JSON for priority controls, timing, etc.

---

## 🎯 **IMPLEMENTATION PLAN**

### **Phase 1: Database Migration** 
```sql
-- Add organization-level WhatsApp controls
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_alerts_enabled boolean DEFAULT false;  
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_api_endpoint text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_settings jsonb DEFAULT '{}';
```

### **Phase 2: Frontend Controls**
- **Organization Settings Page**: Master toggles
- **WhatsApp Admin Panel**: Real-time status display
- **User Dashboard**: WhatsApp status indicator

### **Phase 3: Backend Logic Updates**
- **Edge Functions**: Check organization settings before sending
- **Notification Functions**: Respect auto_alerts_enabled flag
- **Admin Panel**: Override controls for manual processing

---

## 🛠 **DETAILED CONTROL SPECIFICATIONS**

### **🎛️ Organization Settings Interface**
```
┌─ WHATSAPP INTEGRATION SETTINGS ─────────────────┐
│                                                 │
│ ☐ Enable WhatsApp Alerts                       │
│   Master toggle for all WhatsApp features      │
│                                                 │
│ ☐ Enable Automatic Alerts                      │  
│   Auto-process alerts based on priority rules  │
│                                                 │
│ Advanced Settings:                              │
│ API Endpoint: [http://134.209.145.186:3001...] │
│ Rate Limit: [30] messages per minute           │
│                                                 │
│ Priority Configuration:                         │
│ ☑️ High Priority Alerts (Immediate)             │
│ ☑️ Medium Priority Alerts (Consolidated)        │  
│ ☐ Low Priority Alerts (Digest Only)            │
│                                                 │
│           [ Save Settings ]                     │
└─────────────────────────────────────────────────┘
```

### **📊 WhatsApp Admin Panel Status**
```
┌─ WHATSAPP STATUS ───────────────────────────────┐
│ Organization: Pathology Lab Task Manager       │
│ WhatsApp Enabled: ✅ YES | Auto Alerts: ✅ YES  │
│ API Status: ✅ Connected | Rate Limit: 30/min   │
│                                                 │
│ [ Configure Settings ] [ Test Connection ]     │
└─────────────────────────────────────────────────┘
```

### **🚦 Processing Logic**
```typescript
// Pseudo-code for sending logic
if (!organization.whatsapp_enabled) {
  return { skipped: "WhatsApp disabled for organization" };
}

if (!organization.auto_alerts_enabled && !isManualTrigger) {
  return { skipped: "Auto alerts disabled" };  
}

// Proceed with sending...
```

---

## 🔧 **CONFIGURATION STEPS**

### **Step 1: Set Environment Variables**
1. Go to **Supabase Dashboard**
2. Navigate to **Edge Functions** → **Settings**
3. Add environment variable:
   ```
   WHATSAPP_API_URL = http://134.209.145.186:3001/api/send-message
   ```

### **Step 2: Apply Database Migration**
1. Apply the existing optimization migration: `20250819000002_optimize_whatsapp_alerts.sql`
2. Apply the new organization controls migration (to be created)

### **Step 3: Configure Organization Settings**
1. Enable WhatsApp for your organization
2. Set auto alerts preference
3. Configure priority levels
4. Test connectivity

### **Step 4: Test & Verify**
1. Use WhatsApp Admin Panel to test
2. Verify organization controls work
3. Test manual vs auto processing
4. Monitor success rates

---

## 🔐 **SECURITY CONSIDERATIONS**

### **API Key Protection**
- ✅ **No API keys required** for current DigitalOcean setup
- ✅ **Environment variables** properly secured in Supabase
- ✅ **Organization isolation** - each org can have different endpoints

### **Access Controls**
- ✅ **Admin-only access** to WhatsApp settings
- ✅ **Organization-level isolation** via RLS policies  
- ✅ **Audit logging** for configuration changes

### **Rate Limiting**
- ✅ **Application-level limits** to prevent spam
- ✅ **Organization-specific limits** configurable
- ✅ **Error handling** for API failures

---

## 📋 **NEXT STEPS CHECKLIST**

### **Immediate Tasks:**
- [ ] Create organization controls database migration
- [ ] Update edge functions to check organization settings
- [ ] Add organization settings UI components
- [ ] Update WhatsApp Admin Panel with status display

### **Testing & Deployment:**
- [ ] Test organization toggle functionality
- [ ] Verify auto alerts can be disabled
- [ ] Test manual override capabilities  
- [ ] Deploy and monitor in production

### **Documentation:**
- [ ] Update admin user guide
- [ ] Create organization setup instructions
- [ ] Document troubleshooting steps

---

## 🎯 **EXPECTED OUTCOMES**

### **Organization Control:**
✅ **Master WhatsApp toggle** - Complete on/off control
✅ **Auto alerts toggle** - Manual vs automatic processing  
✅ **Custom API endpoints** - Flexibility for different providers
✅ **Priority configuration** - Fine-grained control over alert types

### **Admin Experience:**
✅ **Clear status indicators** - Know exactly what's enabled
✅ **Manual override** - Send messages even when auto is disabled
✅ **Real-time configuration** - Immediate effect of settings changes
✅ **Test capabilities** - Verify setup without affecting users

### **User Experience:**
✅ **Predictable behavior** - Users know when to expect WhatsApp alerts
✅ **Reduced noise** - Organization can tune notification levels
✅ **Reliable delivery** - Proper error handling and status tracking
✅ **Privacy protection** - Organization-level data isolation

---

This setup provides complete control over WhatsApp integration at the organization level while maintaining the optimized alert system we've already implemented! 🚀
