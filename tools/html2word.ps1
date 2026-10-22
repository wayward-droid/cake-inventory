# Converts a styled HTML file into .docx and .pdf using Microsoft Word.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/html2word.ps1 -Html in.html -Docx out.docx -Pdf out.pdf
param(
  [Parameter(Mandatory = $true)][string]$Html,
  [Parameter(Mandatory = $true)][string]$Docx,
  [Parameter(Mandatory = $true)][string]$Pdf,
  [string]$Footer = "Cake Slice Factory"
)

$ErrorActionPreference = 'Stop'

$Html = (Resolve-Path $Html).Path
$Docx = [System.IO.Path]::GetFullPath($Docx)
$Pdf  = [System.IO.Path]::GetFullPath($Pdf)

foreach ($p in @($Docx, $Pdf)) {
  $dir = [System.IO.Path]::GetDirectoryName($p)
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if (Test-Path $p) { Remove-Item $p -Force }
}

$wdFormatDocx = 16
$wdFormatPdf  = 17
$wdAlignCenter = 1

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.Options.CheckGrammarAsYouType = $false

try {
  $doc = $word.Documents.Open($Html, $false, $false)

  # simple footer with the document label and page numbers (best effort)
  try {
    $section = $doc.Sections.Item(1)
    $foot = $section.Footers.Item(1)
    if ($Footer) { $foot.Range.InsertAfter("$Footer    |    Page ") }
    $foot.PageNumbers.Add($wdAlignCenter, $true) | Out-Null
  }
  catch {
    Write-Host ("  (footer skipped: {0})" -f $_.Exception.Message)
  }

  $doc.SaveAs2($Docx, $wdFormatDocx)
  $doc.SaveAs2($Pdf,  $wdFormatPdf)

  Write-Host ("  docx -> {0}" -f $Docx)
  Write-Host ("  pdf  -> {0}" -f $Pdf)

  $doc.Close($false)
}
finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
