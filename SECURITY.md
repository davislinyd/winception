# Security Policy

## Supported versions

| Version | Security fixes |
|---|---|
| `release/v1` latest patch | Critical security and data-loss fixes only |
| v2 pre-release | Active development; not approved for production |
| Older tags | Unsupported |

Report suspected vulnerabilities through the organization-approved internal security incident channel. Do not include real credentials, deployment secrets, tokens, client data, raw diagnostics, or exploit details in a public issue.

Include the exact version/commit, affected service (`Winception.Web`, `Winception.Agent`, deployment data plane, installer), management bind mode, safe reproduction steps, impact and correlation IDs. Keep evidence encrypted and access-controlled.

The security boundary assumes a managed Windows 11 host, local administrator-controlled installation, an Authenticode-signed MSI, State ACLs, loopback management by default, and explicit trusted HTTPS for LAN management. The current internal-test baseline uses explicitly trusted self-signed certificates; public/organization certificates replace them for formal distribution. A clone, unsigned package, disabled ACL, plaintext secret, arbitrary PowerShell path, expired certificate, skipped release test or unverified runtime is not a supported production configuration.

Security responses must preserve v1 State and deployment evidence, redact privileged output, and use a new patch version/tag. Public disclosure timing is coordinated by the owning organization.
