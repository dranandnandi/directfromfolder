# Test FCM Notification with Image
# 
# HOW TO GET YOUR SERVER KEY:
# 1. Go to Firebase Console: https://console.firebase.google.com/
# 2. Select your project (taskmanagmentapp-ca2a3)
# 3. Go to Project Settings (gear icon)
# 4. Go to "Cloud Messaging" tab
# 5. Under "Cloud Messaging API (Legacy)" - enable it if disabled
# 6. Copy the "Server key"
# 7. Replace the $serverKey value below

# Your FCM Token (from the app logs)
$fcmToken = "fKqQrfJdTWChMWEnBCMs7a:APA91bFqK5ypQFJjP3El26N-5SYYqpPkwExxKgTsQG9hE-kZfj0caxXK_NF6B5jgFOlf6FIlT8HKIzrjQV4qJjMC0KmQ4Eg8jYN9JMXQ9Z7i8Wy9t_Iv1Jc"

# Your Server Key from Firebase Console (Cloud Messaging tab)
$serverKey = "YOUR_SERVER_KEY_HERE"

# Image URL to test
$imageUrl = "https://images.unsplash.com/photo-1560807707-8cc77767d783?w=400"

# Build the notification payload
$body = @{
    to = $fcmToken
    notification = @{
        title = "🖼️ Image Test!"
        body = "This notification has an image. Tap to view it in the app!"
        image = $imageUrl
    }
    data = @{
        title = "🖼️ Image Test!"
        body = "This notification has an image. Tap to view it in the app!"
        image = $imageUrl
        click_action = "FLUTTER_NOTIFICATION_CLICK"
    }
} | ConvertTo-Json -Depth 4

$headers = @{
    "Authorization" = "key=$serverKey"
    "Content-Type" = "application/json"
}

Write-Host "Sending FCM notification with image..."
Write-Host "Token: $($fcmToken.Substring(0,30))..."
Write-Host "Image URL: $imageUrl"
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "https://fcm.googleapis.com/fcm/send" -Method POST -Headers $headers -Body $body
    Write-Host "Response:" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 4
} catch {
    Write-Host "Error:" -ForegroundColor Red
    $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        Write-Host $reader.ReadToEnd()
    }
}
