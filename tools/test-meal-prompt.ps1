# Local meal-prompt tester (Option A).
# Posts an image to the analyzeMeal endpoint running in the Firebase emulator
# and prints the AI nutrient breakdown. Touches the emulator Firestore only.
#
#   .\tools\test-meal-prompt.ps1 -ImagePath "C:\path\to\food.jpg"
#
param(
  [Parameter(Mandatory = $true)] [string] $ImagePath,
  [string] $Uri      = "http://127.0.0.1:5001/mydietitian/asia-southeast1/analyzeMeal",
  [string] $UserId   = "test-prompt",
  [string] $MimeType = "image/jpeg"
)

if (-not (Test-Path $ImagePath)) { throw "Image not found: $ImagePath" }

$b64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ImagePath))
$body = @{
  userId    = $UserId
  source    = "line"
  inputType = "image"
  imageBase64 = $b64
  mimeType  = $MimeType
} | ConvertTo-Json

Write-Host "POST $Uri  (image $([math]::Round((Get-Item $ImagePath).Length/1KB)) KB)" -ForegroundColor Cyan
$res = Invoke-RestMethod -Method Post -Uri $Uri -ContentType "application/json" -Body $body
$a = $res.analysis

Write-Host "`n=== RESULT ===" -ForegroundColor Green
Write-Host ("dish_name : {0}" -f ($a.dishName  ?? $a.dish_name))
Write-Host ("portion   : {0}" -f ($a.portionDescription ?? $a.portion_description))
Write-Host "`nnutrients :"
($a.nutrients | ConvertTo-Json -Depth 5)
Write-Host "`nhealth    :"
($a.healthRating ?? $a.health_rating | ConvertTo-Json -Depth 5)
Write-Host "`n--- full analysis ---" -ForegroundColor DarkGray
$res | ConvertTo-Json -Depth 10
