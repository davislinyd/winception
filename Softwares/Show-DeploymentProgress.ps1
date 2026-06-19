[CmdletBinding()]
param(
    [string] $ProgressPath = 'C:\ProgramData\OSDCloud\deployment-progress.json',
    [switch] $Headless,
    [ValidateRange(250, 10000)][int] $PollMilliseconds = 1000,
    [ValidateRange(1, 300)][int] $SuccessCloseSeconds = 10
)

$ErrorActionPreference = 'Stop'

function Read-ProgressState {
    if (-not (Test-Path -LiteralPath $ProgressPath -PathType Leaf)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $ProgressPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return $null
    }
}

function ConvertTo-ProgressView {
    param($State)

    $allowedStatuses = @('pending', 'running', 'succeeded', 'failed')
    $status = if ($State -and $allowedStatuses -contains [string] $State.status) { [string] $State.status } else { 'pending' }
    $total = if ($State -and $State.totalSteps -as [int]) { [int] $State.totalSteps } else { 0 }
    $completed = if ($State -and $State.completedSteps) { @($State.completedSteps) } else { @() }
    $current = if ($State) { $State.currentStep } else { $null }
    $currentIndex = if ($current -and $current.index) { [int] $current.index } else { [Math]::Min($completed.Count + 1, [Math]::Max($total, 1)) }
    $currentType = if ($current -and [string] $current.type -eq 'script') { 'SCRIPT' } else { 'APPLICATION' }
    $currentName = if ($current -and -not [string]::IsNullOrWhiteSpace([string] $current.name)) { [string] $current.name } elseif ($current) { [string] $current.id } else { '' }
    $percent = if ($total -gt 0) { [Math]::Round(($completed.Count / $total) * 100) } elseif ($status -eq 'succeeded') { 100 } else { 0 }
    $history = @($completed | ForEach-Object {
        $label = if (-not [string]::IsNullOrWhiteSpace([string] $_.name)) { [string] $_.name } else { [string] $_.id }
        $kind = if ([string] $_.type -eq 'script') { 'Script' } else { 'Application' }
        "{0}  {1}: {2}" -f ($(if ([string] $_.status -eq 'succeeded') { '[OK]' } else { '[!]' })), $kind, $label
    })

    $headline = 'Preparing this PC'
    $detail = 'Deployment is still in progress. Do not turn off or use this PC.'
    if ($status -eq 'succeeded') {
        $headline = 'Deployment complete'
        $detail = 'This PC is ready to use.'
        $percent = 100
    }
    elseif ($status -eq 'failed') {
        $headline = 'Deployment needs attention'
        $detail = 'A deployment step failed. Record the details below before returning to the desktop.'
    }

    $failure = if ($State -and $State.failure) { $State.failure } else { $null }
    $failedStep = if ($failure) { $failure.step } else { $null }
    $failureName = if ($failedStep -and -not [string]::IsNullOrWhiteSpace([string] $failedStep.name)) { [string] $failedStep.name } elseif ($failedStep) { [string] $failedStep.id } else { 'Deployment finalization' }
    $failureCategory = if ($failure -and -not [string]::IsNullOrWhiteSpace([string] $failure.category)) { [string] $failure.category } else { 'failed' }
    $failureLogPath = if ($failure -and -not [string]::IsNullOrWhiteSpace([string] $failure.logPath)) { [string] $failure.logPath } else { 'C:\Windows\Temp\osdcloud-logs' }
    $elapsedLabel = 'Elapsed: --'
    [datetimeoffset] $startedAt = [datetimeoffset]::MinValue
    if ($State -and [datetimeoffset]::TryParse([string] $State.startedAt, [ref] $startedAt)) {
        $endAt = [datetimeoffset]::Now
        [datetimeoffset] $finishedAt = [datetimeoffset]::MinValue
        if ([datetimeoffset]::TryParse([string] $State.finishedAt, [ref] $finishedAt)) {
            $endAt = $finishedAt
        }
        $elapsed = $endAt - $startedAt
        $elapsedLabel = 'Elapsed: {0:D2}:{1:D2}:{2:D2}' -f [int] $elapsed.TotalHours, $elapsed.Minutes, $elapsed.Seconds
    }

    [pscustomobject]@{
        status = $status
        headline = $headline
        detail = $detail
        progressPercent = [int] $percent
        isIndeterminate = ($status -eq 'pending' -and $total -eq 0)
        stepLabel = if ($current -and $total -gt 0) { "Step $currentIndex of $total" } elseif ($status -eq 'pending') { 'Waiting for deployment finalization to start' } else { "$($completed.Count) of $total steps completed" }
        elapsedLabel = $elapsedLabel
        currentType = $currentType
        currentName = $currentName
        history = $history
        failureName = $failureName
        failureCategory = $failureCategory
        failureLogPath = $failureLogPath
    }
}

$initialView = ConvertTo-ProgressView -State (Read-ProgressState)
if ($Headless) {
    $initialView | ConvertTo-Json -Depth 6
    return
}

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

