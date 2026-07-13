import type { Config } from '@docusaurus/types';
import type { Options, ThemeConfig } from '@docusaurus/preset-classic';
import { resolve } from 'node:path';

const baseUrl = normalizeBaseUrl(process.env.DOCS_BASE_URL ?? '/winception/');

const config: Config = {
  title: 'Winception 2.0',
  tagline: 'Windows 11 zero-touch deployment, with explicit safety boundaries',
  favicon: 'img/favicon.svg',
  url: 'https://davislinyd.github.io',
  baseUrl,
  organizationName: 'davislinyd',
  projectName: 'winception',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: {
    defaultLocale: 'zh-TW',
    locales: ['zh-TW', 'en'],
    localeConfigs: {
      'zh-TW': { label: '繁體中文', htmlLang: 'zh-TW' },
      en: { label: 'English', htmlLang: 'en' },
    },
  },
  presets: [
    ['classic', {
      docs: { sidebarPath: './sidebars.ts', routeBasePath: 'docs', showLastUpdateTime: true },
      blog: false,
      theme: { customCss: './src/css/custom.css' },
      sitemap: { changefreq: 'weekly', priority: 0.5 },
    } satisfies Options],
  ],
  plugins: [
    function generatedModuleCompatibility() {
      return {
        name: 'winception-generated-module-compatibility',
        configureWebpack() {
          return { module: { rules: [{ test: /\.js$/u, include: [resolve(process.cwd(), 'apps/docs/.docusaurus')], type: 'javascript/auto' }] } };
        },
      };
    },
  ],
  themeConfig: {
    colorMode: { defaultMode: 'dark', disableSwitch: false, respectPrefersColorScheme: true },
    navbar: {
      title: 'Winception 2.0',
      logo: { alt: 'Winception', src: 'img/favicon.svg' },
      items: [
        { to: '/docs/getting-started', label: '技術文件', position: 'left' },
        { to: '/docs/install', label: '互動安裝', position: 'left' },
        { type: 'localeDropdown', position: 'right' },
        { href: 'https://github.com/davislinyd/winception', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        { title: 'Product', items: [{ label: 'Getting Started', to: '/docs/getting-started' }, { label: 'Release readiness', to: '/docs/release-license' }] },
        { title: 'Project', items: [{ label: 'Source code', href: 'https://github.com/davislinyd/winception' }, { label: 'AGPL-3.0-only', href: 'https://www.gnu.org/licenses/agpl-3.0.html' }] },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Winception contributors. No warranty.`,
    },
  } satisfies ThemeConfig,
};

function normalizeBaseUrl(value: string): string {
  return `/${value.replace(/^\/+|\/+$/gu, '')}/`;
}

export default config;
