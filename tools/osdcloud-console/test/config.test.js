import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyProjectRoot,
  applyServiceEndpoint,
  loadConfig,
  mediaHttpServerConfig,
  saveConfig,
  validateConfig,
  webServerConfig,
  workspaceInfo,
} from '../src/config.js';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('rejects incomplete config', () => {
  assert.throws(() => validateConfig({}), /Missing required config values/);
});

test('accepts minimum config shape', () => {
  const config = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.100' },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };

  assert.equal(validateConfig(config), config);
  assert.deepEqual(config.web, { host: '127.0.0.1', port: 8080 });
});

test('validates Web management server config', () => {
  const base = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.100' },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: { expectedHttpFiles: ['osdcloud\\boot.ipxe'] },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
    web: { host: '0.0.0.0', port: '8088' },
  };

  validateConfig(base);
  assert.deepEqual(webServerConfig(base), { host: '0.0.0.0', port: 8088 });

  assert.throws(() => validateConfig({ ...base, web: { host: '', port: 8080 } }), /web\.host/);
  assert.throws(() => validateConfig({ ...base, web: { host: '127.0.0.1', port: 70000 } }), /Invalid web\.port/);
});

test('builds HTTP server config with root driver pack cache settings', () => {
  const config = {
    http: {
      root: 'C:\\PXE-HttpRoot',
      host: '192.168.100.1',
      port: 80,
      logPath: 'C:\\PXE-HttpRoot\\host-http.log',
      statusRoot: 'C:\\PXE-HttpRoot\\status',
    },
    driverPackCache: {
      enabled: true,
      root: 'C:\\OSDCloud\\Media\\OSDCloud\\DriverPacks',
      allowedHosts: ['downloads.dell.com'],
    },
  };

  const httpConfig = mediaHttpServerConfig(config);
  assert.equal(httpConfig.host, '192.168.100.1');
  assert.equal(httpConfig.statusRoot, 'C:\\PXE-HttpRoot\\status');
  assert.deepEqual(httpConfig.driverPackCache, config.driverPackCache);
});

test('applies selectable project root outside the Git clone', () => {
  const config = {
    paths: {
      repoRoot: 'C:\\repo\\osdcloud-win11-deployment-lab',
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
    },
    adapter: { interfaceAlias: 'Ethernet', serverIp: '10.0.0.1', prefixLength: 24 },
    dhcp: {
      listenIp: '10.0.0.1',
      leaseStartIp: '10.0.0.20',
      leaseEndIp: '10.0.0.30',
      subnetMask: '255.255.255.0',
      router: '10.0.0.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://10.0.0.1/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\OSDCloud\\PXE-TFTP', listenIp: '10.0.0.1' },
    http: { root: 'C:\\OSDCloud\\PXE-HttpRoot', host: '10.0.0.1', statusRoot: 'C:\\OSDCloud\\PXE-HttpRoot\\status' },
    smb: { share: '\\\\10.0.0.1\\OSDCloudiPXE' },
  };

  applyProjectRoot(config, 'D:\\DeployRoot');

  assert.equal(config.paths.osdCloudRoot, 'D:\\DeployRoot');
  assert.equal(config.tftp.root, 'D:\\DeployRoot\\PXE-TFTP');
  assert.equal(config.http.statusRoot, 'D:\\DeployRoot\\PXE-HttpRoot\\status');
  assert.equal(config.driverPackCache.root, 'D:\\DeployRoot\\Media\\OSDCloud\\DriverPacks');
  assert.equal(config.osImage.cacheRoot, 'D:\\DeployRoot\\Media\\OSDCloud\\OS');
  assert.equal(config.deploymentProfiles.appsRoot, 'D:\\DeployRoot\\Media\\OSDCloud\\Apps');
  assert.equal(config.runtimeArtifacts.liveRoot, 'D:\\DeployRoot');
  assert.equal(workspaceInfo(config).runtimeInsideRepo, false);
});

test('rejects project root inside the Git clone', () => {
  const config = { paths: { repoRoot: 'C:\\repo\\osdcloud-win11-deployment-lab' } };
  assert.throws(
    () => applyProjectRoot(config, 'C:\\repo\\osdcloud-win11-deployment-lab\\runtime'),
    /inside the Git clone/,
  );
});

