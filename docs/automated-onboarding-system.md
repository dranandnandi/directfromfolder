# Automated Onboarding System for Task Manager App

## Overview

This document outlines the complete automated onboarding flow for the Task Manager application, including user registration, organization creation, payment processing with Razorpay, team management, and WhatsApp-based authentication using Supabase as the backend.

## 🏗️ Complete Automated Onboarding Architecture

### Phase 1: Landing Page & User Registration

```tsx
// Landing Page Flow
1. Marketing Landing Page
2. Sign Up Button → Registration Modal
3. Email/Phone Registration
4. Organization Setup
5. Payment Integration
6. Team Member Invitations
7. Dashboard Access
```

### Phase 2: Database Schema Enhancement

First, let's enhance your Supabase schema to handle organizations and billing:

```sql
-- Organizations table (enhanced)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT,
  subscription_status TEXT DEFAULT 'trial', -- trial, active, suspended, cancelled
  subscription_plan TEXT DEFAULT 'basic', -- basic, premium, enterprise
  billing_email TEXT,
  billing_address JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '14 days',
  subscription_ends_at TIMESTAMPTZ,
  razorpay_customer_id TEXT,
  razorpay_subscription_id TEXT,
  max_users INTEGER DEFAULT 10,
  features JSONB DEFAULT '{"voice_commands": true, "analytics": false, "api_access": false}'
);

-- User invitations table
CREATE TABLE user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'member',
  invited_by UUID REFERENCES users(id),
  status TEXT DEFAULT 'pending', -- pending, accepted, expired
  invitation_token TEXT UNIQUE,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Billing history
CREATE TABLE billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  razorpay_payment_id TEXT,
  amount DECIMAL(10,2),
  currency TEXT DEFAULT 'INR',
  status TEXT, -- success, failed, pending
  transaction_type TEXT, -- subscription, setup_fee, addon
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OTP verification table for WhatsApp auth
CREATE TABLE otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Phase 3: WhatsApp Authentication Integration

For WhatsApp auth, you can use **WhatsApp Business API** with OTP:

```tsx
// services/WhatsAppAuthService.ts
class WhatsAppAuthService {
  private whatsappAPI = 'https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID';
  
