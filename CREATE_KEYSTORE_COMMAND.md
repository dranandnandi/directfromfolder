# 🔐 Your Personal Keystore Creation Command

## Run this EXACT command in your Command Prompt:

```bash
cd "d:\task manager android app\project"
keytool -genkey -v -keystore dcp-task-management-release.keystore -alias dcp-upload -keyalg RSA -keysize 2048 -validity 10000
```

## When prompted, enter EXACTLY these details:

**Enter keystore password:** [Create a strong password - SAVE THIS!]
**Re-enter new password:** [Same password again]
**What is your first and last name?** `Anand Priyadarshi`
**What is the name of your organizational unit?** `Development`
**What is the name of your organization?** `The Doctorpreneur Academy`
**What is the name of your City or Locality?** `Ahmedabad`
**What is the name of your State or Province?** `Gujarat`
**What is the two-letter country code for this unit?** `IN`
**Is CN=Anand Priyadarshi, OU=Development, O=The Doctorpreneur Academy, L=Ahmedabad, ST=Gujarat, C=IN correct?** `yes`

**Enter key password for <dcp-upload>:** [Press ENTER to use same password]

## 📝 SAVE THIS INFORMATION SECURELY:
```
Keystore File: dcp-task-management-release.keystore
Keystore Password: [YOUR_PASSWORD]
Key Alias: dcp-upload
Key Password: [SAME_AS_KEYSTORE_PASSWORD]
Owner: CN=Anand Priyadarshi, OU=Development, O=The Doctorpreneur Academy, L=Ahmedabad, ST=Gujarat, C=IN
```

⚠️ **CRITICAL**: Write down your password! You'll need it every time you update your app!