[xml] $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        WindowStyle="None" ResizeMode="NoResize" WindowState="Maximized" Topmost="True"
        Background="#111827" Foreground="#F9FAFB" FontFamily="Segoe UI">
  <Grid Margin="72">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>
    <StackPanel Grid.Row="0" Margin="0,0,0,32">
      <TextBlock Name="Headline" FontSize="42" FontWeight="SemiBold"/>
      <TextBlock Name="Detail" FontSize="20" Foreground="#D1D5DB" Margin="0,12,0,0" TextWrapping="Wrap"/>
    </StackPanel>
    <ProgressBar Name="Progress" Grid.Row="1" Height="18" Minimum="0" Maximum="100" Foreground="#22C55E" Background="#374151"/>
    <StackPanel Grid.Row="2" Margin="0,28,0,24">
      <TextBlock Name="StepLabel" FontSize="18" Foreground="#9CA3AF"/>
      <TextBlock Name="Elapsed" FontSize="16" Foreground="#9CA3AF" Margin="0,6,0,0"/>
      <TextBlock Name="CurrentType" FontSize="15" FontWeight="Bold" Foreground="#60A5FA" Margin="0,18,0,0"/>
      <TextBlock Name="CurrentName" FontSize="32" FontWeight="SemiBold" Margin="0,6,0,0" TextWrapping="Wrap"/>
    </StackPanel>
    <Border Grid.Row="3" Background="#1F2937" CornerRadius="10" Padding="24">
      <ScrollViewer VerticalScrollBarVisibility="Auto">
        <StackPanel>
          <TextBlock Text="Completed work" FontSize="16" FontWeight="SemiBold" Foreground="#9CA3AF" Margin="0,0,0,12"/>
          <ItemsControl Name="History" FontSize="17"/>
          <StackPanel Name="FailurePanel" Visibility="Collapsed" Margin="0,28,0,0">
            <TextBlock Name="FailureName" FontSize="24" FontWeight="SemiBold" Foreground="#FCA5A5" TextWrapping="Wrap"/>
            <TextBlock Name="FailureCategory" FontSize="17" Margin="0,8,0,0"/>
            <TextBlock Name="FailureLogPath" FontSize="15" Foreground="#D1D5DB" Margin="0,8,0,0" TextWrapping="Wrap"/>
          </StackPanel>
        </StackPanel>
      </ScrollViewer>
    </Border>
    <Button Name="Acknowledge" Grid.Row="4" Content="Acknowledge and return to desktop" Visibility="Collapsed"
            HorizontalAlignment="Right" Padding="24,12" Margin="0,24,0,0" FontSize="16"/>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$headline = $window.FindName('Headline')
$detail = $window.FindName('Detail')
$progress = $window.FindName('Progress')
$stepLabel = $window.FindName('StepLabel')
$elapsed = $window.FindName('Elapsed')
$currentType = $window.FindName('CurrentType')
$currentName = $window.FindName('CurrentName')
$history = $window.FindName('History')
$failurePanel = $window.FindName('FailurePanel')
$failureName = $window.FindName('FailureName')
$failureCategory = $window.FindName('FailureCategory')
$failureLogPath = $window.FindName('FailureLogPath')
$acknowledge = $window.FindName('Acknowledge')
$script:allowClose = $false
$script:successDeadline = $null

function Update-Window {
    $view = ConvertTo-ProgressView -State (Read-ProgressState)
    $headline.Text = $view.headline
    $detail.Text = $view.detail
    $progress.Value = $view.progressPercent
    $progress.IsIndeterminate = $view.isIndeterminate
    $stepLabel.Text = $view.stepLabel
    $elapsed.Text = $view.elapsedLabel
    $currentType.Text = $view.currentType
    $currentName.Text = $view.currentName
    $history.ItemsSource = @($view.history)
    $failurePanel.Visibility = if ($view.status -eq 'failed') { 'Visible' } else { 'Collapsed' }
    $acknowledge.Visibility = if ($view.status -eq 'failed') { 'Visible' } else { 'Collapsed' }
    $failureName.Text = $view.failureName
    $failureCategory.Text = "Status: $($view.failureCategory)"
    $failureLogPath.Text = "Logs: $($view.failureLogPath)"
    if ($view.status -eq 'succeeded' -and $null -eq $script:successDeadline) {
        $script:successDeadline = (Get-Date).AddSeconds($SuccessCloseSeconds)
    }
    if ($null -ne $script:successDeadline -and (Get-Date) -ge $script:successDeadline) {
        $script:allowClose = $true
        $window.Close()
    }
}

$window.Add_Closing({
    param($sender, $eventArgs)
    if (-not $script:allowClose) {
        $eventArgs.Cancel = $true
    }
})
$acknowledge.Add_Click({
    $script:allowClose = $true
    $window.Close()
})
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds($PollMilliseconds)
$timer.Add_Tick({ Update-Window })
Update-Window
$timer.Start()
[void] $window.ShowDialog()
$timer.Stop()