test('applies service endpoint to every network-facing config value', () => {
  const config = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.100' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };

  applyServiceEndpoint(config, {
    interfaceAlias: 'Wi-Fi',
    ipAddress: '10.10.10.5',
    prefixLength: 24,
    gateway: '10.10.10.1',
  });

  assert.equal(config.adapter.interfaceAlias, 'Wi-Fi');
  assert.equal(config.adapter.serverIp, '10.10.10.5');
  assert.equal(config.adapter.prefixLength, 24);
  assert.equal(config.adapter.defaultGateway, '10.10.10.1');
  assert.equal(config.adapter.remoteSubnet, '10.10.10.0/24');
  assert.equal(config.dhcp.listenIp, '10.10.10.5');
  assert.equal(config.dhcp.leaseStartIp, '10.10.10.200');
  assert.equal(config.dhcp.leaseEndIp, '10.10.10.250');
  assert.equal(config.dhcp.subnetMask, '255.255.255.0');
  assert.equal(config.dhcp.router, '10.10.10.1');
  assert.equal(config.tftp.listenIp, '10.10.10.5');
  assert.equal(config.http.host, '10.10.10.5');
  assert.equal(config.dhcp.ipxeBootUrl, 'http://10.10.10.5/osdcloud/boot.ipxe');
  assert.equal(config.smb.share, '\\\\10.10.10.5\\OSDCloudiPXE');
  assert.equal(config.smb.imagePath, '\\\\10.10.10.5\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd');
});

test('applies isolated interface endpoint using server IP as DHCP router', () => {
  const config = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.100' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };

  applyServiceEndpoint(config, {
    interfaceAlias: 'Ethernet',
    ipAddress: '192.168.100.1',
    prefixLength: 24,
    gateway: '',
  });

  assert.equal(config.adapter.remoteSubnet, '192.168.100.0/24');
  assert.equal(config.dhcp.leaseStartIp, '192.168.100.200');
  assert.equal(config.dhcp.leaseEndIp, '192.168.100.250');
  assert.equal(config.dhcp.subnetMask, '255.255.255.0');
  assert.equal(config.dhcp.router, '192.168.100.1');
});

test('drops DHCP reservations outside the selected endpoint subnet', () => {
  const config = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      reservations: [
        { mac: 'AA-BB-CC-00-00-01', ip: '10.10.10.115' },
        { mac: 'AA-BB-CC-00-00-02', ip: '192.168.100.115' },
        { mac: 'AA-BB-CC-00-00-03', ip: 'not-an-ip' },
      ],
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.100' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };

  applyServiceEndpoint(config, {
    interfaceAlias: 'LAN',
    ipAddress: '10.10.10.5',
    prefixLength: 24,
    gateway: '',
  });

  assert.deepEqual(config.dhcp.reservations, [
    { mac: 'AA-BB-CC-00-00-01', ip: '10.10.10.115' },
  ]);
});

test('validates DHCP reservations', () => {
  const config = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.1', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.1',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      reservations: [{ mac: 'AA-BB-CC-DD-EE-FF', ip: '192.168.100.115' }],
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.1/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.1' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.1', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.1\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };

  assert.equal(validateConfig(config), config);
  config.dhcp.reservations = [{ mac: 'bad-mac', ip: '192.168.100.115' }];
  assert.throws(() => validateConfig(config), /Invalid DHCP reservation MAC/);
  config.dhcp.reservations = [{ mac: 'AA-BB-CC-DD-EE-FF', ip: '10.0.0.115' }];
  assert.throws(() => validateConfig(config), /outside/);
});

