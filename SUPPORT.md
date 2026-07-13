# Support Matrix

## Product host

| Area | Supported production target |
|---|---|
| Host OS | Windows 11 Pro or Enterprise x64, organization-managed and current on security updates |
| Install | Authenticode-signed x64 MSI; bundled Node.js 24.15.0 runtime and pinned WinSW 2.12 wrapper; no host npm requirement; Windows .NET Framework 4.6.1+ |
| Management | `127.0.0.1` HTTP by default; explicit LAN HTTPS with valid LocalMachine certificate, matching DNS name, Server Authentication EKU and private key |
| Privilege | Low-privilege `Winception.Web`; LocalSystem `Winception.Agent`; ACL-protected named pipe and State |
| Browser | Current enterprise-supported Microsoft Edge or Google Chrome |
| Virtualization | Hyper-V Generation 2 for VM validation and Software Test; physical UEFI x64 laptop for final PXE acceptance |
| Deployment client | Windows 11 x64, UEFI; Secure Boot path is default |

Current internal validation uses self-signed Authenticode and TLS certificates. Their public CER files must be explicitly trusted only on approved test hosts. Public/organization certificates replace them for formal production distribution without changing application code.

v2 is not production-supported until the `TEST-RESULT.md` matrix records the same release version for signed MSI, migration, installed bundle, two consecutive four-VM rounds, one-client path, physical laptop, Software Test, torrent, Offline ISO, diagnostics/evidence, loopback and LAN HTTPS.

Unsupported: Windows Server/Linux host, ARM64 host/client, public-Internet management exposure, arbitrary command execution, unsigned release MSI, manual runtime patching, installation inside the deployment root, retired ISO path as active PXE, or using VM evidence as physical-laptop proof.

OSDCloud, Windows ADK/WinPE, aria2 and other upstream components retain their own support and licensing terms. Exact approved versions and redistributable rights must be recorded before production release.
