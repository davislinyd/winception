# Third-Party Notices

Winception itself is licensed under `AGPL-3.0-only`; see [LICENSE](LICENSE). That product license does not replace or relicense the third-party components listed below.

Winception v2 directly uses the following npm packages. The generated release SBOM is authoritative for the complete transitive dependency set and exact shipped versions.

| Component | Version validated | License |
|---|---:|---|
| Fastify, `@fastify/static`, `@fastify/swagger`, `@fastify/type-provider-typebox` | 5.10.0 / 10.1.0 / 9.8.0 / 6.1.0 | MIT |
| TypeBox | 0.34.52 | MIT |
| React / React DOM | 19.2.7 | MIT |
| bencode / bittorrent-protocol / create-torrent | 4.0.1 / 5.0.6 / 6.1.2 | MIT |
| Node.js runtime | 24.15.0 | MIT plus bundled upstream notices; exact `LICENSE` is included in the MSI |
| WinSW service wrapper (`WinSW.NET461.exe`) | 2.12.0, SHA-256 `B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F` | MIT |
| OSD PowerShell module | 26.4.23.1, PowerShell Gallery package SHA-256 `4E1A99C503C2F26295D03164D3C68B42D8CB9073933B87101E526A71ED5CAA4C` | GPL-3.0-only |
| OSDCloud PowerShell module | 26.4.17.1, PowerShell Gallery package SHA-256 `3172B94A29F9F30C38DCDB1C8ED08A3DB3E134BEE7B0A7A9621FBEBCEAD95693` | GPL-3.0-only |

Development tooling includes TypeScript (Apache-2.0), Playwright (Apache-2.0), axe-core Playwright integration (MPL-2.0), Vite, ESLint and tsx (MIT). Development-only tools are not automatically part of the MSI payload.

The deployment workflow also depends on Microsoft Windows/ADK/WinPE, aria2 and optional installer payloads supplied by the organization. Their licenses, redistribution rights, notices and exact approved versions are release inputs and are not granted by this repository. The exact OSD and OSDCloud module sources above are bundled without source rewriting or Winception re-signing; their original bytes are covered by the signed MSI/package manifest, and their complete GPL license text is included with each module and under `licenses/`.

The Winception product license is selected and embedded in each package. Production release still requires legal review of ADK/WinPE redistribution, aria2 notice obligations, and every bundled client software payload. Each package build embeds a CycloneDX SBOM for that review; remote CI is optional and is not required for the current local-validation phase.