  async sendOTP(phoneNumber: string): Promise<string> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    const message = {
      messaging_product: "whatsapp",
      to: phoneNumber,
      type: "template",
      template: {
        name: "otp_verification", // Pre-approved template
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [{ type: "text", text: otp }]
        }]
      }
    };

    await fetch(`${this.whatsappAPI}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    // Store OTP in Supabase with expiry
    await supabase.from('otp_verifications').insert({
      phone_number: phoneNumber,
      otp_code: otp,
      expires_at: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    });

    return otp;
  }

  async verifyOTP(phoneNumber: string, otpCode: string): Promise<boolean> {
    const { data } = await supabase
      .from('otp_verifications')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('otp_code', otpCode)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (data) {
      // Mark as verified
      await supabase
        .from('otp_verifications')
        .update({ verified: true })
        .eq('id', data.id);
      
      return true;
    }
    return false;
  }

  async createOrLoginUser(phoneNumber: string): Promise<any> {
    // Create user in Supabase Auth using phone
    const { data, error } = await supabase.auth.signInWithOtp({
      phone: phoneNumber
    });

    return { data, error };
  }
}
```

### Phase 4: Automated Onboarding Flow

```tsx
// components/onboarding/OnboardingFlow.tsx
const OnboardingFlow = () => {
  const [step, setStep] = useState(1);
  const [userData, setUserData] = useState({});
  const [orgData, setOrgData] = useState({});

  const steps = [
    { id: 1, title: "Personal Details", component: PersonalDetailsStep },
    { id: 2, title: "Organization Setup", component: OrganizationStep },
    { id: 3, title: "Choose Plan", component: PlanSelectionStep },
    { id: 4, title: "Payment", component: PaymentStep },
    { id: 5, title: "Team Setup", component: TeamInviteStep },
    { id: 6, title: "Welcome", component: WelcomeStep }
  ];

  const handleOnboardingComplete = async (finalData: any) => {
    try {
      // Create organization
      const { data: organization } = await supabase
        .from('organizations')
        .insert({
          name: orgData.name,
          billing_email: orgData.email,
          subscription_plan: userData.selectedPlan.id,
          subscription_status: 'active'
        })
        .select()
        .single();

      // Update user with organization
      await supabase
        .from('users')
        .update({ 
          organization_id: organization.id,
          role: 'admin'
        })
        .eq('id', userData.userId);

      // Redirect to dashboard
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('Onboarding completion error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <OnboardingProgress steps={steps} currentStep={step} />
      <StepRenderer 
        step={step} 
        userData={userData}
        orgData={orgData}
        onNext={(data) => {
          setUserData(prev => ({ ...prev, ...data }));
          setStep(step + 1);
        }}
        onComplete={handleOnboardingComplete}
      />
    </div>
  );
};

// components/onboarding/PersonalDetailsStep.tsx
const PersonalDetailsStep = ({ onNext }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    authMethod: 'email' // email or whatsapp
  });
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');

  const whatsappAuth = new WhatsAppAuthService();

  const handleSendOTP = async () => {
    if (formData.authMethod === 'whatsapp' && formData.phone) {
      await whatsappAuth.sendOTP(formData.phone);
      setOtpSent(true);
    }
  };

  const handleVerifyAndProceed = async () => {
    if (formData.authMethod === 'whatsapp') {
      const isValid = await whatsappAuth.verifyOTP(formData.phone, otp);
      if (isValid) {
        const { data } = await whatsappAuth.createOrLoginUser(formData.phone);
        onNext({ ...formData, userId: data.user?.id });
      }
    } else {
      // Email signup
      const { data } = await supabase.auth.signUp({
        email: formData.email,
        password: 'temp_password_will_be_reset'
      });
      onNext({ ...formData, userId: data.user?.id });
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Welcome! Let's get started</h2>
      
      <div className="space-y-4">
        <input
          type="text"
          placeholder="Full Name"
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          className="w-full p-3 border rounded-lg"
        />

        <div className="space-y-2">
          <label className="text-sm font-medium">Choose authentication method:</label>
          <div className="flex space-x-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="email"
                checked={formData.authMethod === 'email'}
                onChange={(e) => setFormData({...formData, authMethod: e.target.value})}
                className="mr-2"
              />
              Email
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="whatsapp"
                checked={formData.authMethod === 'whatsapp'}
                onChange={(e) => setFormData({...formData, authMethod: e.target.value})}
                className="mr-2"
              />
              WhatsApp
            </label>
          </div>
        </div>

        {formData.authMethod === 'email' ? (
          <input
            type="email"
            placeholder="Email Address"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            className="w-full p-3 border rounded-lg"
          />
        ) : (
          <div className="space-y-2">
            <div className="flex space-x-2">
              <input
                type="tel"
                placeholder="Phone Number"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className="flex-1 p-3 border rounded-lg"
              />
              <button
                onClick={handleSendOTP}
                disabled={otpSent}
                className="px-4 py-3 bg-green-600 text-white rounded-lg disabled:bg-gray-400"
              >
                {otpSent ? 'Sent' : 'Send OTP'}
              </button>
            </div>
            
            {otpSent && (
              <input
                type="text"
                placeholder="Enter OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full p-3 border rounded-lg"
              />
            )}
          </div>
        )}

        <button
          onClick={handleVerifyAndProceed}
          disabled={formData.authMethod === 'whatsapp' && !otpSent}
          className="w-full bg-blue-600 text-white p-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          Continue
        </button>
      </div>
    </div>
  );
};
```

### Phase 5: Razorpay Integration

```tsx
// services/PaymentService.ts
class PaymentService {
  private razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!
  });

  async createSubscription(organizationData: any, planData: any) {
    try {
      // Create customer
      const customer = await this.razorpay.customers.create({
        name: organizationData.name,
        email: organizationData.billing_email,
        contact: organizationData.phone
      });

      // Create subscription
      const subscription = await this.razorpay.subscriptions.create({
        plan_id: planData.razorpay_plan_id,
        customer_id: customer.id,
        quantity: organizationData.user_count || 1,
        notes: {
          organization_name: organizationData.name
        }
      });

      return { customer, subscription };
    } catch (error) {
      console.error('Payment service error:', error);
      throw error;
    }
  }

  async verifyPayment(paymentData: any) {
    const crypto = require('crypto');
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(paymentData.razorpay_payment_id + '|' + paymentData.razorpay_subscription_id)
      .digest('hex');

    return generated_signature === paymentData.razorpay_signature;
  }

  async handleWebhook(event: any) {
    switch (event.event) {
      case 'subscription.charged':
        await this.handleSuccessfulPayment(event.payload);
        break;
      case 'subscription.completed':
        await this.handleSubscriptionEnd(event.payload);
        break;
      case 'payment.failed':
        await this.handleFailedPayment(event.payload);
        break;
    }
  }

  private async handleSuccessfulPayment(payload: any) {
    const subscription = payload.subscription.entity;
    
    // Update organization status
    await supabase
      .from('organizations')
      .update({
        subscription_status: 'active',
        subscription_ends_at: new Date(subscription.current_end * 1000)
      })
      .eq('razorpay_subscription_id', subscription.id);

    // Record transaction
    await supabase
      .from('billing_transactions')
      .insert({
        razorpay_payment_id: payload.payment.entity.id,
        amount: payload.payment.entity.amount / 100,
        status: 'success',
        transaction_type: 'subscription'
      });
  }
}
```

### Phase 6: Plan Selection Component

```tsx
// components/onboarding/PlanSelectionStep.tsx
const PlanSelectionStep = ({ onNext }) => {
  const plans = [
    {
      id: 'basic',
      name: 'Basic',
      price: 999,
      currency: 'INR',
      features: [
        'Up to 10 users',
        'Basic task management',
        'Email support',
        'Mobile app access'
      ],
      razorpay_plan_id: 'plan_basic_monthly'
    },
    {
      id: 'premium',
      name: 'Premium', 
      price: 1999,
      currency: 'INR',
      features: [
        'Up to 50 users',
        'Advanced analytics',
        'WhatsApp integration',
        'Voice commands',
        'Priority support',
        'API access'
      ],
      razorpay_plan_id: 'plan_premium_monthly',
      popular: true
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 4999,
      currency: 'INR',
      features: [
        'Unlimited users',
        'Custom integrations',
        'Dedicated support',
        'On-premise deployment',
        'Advanced security',
        'Custom branding'
      ],
      razorpay_plan_id: 'plan_enterprise_monthly'
    }
  ];

  const PlanCard = ({ plan, onSelect }) => (
    <div className={`relative border-2 rounded-lg p-6 cursor-pointer transition-all ${
      plan.popular ? 'border-blue-500 shadow-lg' : 'border-gray-200 hover:border-blue-300'
    }`}>
      {plan.popular && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm">
            Most Popular
          </span>
        </div>
      )}
      
      <div className="text-center">
        <h3 className="text-xl font-bold">{plan.name}</h3>
        <div className="text-3xl font-bold text-blue-600 mt-2">
          ₹{plan.price}
          <span className="text-sm text-gray-500 font-normal">/month</span>
        </div>
      </div>

      <ul className="mt-6 space-y-3">
        {plan.features.map((feature, index) => (
          <li key={index} className="flex items-center">
            <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <button
        onClick={() => onSelect(plan)}
        className={`w-full mt-6 py-3 rounded-lg font-medium transition-colors ${
          plan.popular 
            ? 'bg-blue-600 text-white hover:bg-blue-700' 
            : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
        }`}
      >
        Choose {plan.name}
      </button>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-4">Choose Your Plan</h2>
        <p className="text-gray-600">Start with a 14-day free trial. No credit card required.</p>
      </div>
      
      <div className="grid md:grid-cols-3 gap-6">
        {plans.map(plan => (
          <PlanCard 
            key={plan.id}
            plan={plan} 
            onSelect={(selectedPlan) => onNext({ selectedPlan })}
          />
        ))}
      </div>
    </div>
  );
};
```

### Phase 7: Payment Processing Component

```tsx
// components/onboarding/PaymentStep.tsx
const PaymentStep = ({ userData, orgData, onNext }) => {
  const [processing, setProcessing] = useState(false);
  const paymentService = new PaymentService();

  const handlePayment = async () => {
    setProcessing(true);
    
    try {
      // Create organization first
      const { data: organization } = await supabase
        .from('organizations')
        .insert({
          name: orgData.name,
          billing_email: orgData.email,
          subscription_plan: userData.selectedPlan.id,
          max_users: userData.selectedPlan.id === 'basic' ? 10 : 
                     userData.selectedPlan.id === 'premium' ? 50 : 999
        })
        .select()
        .single();

      // Create subscription
      const { customer, subscription } = await paymentService.createSubscription(
        { ...orgData, organization_id: organization.id },
        userData.selectedPlan
      );

      // Update organization with payment details
      await supabase
        .from('organizations')
        .update({
          razorpay_customer_id: customer.id,
          razorpay_subscription_id: subscription.id
        })
        .eq('id', organization.id);

      // Initialize Razorpay checkout
      const options = {
        key: process.env.REACT_APP_RAZORPAY_KEY_ID,
        subscription_id: subscription.id,
        name: "Task Manager Pro",
        description: `${userData.selectedPlan.name} Plan Subscription`,
        image: "/logo.png",
        handler: async (response: any) => {
          // Verify payment
          const isValid = await paymentService.verifyPayment(response);
          
          if (isValid) {
            // Update organization status
            await supabase
              .from('organizations')
              .update({ subscription_status: 'active' })
              .eq('id', organization.id);

            onNext({ 
              organizationId: organization.id, 
              paymentId: response.razorpay_payment_id 
            });
          }
        },
        prefill: {
          name: userData.name,
          email: orgData.email,
          contact: userData.phone
        },
        theme: { 
          color: "#3B82F6" 
        },
        modal: {
          ondismiss: () => setProcessing(false)
        }
      };

      const razorpay = new (window as any).Razorpay(options);
      razorpay.open();
      
    } catch (error) {
      console.error('Payment initialization error:', error);
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Complete Your Subscription</h2>
      
      <div className="bg-gray-50 p-6 rounded-lg mb-6">
        <h3 className="font-semibold mb-4">Order Summary</h3>
        <div className="flex justify-between mb-2">
          <span>{userData.selectedPlan.name} Plan</span>
          <span>₹{userData.selectedPlan.price}/month</span>
        </div>
        <div className="flex justify-between mb-2">
          <span>Organization: {orgData.name}</span>
        </div>
        <hr className="my-4" />
        <div className="flex justify-between font-bold">
          <span>Total</span>
          <span>₹{userData.selectedPlan.price}/month</span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center text-sm text-gray-600">
          <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          14-day free trial included
        </div>
        
        <div className="flex items-center text-sm text-gray-600">
          <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Cancel anytime
        </div>

        <button
          onClick={handlePayment}
          disabled={processing}
          className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
        >
          {processing ? 'Processing...' : 'Complete Payment & Setup Organization'}
        </button>
      </div>
    </div>
  );
};
```

### Phase 8: Team Invitation System

```tsx
// services/InvitationService.ts
class InvitationService {
  async inviteUser(organizationId: string, email: string, phone: string, role: string) {
    const invitationToken = crypto.randomUUID();
    
    // Store invitation
    const { data: invitation } = await supabase
      .from('user_invitations')
      .insert({
        organization_id: organizationId,
        email,
        phone,
        role,
        invitation_token: invitationToken,
        invited_by: userData.userId
      })
      .select()
      .single();

    // Send invitation via email
    if (email) {
      await this.sendEmailInvitation(email, invitationToken, organizationId);
    }
    
    // Send invitation via WhatsApp if phone provided
    if (phone) {
      await this.sendWhatsAppInvitation(phone, invitationToken, organizationId);
    }

    return invitation;
  }

  async sendWhatsAppInvitation(phone: string, token: string, orgId: string) {
    const inviteLink = `${process.env.REACT_APP_URL}/accept-invite/${token}`;
    
    const message = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: "team_invitation",
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: "Task Manager Pro" },
            { type: "text", text: inviteLink }
          ]
        }]
      }
    };

    await fetch(`https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });
  }

  async sendEmailInvitation(email: string, token: string, orgId: string) {
    // Using Supabase Edge Functions or external email service
    const inviteLink = `${process.env.REACT_APP_URL}/accept-invite/${token}`;
    
    // Send email invitation
    await fetch('/api/send-invitation-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        inviteLink,
        organizationId: orgId
      })
    });
  }
}

