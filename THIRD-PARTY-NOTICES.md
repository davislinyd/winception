# Third-Party Notices

Winception v2 directly uses the following npm packages. The generated release SBOM is authoritative for the complete transitive dependency set and exact shipped versions.

| Component | Version validated | License |
|---|---:|---|
| Fastify, `@fastify/static`, `@fastify/swagger`, `@fastify/type-provider-typebox` | 5.10.0 / 10.1.0 / 9.8.0 / 6.1.0 | MIT |
| TypeBox | 0.34.52 | MIT |
| React / React DOM | 19.2.7 | MIT |
| bencode / bittorrent-protocol / create-torrent | 4.0.1 / 5.0.6 / 6.1.2 | MIT |
| WinSW service wrapper (`WinSW.NET461.exe`) | 2.12.0, SHA-256 `B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F` | MIT |

Development tooling includes TypeScript (Apache-2.0), Playwright (Apache-2.0), axe-core Playwright integration (MPL-2.0), Vite, ESLint and tsx (MIT). Development-only tools are not automatically part of the MSI payload.

The deployment workflow also depends on Microsoft Windows/ADK/WinPE, OSDCloud, aria2 and optional installer payloads supplied by the organization. Their licenses, redistribution rights, notices and exact approved versions are release inputs and are not granted by this repository.

Production release is blocked until legal review confirms the product license, OSDCloud/ADK/WinPE redistribution model, aria2 notice obligations, and every bundled client software payload. CI publishes a CycloneDX SBOM for that review.
