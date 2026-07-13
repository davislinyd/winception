import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { InstallationWizard } from '../components/InstallationWizard';
import { FlowExplorer } from '../components/FlowExplorer';
import { LocalSearch } from '../components/LocalSearch';

export default function Home(): React.JSX.Element {
  const { i18n } = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh-TW';
  return (
    <Layout title={zh ? '互動安裝與技術文件' : 'Interactive setup and technical documentation'} description={zh ? 'Winception 2.0 全新 VM 安裝、PXE 與維運文件。' : 'Winception 2.0 fresh-VM installation, PXE and operations documentation.'}>
      <main className="docs-home">
        <header className="docs-hero">
          <p className="docs-kicker">WINCEPTION 2.0 · INTERNAL PRERELEASE</p>
          <h1>{zh ? '把全新 Windows 11 VM 變成可稽核的部署主機' : 'Turn a fresh Windows 11 VM into an auditable deployment host'}</h1>
          <p>{zh ? '先驗證簽章與隔離網路，再安裝、登入、Prepare runtime，最後用單一 client 與 Software Test 建立證據。' : 'Verify signatures and network isolation first, then install, sign in, prepare runtime and capture single-client and Software Test evidence.'}</p>
          <div className="docs-actions"><Link className="button button--primary" to="/docs/getting-started">{zh ? '從這裡開始' : 'Get started'}</Link><Link className="button button--secondary" to="/docs/release-license">{zh ? '查看發布狀態' : 'Release status'}</Link></div>
        </header>
        <div className="safety-banner" role="note"><strong>{zh ? '安全邊界：' : 'Safety boundary: '}</strong>{zh ? '安裝工具不會修改 NIC 或啟動 DHCP；自簽憑證只有在明確指定後才會匯入。' : 'The installer does not change NICs or start DHCP; it imports a self-signed certificate only after explicit opt-in.'}</div>
        <LocalSearch />
        <InstallationWizard compact />
        <FlowExplorer />
      </main>
    </Layout>
  );
}