test('saves public config without losing existing fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-config-save-'));
  const configPath = path.join(root, 'osdcloud-console.json');
  const config = {
    adapter: { interfaceAlias: '乙太網路 3', serverIp: '192.168.100.100', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.100',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.100/osdcloud/boot.ipxe',
      leaseSeconds: 3600,
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.100' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.100', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      endpointSyncScript: 'C:\\repo\\tools\\Set-OsdCloudIpxeEndpoint.ps1',
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.100\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.100\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
    __configPath: configPath,
  };

  try {
    saveConfig(config);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(saved.__configPath, undefined);
    assert.equal(saved.dhcp.leaseSeconds, 3600);
    assert.equal(saved.paths.endpointSyncScript, 'C:\\repo\\tools\\Set-OsdCloudIpxeEndpoint.ps1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local config overlay overrides endpoint without rewriting tracked config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-config-local-'));
  const configPath = path.join(root, 'osdcloud-console.json');
  const localConfigPath = path.join(root, 'osdcloud-console.local.json');
  const base = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '192.168.100.1', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.100.1',
      leaseStartIp: '192.168.100.200',
      leaseEndIp: '192.168.100.250',
      subnetMask: '255.255.255.0',
      router: '192.168.100.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://192.168.100.1/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '192.168.100.1' },
    http: { root: 'C:\\PXE-HttpRoot', host: '192.168.100.1', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\192.168.100.1\\OSDCloudiPXE',
      imagePath: '\\\\192.168.100.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };
  try {
    writeJson(configPath, base);
    writeJson(localConfigPath, {
      adapter: { interfaceAlias: 'LAN', serverIp: '192.168.88.1', prefixLength: 24 },
      dhcp: {
        listenIp: '192.168.88.1',
        leaseStartIp: '192.168.88.200',
        leaseEndIp: '192.168.88.250',
        subnetMask: '255.255.255.0',
        router: '192.168.88.1',
        ipxeBootUrl: 'http://192.168.88.1/osdcloud/boot.ipxe',
      },
      tftp: { listenIp: '192.168.88.1' },
      http: { host: '192.168.88.1' },
      smb: {
        share: '\\\\192.168.88.1\\OSDCloudiPXE',
        imagePath: '\\\\192.168.88.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
      },
    });
    const config = loadConfig(configPath, { localConfigPath });
    assert.equal(config.adapter.interfaceAlias, 'LAN');
    assert.equal(config.dhcp.bootFile, 'snponly.efi');
    config.adapter.serverIp = '192.168.88.2';
    const savedPath = saveConfig(config);
    assert.equal(savedPath, localConfigPath);
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).adapter.serverIp, '192.168.100.1');
    assert.equal(JSON.parse(fs.readFileSync(localConfigPath, 'utf8')).adapter.serverIp, '192.168.88.2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loads JSON config files with UTF-8 BOM from Windows PowerShell', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'osdcloud-config-bom-'));
  const configPath = path.join(root, 'osdcloud-console.json');
  const localConfigPath = path.join(root, 'osdcloud-console.local.json');
  const base = {
    adapter: { interfaceAlias: 'Ethernet', serverIp: '10.0.0.1', prefixLength: 24 },
    dhcp: {
      listenIp: '10.0.0.1',
      leaseStartIp: '10.0.0.20',
      leaseEndIp: '10.0.0.30',
      subnetMask: '255.255.255.0',
      router: '10.0.0.1',
      bootFile: 'snponly.efi',
      ipxeBootUrl: 'http://10.0.0.1/osdcloud/boot.ipxe',
    },
    tftp: { root: 'C:\\PXE-TFTP', listenIp: '10.0.0.1' },
    http: { root: 'C:\\PXE-HttpRoot', host: '10.0.0.1', statusRoot: 'C:\\status' },
    paths: {
      expectedHttpFiles: ['osdcloud\\boot.ipxe'],
      imageNamePattern: 'install.esd',
    },
    smb: {
      share: '\\\\10.0.0.1\\OSDCloudiPXE',
      imagePath: '\\\\10.0.0.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };
  const overlay = {
    adapter: { interfaceAlias: 'PXE', serverIp: '192.168.88.1', prefixLength: 24 },
    dhcp: {
      listenIp: '192.168.88.1',
      leaseStartIp: '192.168.88.200',
      leaseEndIp: '192.168.88.250',
      subnetMask: '255.255.255.0',
      router: '192.168.88.1',
      ipxeBootUrl: 'http://192.168.88.1/osdcloud/boot.ipxe',
    },
    tftp: { listenIp: '192.168.88.1' },
    http: { host: '192.168.88.1' },
    smb: {
      share: '\\\\192.168.88.1\\OSDCloudiPXE',
      imagePath: '\\\\192.168.88.1\\OSDCloudiPXE\\OSDCloud\\OS\\install.esd',
    },
  };
  try {
    fs.writeFileSync(configPath, `\uFEFF${JSON.stringify(base, null, 2)}\n`, 'utf8');
    fs.writeFileSync(localConfigPath, `\uFEFF${JSON.stringify(overlay, null, 2)}\n`, 'utf8');

    const config = loadConfig(configPath);

    assert.equal(config.adapter.interfaceAlias, 'PXE');
    assert.equal(config.adapter.serverIp, '192.168.88.1');
    assert.equal(config.__configPath, configPath);
    assert.equal(config.__savePath, localConfigPath);

    const configFromLocalPath = loadConfig(localConfigPath);

    assert.equal(configFromLocalPath.adapter.interfaceAlias, 'PXE');
    assert.equal(configFromLocalPath.dhcp.bootFile, 'snponly.efi');
    assert.equal(configFromLocalPath.tftp.root, 'C:\\PXE-TFTP');
    assert.equal(configFromLocalPath.http.statusRoot, 'C:\\status');
    assert.equal(configFromLocalPath.__configPath, configPath);
    assert.equal(configFromLocalPath.__savePath, localConfigPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
