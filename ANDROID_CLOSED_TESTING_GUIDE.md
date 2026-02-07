# Android Closed Testing Release Guide
**App**: DCP Task Management  
**Package**: `com.example.taskmanagement`  
**Build System**: Gradle  
**Signing**: JKS Keystore (`anandkeyfile.jks`)

---

## Pre-Release Checklist

### ✅ Step 1: Verify Build Configuration

**File to check**: `android/app/build.gradle`

Current settings:
```gradle
versionCode 1          // Increment this for each release
versionName "1.0.0"    // Version string (e.g., "1.0.1", "1.1.0")
```

**Action**: 
1. Open `android/app/build.gradle`
2. Find line with `versionCode` and `versionName`
3. Update them:
   ```gradle
   versionCode 2          // Previous: 1, New: 2 (must increase)
   versionName "1.0.1"    // Previous: "1.0.0", New: "1.0.1"
   ```
4. Save file

**Why**: Google Play requires higher version codes for each release. Semantic versioning for user-facing version string.

---

## Step-by-Step: Build Release APK/AAB

### Step 2: Sync Gradle in Android Studio

1. **Open Android Studio**
   - Navigate to: `D:\task manager android app\project\android`
   - Double-click `android` folder → opens in Android Studio

2. **Select Project Structure**
   - Path: `File → Project Structure` (or `Ctrl+Alt+Shift+S`)
   - Verify:
     - **Project Name**: `project`
     - **SDK Location**: Correct NDK/SDK paths
     - **Project SDK**: Android API 34+ (or your target)

3. **Sync Gradle**
   - Top menu: `File → Sync Now` (or click "Sync Now" if banner appears)
   - Wait for gradle sync to complete (watch bottom status bar)

### Step 3: Generate Signed Bundle/APK

**Option A: Android App Bundle (Recommended for Play Store)**

1. **Menu Path**: `Build → Generate Signed Bundle / APK`

2. **Dialog 1 - Choose Build Type**
   - Select: **Android App Bundle**
   - Click: **Next**

3. **Dialog 2 - Key Store Path**
   ```
   Key store path: [Browse to] D:\task manager android app\project\anandkeyfile.jks
   Key store password: Anand@2025
   Key alias: myfirstkey
   Key password: Anand@2025
   ```
   - Click: **Next**

4. **Dialog 3 - Build Variants**
   - Select: **release** (not debug)
   - Click: **Finish**

5. **Wait for Build**
   - Build process starts (bottom shows progress)
   - Output: `app-release.aab` (typically in `android/app/release/` folder)
   - Success: "Build Signed Bundle finished with warnings (if any)" message

**Option B: APK (For Direct Testing)**

1. **Menu Path**: `Build → Generate Signed APK`
2. Follow same dialog steps but select **APK** instead of **Bundle**
3. Output: `app-release.apk`

---

## Step 4: Verify Build Output

### Check Generated Files

1. **Navigate to Release Folder**:
   - Path: `D:\task manager android app\project\android\app\release`
   
2. **Files Created**:
   ```
   ✅ app-release.aab          (Android App Bundle - ~50-100 MB)
   ✅ app-release.apk          (APK - ~30-60 MB)
   ✅ output.json              (Build metadata)
   ```

3. **File Size Reference**:
   - AAB: Smaller, optimized for Play Store
   - APK: Larger, but can install directly on devices

---

## Step 5: Upload to Google Play Console

### 5.1: Access Google Play Console

1. **URL**: https://play.google.com/console
2. **Login**: Use your Google account (must have Play Console access)
3. **Select App**: "DCP Task Management" / `com.example.taskmanagement`

### 5.2: Navigate to Closed Testing Track

1. **Left Menu**: `Testing → Closed Testing`
2. **Click**: **Create new release** button

### 5.3: Upload Build

1. **Upload Section**: 
   - Click: **Browse files** button
   - Select: `app-release.aab` from `android/app/release/`
   - System validates the bundle

2. **Release Notes**:
   ```
   Version 1.0.1 - Closed Testing

   New Features:
   - Updated Firebase SDK integration
   - Fixed package name to com.example.taskmanagement
   - Enhanced UI centering and layout
   - Improved notification handling
   
   Bug Fixes:
   - Fixed attendance storage issues
   - Corrected package references
   - Updated Capacitor sync
   
   Technical Updates:
   - Synced latest branch (v-before-pf-esic)
   - Firebase BoM: 34.6.0
   - Google Services Gradle: 4.4.4
   ```

3. **Review Section**:
   - Content Rating: Already completed (from previous release)
   - Check all fields

### 5.4: Add Testers

1. **Testers Section**:
   - Click: **Manage list**
   - Add email addresses of testers:
     - Your email
     - Team members' emails
   - Save list

2. **Invitation Email**:
   - Testers receive email with link to app store listing
   - Link: `https://play.google.com/apps/testing/com.example.taskmanagement`

### 5.5: Publish Release

1. **Review Everything**:
   - ✅ Bundle uploaded and passes validation
   - ✅ Release notes added
   - ✅ Testers configured
   - ✅ Content rating complete

2. **Click**: **Publish** button

3. **Wait for Processing**:
   - 2-4 hours typically for closed testing
   - Status: "Preparing release" → "Released"

---

## Step 6: Testing Setup

