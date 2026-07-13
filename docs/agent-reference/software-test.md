# Agent Reference: Software Test VM

Software Test validates profile software on one dedicated, manually prepared Hyper-V Generation 2 VM. It never replaces full PXE acceptance.

- The VM must exist, be completely Off, and have the configured clean checkpoint. Saved, Paused, wrong generation or missing checkpoint fail safely.
- v2 acquires `deployment-ingress`, `profile-payload`, and `software-test-vm` together. While holding them, recheck HTTP/TFTP/DHCP stopped and Fleet empty immediately before starting. New deployment ingress cannot race into the test.
- Test payload lives only in HostTools State. Do not modify active profile, live Apps/Scripts, PXE endpoint, deployment runtime or services.
- The elevated runner restores checkpoint, starts VM, copies payload with PowerShell Direct, runs production `Install-Apps.ps1` as SYSTEM, handles controlled reboot continuation, then powers off and restores the checkpoint.
- Abort accepts only the active run, interrupts waits/installers, prevents another step, forces power-off and restores the checkpoint. Successful abort is terminal `aborted / succeeded` with no retained installation.
- Cleanup failure is fail-closed. Report a safe code/action, preserve raw diagnostics locally, and block another test until the checkpoint is repaired, VM is Off, and registration verifies it.
- Web/API expose only safe status. Never return raw PowerShell stderr, paths, scripts, URLs, command lines or secrets. Profile/image/endpoint may remain readable during a test but all conflicting mutations are rejected.

Tests must cover active ingress, active Fleet, concurrent run, invalid VM/checkpoint/profile/payload, abort during each wait, reboot codes, process crash/recovery, cleanup failure and redaction.
