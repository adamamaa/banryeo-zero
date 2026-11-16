# 시연용 샘플 서류 PNG 생성. 실행:
#   powershell -NoProfile -Command "iex (Get-Content -Raw -Encoding UTF8 scripts/make-samples.ps1)"
Add-Type -AssemblyName System.Drawing
$root = Join-Path (Get-Location) 'public\sample-docs'

function New-Doc($path, $title, $sub, $rows, $issuer, $stamp) {
  $w = 1240; $h = 1754
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::White)
  $font = { param($s, $b) New-Object System.Drawing.Font('Malgun Gothic', [single]$s, $(if ($b) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular })) }
  $black = [System.Drawing.Brushes]::Black
  $gray = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 90, 90))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 60, 60)), 2
  $center = New-Object System.Drawing.StringFormat; $center.Alignment = 'Center'

  # 워터마크: 실제 서류로 오인되지 않도록
  $wm = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(28, 200, 0, 0))
  $g.TranslateTransform($w / 2, $h / 2); $g.RotateTransform(-35)
  $g.DrawString('시연용 샘플 · SAMPLE', (& $font 80 $true), $wm, 0, -70, $center)
  $g.ResetTransform()

  $g.DrawString($title, (& $font 40 $true), $black, $w / 2, 130, $center)
  $g.DrawString($sub, (& $font 18 $false), $gray, $w / 2, 215, $center)

  $y = 320; $x0 = 110; $x1 = 430; $x2 = $w - 110; $rh = 92
  foreach ($r in $rows) {
    $g.DrawRectangle($pen, $x0, $y, $x2 - $x0, $rh)
    $g.DrawLine($pen, $x1, $y, $x1, $y + $rh)
    $g.DrawString($r[0], (& $font 19 $true), $black, $x0 + 22, $y + 28)
    $g.DrawString($r[1], (& $font 19 $false), $black, $x1 + 22, $y + 28)
    $y += $rh
  }

  $g.DrawString($issuer, (& $font 26 $true), $black, $w / 2, $h - 330, $center)
  $g.DrawString('본 문서는 해커톤 시연을 위해 만든 가상의 샘플이며 실제 발급 서류가 아닙니다.', (& $font 15 $false), $gray, $w / 2, $h - 120, $center)

  if ($stamp) {
    $red = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(200, 30, 30)), 5
    $redB = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 30, 30))
    $g.DrawRectangle($red, $w - 520, $y + 60, 400, 150)
    $g.DrawString('확 정 일 자', (& $font 22 $true), $redB, $w - 320, $y + 75, $center)
    $g.DrawString($stamp, (& $font 17 $true), $redB, $w - 320, $y + 130, $center)
  }

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

foreach ($set in 'A', 'B') {
  $ok = $set -eq 'B'
  $dir = Join-Path $root $(if ($ok) { 'B_보완세트' } else { 'A_미비세트' })

  New-Doc (Join-Path $dir '주민등록등본.png') '주민등록표 (등본)' '교부용' @(
    @('발급일자', '2026. 11. 16.'),
    @('세대주 성명', '김청년 (990512-1234567)'),
    @('현 주소지', '서울특별시 관악구 봉천로 123, 301호 (봉천동)'),
    @('전입일 / 변동일', $(if ($ok) { '2025. 08. 20.' } else { '미표시' })),
    @('과거의 주소변동 사항', $(if ($ok) { '최근 5년 포함' } else { '미포함' })),
    @('세대주와의 관계', '본인')
  ) '서울특별시 관악구청장 (샘플)' $null

  New-Doc (Join-Path $dir '임대차계약서.png') '주택임대차표준계약서' '보증금 있는 월세' @(
    @('계약일', '2025. 08. 20.'),
    @('임대인 성명', '박임대'),
    @('임차인 성명', '김청년'),
    @('임차 목적물 소재지', "서울특별시 관악구 봉천로 123, $(if ($ok) { '301' } else { '302' })호"),
    @('보증금', '금 10,000,000원'),
    @('차임 (월세)', '금 750,000원 (매월 20일 지급)'),
    @('계약 기간', '2025. 08. 20. ~ 2027. 08. 19.')
  ) '임대인 박임대 (인)   임차인 김청년 (인)' $(if ($ok) { '2025. 08. 20.  제2025-004812호' } else { $null })

  New-Doc (Join-Path $dir '가족관계증명서.png') "가족관계증명서 ($(if ($ok) { '상세' } else { '일반' }))" '등록기준지: 서울특별시 관악구' @(
    @('발급일자', '2026. 11. 16.'),
    @('증명서 구분', $(if ($ok) { '상세' } else { '일반' })),
    @('본인 성명', '김청년'),
    @('출생연월일', '1999. 05. 12.'),
    @('부', '김아버지'),
    @('모', '이어머니'),
    @('주민등록번호 공개', '전부 공개')
  ) '법원행정처 전산정보중앙관리소 (샘플)' $null
}
Get-ChildItem $root -Recurse -Filter *.png | ForEach-Object { "$($_.Directory.Name)\$($_.Name)  $([math]::Round($_.Length/1KB))KB" }
