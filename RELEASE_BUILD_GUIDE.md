# Release Build Configuration
# Instructions for creating a signed APK/AAB for Google Play Store

## 📋 Prerequisites Checklist
- ✅ App name updated to "DCP Task Management"
- ✅ Version set to 1.0.0
- ✅ Firebase configuration verified
- ✅ All Capacitor plugins synced
- ⏳ Keystore file needs to be created
- ⏳ App icons need to be generated
- ⏳ Screenshots need to be taken

## 🔐 Step 1: Create Release Keystore
Run this command in Android Studio Terminal or Command Prompt:

```bash
keytool -genkey -v -keystore dcp-task-management-release.keystore -alias dcp-upload -keyalg RSA -keysize 2048 -validity 10000
```

**Fill in these details when prompted:**
- **Password**: Create a strong password (SAVE THIS!)
- **First and Last Name**: Your Name
- **Organization Unit**: DCP Healthcare
- **Organization**: Your Company Name
- **City**: Your City
- **State**: Your State
- **Country Code**: Your Country (e.g., US, IN, GB)

**⚠️ CRITICAL: Save this information securely!**
```
Keystore Password: [SAVE THIS]
Key Alias: dcp-upload
Key Password: [SAVE THIS]
Keystore File: dcp-task-management-release.keystore
```

## 🏗️ Step 2: Configure Gradle for Release
Add this to `android/app/build.gradle` in the `android` block:

```gradle
signingConfigs {
    release {
        storeFile file('../../dcp-task-management-release.keystore')
        storePassword 'YOUR_KEYSTORE_PASSWORD'
        keyAlias 'dcp-upload'
        keyPassword 'YOUR_KEY_PASSWORD'
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

## 📱 Step 3: Build Commands
```bash
# 1. Clean and build web app
npm run build

# 2. Sync with Android
npx cap sync android

# 3. Open Android Studio
npx cap open android
```

## 🏪 Step 4: Generate Release Build in Android Studio
1. **Menu** → **Build** → **Generate Signed Bundle/APK**
2. **Choose "Android App Bundle"** (recommended for Play Store)
3. **Select your keystore file**
4. **Enter passwords**
5. **Choose "release" build variant**
6. **Enable both signature versions**
7. **Click "Create"**

## 📂 Output Location
Your release files will be in:
```
android/app/release/
├── app-release.aab     (Upload this to Play Store)
├── app-release.apk     (For testing)
└── output-metadata.json
```

## ✅ Final Verification
Before uploading to Play Store, verify:
- [ ] App name shows as "DCP Task Management"
- [ ] Version is 1.0.0
- [ ] App launches correctly
- [ ] Firebase notifications work
- [ ] All features function properly
- [ ] No crash issues

## 📋 Play Store Upload Checklist
- [ ] App Bundle (.aab file) ready
- [ ] App screenshots taken
- [ ] Store description written
- [ ] Privacy policy URL ready
- [ ] App icons generated
- [ ] Content rating completed