// components/onboarding/TeamInviteStep.tsx
const TeamInviteStep = ({ userData, onNext }) => {
  const [teamMembers, setTeamMembers] = useState([
    { email: '', phone: '', role: 'member' }
  ]);
  const invitationService = new InvitationService();

  const addTeamMember = () => {
    setTeamMembers([...teamMembers, { email: '', phone: '', role: 'member' }]);
  };

  const removeTeamMember = (index: number) => {
    setTeamMembers(teamMembers.filter((_, i) => i !== index));
  };

  const updateTeamMember = (index: number, field: string, value: string) => {
    const updated = teamMembers.map((member, i) => 
      i === index ? { ...member, [field]: value } : member
    );
    setTeamMembers(updated);
  };

  const handleInviteTeam = async () => {
    const validMembers = teamMembers.filter(member => 
      member.email.trim() || member.phone.trim()
    );

    for (const member of validMembers) {
      if (member.email.trim() || member.phone.trim()) {
        await invitationService.inviteUser(
          userData.organizationId,
          member.email,
          member.phone,
          member.role
        );
      }
    }

    onNext({ invitedMembers: validMembers.length });
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Invite Your Team</h2>
      <p className="text-gray-600 mb-6">
        Add team members to your organization. They'll receive invitation links via email or WhatsApp.
      </p>

      <div className="space-y-4">
        {teamMembers.map((member, index) => (
          <div key={index} className="flex items-center space-x-3 p-4 border rounded-lg">
            <input
              type="email"
              placeholder="Email address"
              value={member.email}
              onChange={(e) => updateTeamMember(index, 'email', e.target.value)}
              className="flex-1 p-2 border rounded"
            />
            <input
              type="tel"
              placeholder="Phone (optional)"
              value={member.phone}
              onChange={(e) => updateTeamMember(index, 'phone', e.target.value)}
              className="flex-1 p-2 border rounded"
            />
            <select
              value={member.role}
              onChange={(e) => updateTeamMember(index, 'role', e.target.value)}
              className="p-2 border rounded"
            >
              <option value="member">Member</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            
            {teamMembers.length > 1 && (
              <button
                onClick={() => removeTeamMember(index)}
                className="text-red-500 hover:text-red-700"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-between mt-6">
        <button
          onClick={addTeamMember}
          className="text-blue-600 hover:text-blue-800"
        >
          + Add Another Member
        </button>
        
        <div className="space-x-3">
          <button
            onClick={() => onNext({ invitedMembers: 0 })}
            className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Skip for Now
          </button>
          <button
            onClick={handleInviteTeam}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Send Invitations
          </button>
        </div>
      </div>
    </div>
  );
};
```

### Phase 9: Environment Configuration

```env
# .env
REACT_APP_SUPABASE_URL=your_supabase_url
REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key
REACT_APP_RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret
WHATSAPP_ACCESS_TOKEN=your_whatsapp_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
REACT_APP_URL=https://yourapp.com
```

### Phase 10: Supabase Edge Functions

```typescript
// supabase/functions/handle-payment-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const signature = req.headers.get('x-razorpay-signature')
    const body = await req.text()
    
    // Verify webhook signature
    const crypto = await import('node:crypto')
    const expectedSignature = crypto
      .createHmac('sha256', Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!)
      .update(body)
      .digest('hex')

    if (signature !== expectedSignature) {
      return new Response('Invalid signature', { status: 400 })
    }

    const event = JSON.parse(body)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    switch (event.event) {
      case 'subscription.activated':
        await handleSubscriptionActivated(supabase, event.payload)
        break
      case 'subscription.charged':
        await handleSubscriptionCharged(supabase, event.payload)
        break
      case 'subscription.cancelled':
        await handleSubscriptionCancelled(supabase, event.payload)
        break
    }

    return new Response('OK', { headers: corsHeaders })
  } catch (error) {
    return new Response(error.message, { status: 500, headers: corsHeaders })
  }
})

async function handleSubscriptionActivated(supabase: any, payload: any) {
  const subscription = payload.subscription.entity
  
  await supabase
    .from('organizations')
    .update({
      subscription_status: 'active',
      subscription_ends_at: new Date(subscription.current_end * 1000)
    })
    .eq('razorpay_subscription_id', subscription.id)
}

async function handleSubscriptionCharged(supabase: any, payload: any) {
  const payment = payload.payment.entity
  
  await supabase
    .from('billing_transactions')
    .insert({
      razorpay_payment_id: payment.id,
      amount: payment.amount / 100,
      status: 'success',
      transaction_type: 'subscription'
    })
}
```

## 🚀 Implementation Roadmap

### Week 1: Database & Authentication Setup
- [ ] Set up enhanced Supabase schema
- [ ] Configure WhatsApp Business API
- [ ] Set up Razorpay account and plans
- [ ] Create basic onboarding flow structure

### Week 2: Core Components Development  
- [ ] Build PersonalDetailsStep with WhatsApp auth
- [ ] Create OrganizationStep component
- [ ] Develop PlanSelectionStep with pricing
- [ ] Implement PaymentStep with Razorpay

### Week 3: Team Management & Automation
- [ ] Build TeamInviteStep component
- [ ] Create InvitationService for automated invites
- [ ] Set up email/WhatsApp invitation templates
- [ ] Implement user acceptance flow

### Week 4: Payment Processing & Webhooks
- [ ] Create Supabase Edge Functions for webhooks
- [ ] Implement PaymentService with subscription management
- [ ] Set up automated billing and renewal
- [ ] Test payment flows and error handling

### Week 5: Testing & Deployment
- [ ] End-to-end testing of onboarding flow
- [ ] Load testing for concurrent signups
- [ ] Deploy to production
- [ ] Create marketing landing page

## 🎯 Key Benefits

- ✅ **Fully Automated**: Zero manual intervention after user signs up
- ✅ **WhatsApp Integration**: Modern authentication for Indian market  
- ✅ **Scalable**: Handles organizations of any size automatically
- ✅ **Revenue Optimized**: Automatic billing and subscription management
- ✅ **User-Friendly**: Progressive onboarding with clear steps
- ✅ **Mobile-First**: Optimized for mobile users in India
- ✅ **Conversion Optimized**: Streamlined flow to reduce drop-offs

## 🔐 Security Considerations

- All payment processing through Razorpay (PCI DSS compliant)
- WhatsApp OTP verification for secure authentication
- Webhook signature verification for payment events
- Supabase RLS policies for data protection
- Rate limiting on OTP requests
- Secure token-based invitation system

This comprehensive system will provide a smooth, automated onboarding experience for your Task Manager application while handling payments, team management, and user authentication seamlessly.