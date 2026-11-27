param(
    [ValidateRange(1, 65535)][int]$WebPort = 5173,
    [ValidateRange(1, 65535)][int]$ApiPort = 8000
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$apiDirectory = Join-Path $repositoryRoot 'apps/api'
$webDirectory = Join-Path $repositoryRoot 'apps/web'
$pythonPath = Join-Path $apiDirectory '.venv/Scripts/python.exe'
$vitePath = Join-Path $webDirectory 'node_modules/vite/bin/vite.js'

if (!(Test-Path $pythonPath) -or !(Test-Path $vitePath)) {
    throw 'Install frontend dependencies and create apps/api/.venv first; see README setup.'
}
if ($WebPort -eq $ApiPort) { throw 'Frontend and backend must use different ports.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source

function Start-Server($Executable, $Arguments, $Directory, $ApiProxyTarget = $null) {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.Arguments = $Arguments
    $startInfo.WorkingDirectory = $Directory
    $startInfo.UseShellExecute = $false
    if ($ApiProxyTarget) { $startInfo.EnvironmentVariables['API_PROXY_TARGET'] = $ApiProxyTarget }
    return [System.Diagnostics.Process]::Start($startInfo)
}

$servers = @()
try {
    $servers += Start-Server $pythonPath "-m uvicorn app.main:app --host 127.0.0.1 --port $ApiPort" $apiDirectory
    $servers += Start-Server $nodePath "`"$vitePath`" --host 127.0.0.1 --port $WebPort --strictPort --clearScreen false" $webDirectory "http://127.0.0.1:$ApiPort"
    Write-Host "Starting frontend: http://127.0.0.1:$WebPort"
    Write-Host "Starting API docs: http://127.0.0.1:$ApiPort/api/docs"
    Write-Host 'Press Ctrl+C to stop both. Restart this command after Python changes.'
    # Future: Add API readiness checks when frontend startup depends on configuration retrieval.
    while ($true) {
        foreach ($server in $servers) {
            if ($server.HasExited) { throw "Server process $($server.Id) exited with code $($server.ExitCode)." }
        }
        Start-Sleep -Milliseconds 250
    }
}
finally {
    foreach ($server in $servers) {
        if (!$server.HasExited) {
            # Terminate only process trees launched by this invocation, including Vite's helpers.
            $cleanup = Start-Server "$env:SystemRoot/System32/taskkill.exe" "/PID $($server.Id) /T /F" $repositoryRoot
            $cleanup.WaitForExit()
        }
        $server.Dispose()
    }
}