### 6.1: Get Testing Link

1. **After Release Published**:
   - Play Console shows: "Release available to testers"
   - Open link: `https://play.google.com/apps/testing/com.example.taskmanagement`

2. **Install on Test Device**:
   - Click: **Install** or **Update** (if already installed)
   - App downloads and installs

### 6.2: Test on Real Device

**Before Testing**, verify:
1. ✅ Firebase credentials configured
2. ✅ Supabase connection working
3. ✅ All routes accessible (see ROUTING_AUDIT_REPORT.md)
4. ✅ Notifications functioning
5. ✅ Attendance camera/selfies working

**Testing Checklist**:
- [ ] App launches without crashes
- [ ] Login with test account works
- [ ] Dashboard loads all tasks
- [ ] Navigation between pages smooth
- [ ] Notifications appear when triggered
- [ ] Punch in/out works
- [ ] Attendance selfie upload works
- [ ] Payroll pages load (if applicable)
- [ ] Settings screen accessible
- [ ] Performance acceptable

---

## Advanced: Command Line Build (Optional)

### Build via Terminal (No Android Studio GUI)

```powershell
# Navigate to android directory
cd D:\task manager android app\project\android

# Build release bundle
.\gradlew bundleRelease

# Or build APK
.\gradlew assembleRelease

# Output locations:
# - AAB: app/build/outputs/bundle/release/app-release.aab
# - APK: app/build/outputs/apk/release/app-release.apk
```

---

## Troubleshooting Common Issues

### Issue 1: Keystore Not Found
```
Error: File '...\anandkeyfile.jks' not found
```
**Solution**:
1. Verify file exists at: `D:\task manager android app\project\anandkeyfile.jks`
2. Check path in `android/app/build.gradle`: 
   ```gradle
   storeFile file('../../anandkeyfile.jks')
   ```

### Issue 2: Wrong Password
```
Error: Incorrect password for keystore
```
**Solution**:
- Keystore Password: `Anand@2025`
- Key Alias Password: `Anand@2025`
- Both must match exactly (case-sensitive)

### Issue 3: Version Code Too Low
```
Error: Version code 1 already exists in Play Store
```
**Solution**:
1. Open `android/app/build.gradle`
2. Increment `versionCode` to higher number (e.g., 2, 3)
3. Rebuild

### Issue 4: Build Fails with Gradle Error
```
Error: Plugin with id 'com.google.gms.google-services' not applied
```
**Solution**:
1. Verify `android/build.gradle` has:
   ```gradle
   classpath 'com.google.gms:google-services:4.4.4'
   ```
2. Verify `android/app/build.gradle` has:
   ```gradle
   apply plugin: 'com.google.gms.google-services'
   ```
3. Sync Gradle: `File → Sync Now`

### Issue 5: Large Bundle Size
```
Bundle size: 150+ MB
```
**Solution**:
- Use `minifyEnabled true` in `android/app/build.gradle`
- Android App Bundle automatically optimizes for app stores

---

## Post-Release Monitoring

### Monitor Crashes in Play Console

1. **Menu**: `Analytics → Crashes & ANRs`
2. **Check for**:
   - Crash rate
   - Affected user count
   - Stack traces

### View Tester Feedback

1. **Menu**: `Testing → Closed Testing`
2. **Check**:
   - Tester ratings
   - Review comments
   - Install/uninstall stats

### Update Testers

1. Fix issues identified by testers
2. Increment version code/name
3. Rebuild and re-upload
4. Publish new release to same closed testing track

---

## Next Steps: Promote to Production

**After successful closed testing**:

1. **Create Internal Testing Release**:
   - `Testing → Internal Testing` (larger tester base)
   - Repeat upload & testing

2. **Create Staged Rollout**:
   - `Production → Create new release`
   - Start with 5% → 10% → 25% → 100% rollout
   - Monitor crashes before full release

3. **Full Production Release**:
   - `Production → Create new release`
   - Available to all users on Play Store

---

## Summary Checklist

- [ ] Updated `versionCode` and `versionName` in `android/app/build.gradle`
- [ ] Synced Gradle in Android Studio
- [ ] Generated signed AAB or APK from `Build → Generate Signed Bundle/APK`
- [ ] Verified output in `android/app/release/`
- [ ] Uploaded bundle to Google Play Console
- [ ] Added release notes
- [ ] Configured testers
- [ ] Published to Closed Testing track
- [ ] Received testing link
- [ ] Installed on test device
- [ ] Verified app functionality
- [ ] Monitored for crashes

---

## File Locations Reference

| Item | Path |
|------|------|
| Android Project Root | `D:\task manager android app\project\android` |
| App Module | `D:\task manager android app\project\android\app` |
| Build Gradle (app) | `D:\task manager android app\project\android\app\build.gradle` |
| Keystore | `D:\task manager android app\project\anandkeyfile.jks` |
| Release Output | `D:\task manager android app\project\android\app\release` |
| Google Services JSON | `D:\task manager android app\project\android\app\google-services.json` |

---

## Support Resources

- **Android Studio Docs**: https://developer.android.com/studio
- **Google Play Console**: https://play.google.com/console
- **Closed Testing Guide**: https://support.google.com/googleplay/android-developer/answer/3131213
- **App Signing**: https://support.google.com/googleplay/android-developer/answer/7384423
