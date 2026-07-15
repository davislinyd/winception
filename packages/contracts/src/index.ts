import { Type, type Static, type TSchema } from '@sinclair/typebox';

export const WINCEPTION_V2_VERSION = '2.0.0-alpha.12' as const;
export const CONTRACT_VERSION = 1 as const;

export const JsonValueSchema = Type.Recursive((This) => Type.Union([
  Type.String({ maxLength: 32768 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Array(This, { maxItems: 4096 }),
  Type.Record(Type.String({ minLength: 1, maxLength: 256 }), This),
]));
export type JsonValue = Static<typeof JsonValueSchema>;

export const OperationResourceSchema = Type.Union([
  Type.Literal('config'),
  Type.Literal('deployment-ingress'),
  Type.Literal('runtime'),
  Type.Literal('os-cache'),
  Type.Literal('profile-payload'),
  Type.Literal('software-test-vm'),
  Type.Literal('evidence'),
  Type.Literal('runtime-control'),
]);
export type OperationResource = Static<typeof OperationResourceSchema>;

export const OperationStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('aborted'),
]);
export type OperationStatus = Static<typeof OperationStatusSchema>;

export const OperationRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  resources: Type.Array(OperationResourceSchema, { uniqueItems: true }),
  status: OperationStatusSchema,
  startedAt: Type.String({ format: 'date-time' }),
  finishedAt: Type.Optional(Type.String({ format: 'date-time' })),
  errorCode: Type.Optional(Type.String()),
});
export type OperationRecord = Static<typeof OperationRecordSchema>;

export const ApiErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    correctiveAction: Type.Optional(Type.String()),
    correlationId: Type.String(),
    conflicts: Type.Optional(Type.Array(Type.Object({
      operationId: Type.String(),
      label: Type.String(),
      resources: Type.Array(OperationResourceSchema),
    }))),
  }),
});
export type ApiError = Static<typeof ApiErrorSchema>;

export const HealthSchema = Type.Object({
  ok: Type.Boolean(),
  service: Type.Union([Type.Literal('web'), Type.Literal('agent')]),
  version: Type.Literal(WINCEPTION_V2_VERSION),
  contractVersion: Type.Literal(CONTRACT_VERSION),
  at: Type.String({ format: 'date-time' }),
});
export type Health = Static<typeof HealthSchema>;

export const AuthStatusSchema = Type.Object({
  ok: Type.Literal(true),
  authenticated: Type.Boolean(),
  authenticationRequired: Type.Literal(true),
  transport: Type.Union([Type.Literal('loopback-http'), Type.Literal('https')]),
});
export type AuthStatus = Static<typeof AuthStatusSchema>;

export const AuthSessionRequestSchema = Type.Object({
  token: Type.String({ minLength: 32, maxLength: 512 }),
}, { additionalProperties: false });

export const SuccessSchema = Type.Object({ ok: Type.Literal(true) });
export const OperationAcceptedSchema = Type.Object({
  ok: Type.Literal(true),
  operationId: Type.String(),
});
export const ResultSchema = Type.Object({
  ok: Type.Literal(true),
  result: JsonValueSchema,
});

export const SystemStateSchema = Type.Object({
  app: Type.Object({
    version: Type.Literal(WINCEPTION_V2_VERSION),
    contractVersion: Type.Literal(CONTRACT_VERSION),
  }),
  services: Type.Object({
    agent: Type.Union([Type.Literal('connected'), Type.Literal('unavailable')]),
    deploymentIngress: Type.Union([Type.Literal('running'), Type.Literal('stopped'), Type.Literal('unknown')]),
  }),
  fleet: Type.Object({ activeRuns: Type.Integer({ minimum: 0 }) }),
  operations: Type.Array(OperationRecordSchema),
  updatedAt: Type.String({ format: 'date-time' }),
});
export type SystemState = Static<typeof SystemStateSchema>;

export const InstallSequenceEntrySchema = Type.Object({
  type: Type.Union([Type.Literal('software'), Type.Literal('script')]),
  id: Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400 })),
}, { additionalProperties: false });
export type InstallSequenceEntry = Static<typeof InstallSequenceEntrySchema>;

export const SoftwareNetworkSchema = Type.Union([
  Type.Object({ requirement: Type.Literal('offline') }, { additionalProperties: false }),
  Type.Object({
    requirement: Type.Literal('client-internet'),
    probeHost: Type.String({ minLength: 1, maxLength: 253, pattern: '^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$' }),
  }, { additionalProperties: false }),
]);

export const AgentCommandNameSchema = Type.Union([
  Type.Literal('system.health'),
  Type.Literal('system.state'),
  Type.Literal('operations.list'),
  Type.Literal('deployment.snapshot'),
  Type.Literal('interfaces.list'),
  Type.Literal('network.inspect'),
  Type.Literal('profiles.list'),
  Type.Literal('os-images.list'),
  Type.Literal('os-images.catalog'),
  Type.Literal('diagnostics.latest'),
  Type.Literal('diagnostics.bundle.stage'),
  Type.Literal('software.script.read'),
  Type.Literal('custom-script.read'),
  Type.Literal('software-test.status'),
  Type.Literal('service.start'),
  Type.Literal('service.stop'),
  Type.Literal('services.start-all'),
  Type.Literal('services.stop-all'),
  Type.Literal('preflight.run'),
  Type.Literal('diagnostics.run'),
  Type.Literal('secrets.save'),
  Type.Literal('runtime.prepare'),
  Type.Literal('project-root.update'),
  Type.Literal('endpoint.update'),
  Type.Literal('network.prepare'),
  Type.Literal('network.remove'),
  Type.Literal('boot-mode.update'),
  Type.Literal('dhcp-mode.update'),
  Type.Literal('profile.publish'),
  Type.Literal('profile.create'),
  Type.Literal('profile.update'),
  Type.Literal('profile.delete'),
  Type.Literal('software-test.configure'),
  Type.Literal('software-test.start'),
  Type.Literal('software-test.abort'),
  Type.Literal('os-image.delete'),
  Type.Literal('torrent.settings.update'),
  Type.Literal('torrent.client.release'),
  Type.Literal('torrent.client.extend'),
  Type.Literal('os-image.download.start'),
  Type.Literal('os-image.reexport.start'),
  Type.Literal('offline-iso.start'),
  Type.Literal('software.create'),
  Type.Literal('software.delete'),
  Type.Literal('software.script.open'),
  Type.Literal('custom-script.create'),
  Type.Literal('custom-script.delete'),
  Type.Literal('status.clear'),
  Type.Literal('status.run.delete'),
  Type.Literal('status.runs.delete'),
  Type.Literal('status.runs.archive'),
  Type.Literal('status.runs.restore'),
  Type.Literal('status.archive.delete'),
  Type.Literal('upload.os-image.commit'),
  Type.Literal('upload.software.commit'),
  Type.Literal('upload.custom-script.commit'),
]);
export type AgentCommandName = Static<typeof AgentCommandNameSchema>;

export const NetworkInterfaceSchema = Type.Object({
  interfaceAlias: Type.String(),
  interfaceIndex: Type.Integer(),
  interfaceDescription: Type.String(),
  status: Type.String(),
  macAddress: Type.String(),
  linkSpeed: Type.String(),
  ipAddress: Type.String({ format: 'ipv4' }),
  prefixLength: Type.Integer({ minimum: 0, maximum: 32 }),
  gateway: Type.String(),
}, { additionalProperties: false });
export type NetworkInterface = Static<typeof NetworkInterfaceSchema>;

export const ProfileReferenceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
}, { additionalProperties: false });
export const DeploymentProfileSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  softwareIds: Type.Array(Type.String()),
  execution: Type.Object({ defaultTimeoutSeconds: Type.Integer() }),
  installSequence: Type.Array(InstallSequenceEntrySchema),
  osImageId: Type.Union([Type.String(), Type.Null()]),
  displayLanguage: Type.Optional(Type.String()),
  locale: Type.Optional(Type.String()),
  inputLanguage: Type.Optional(Type.String()),
  timeZone: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type DeploymentProfile = Static<typeof DeploymentProfileSchema>;
export const SoftwareCatalogItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  source: Type.String(),
  sourcePath: Type.String(),
  installScript: Type.String(),
  scriptMode: Type.String(),
  installerType: Type.Union([Type.String(), Type.Null()]),
  installerFileName: Type.Union([Type.String(), Type.Null()]),
  silentArgs: Type.Union([Type.String(), Type.Null()]),
  successExitCodes: Type.Union([Type.Array(Type.Integer()), Type.Null()]),
  verifyPath: Type.Union([Type.String(), Type.Null()]),
  verificationMode: Type.String(),
  installerBytes: Type.Union([Type.Integer(), Type.Null()]),
  installerSha256: Type.Union([Type.String(), Type.Null()]),
  dependsOn: Type.Array(Type.String()),
  network: SoftwareNetworkSchema,
  usedByProfiles: Type.Array(ProfileReferenceSchema),
}, { additionalProperties: false });
export type SoftwareCatalogItem = Static<typeof SoftwareCatalogItemSchema>;
export const CustomScriptCatalogItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  source: Type.String(),
  sourcePath: Type.String(),
  scriptFile: Type.String(),
  fileName: Type.String(),
  bytes: Type.Union([Type.Integer(), Type.Null()]),
  sha256: Type.Union([Type.String(), Type.Null()]),
  usedByProfiles: Type.Array(ProfileReferenceSchema),
}, { additionalProperties: false });
export type CustomScriptCatalogItem = Static<typeof CustomScriptCatalogItemSchema>;
export const ProfilesResultSchema = Type.Object({
  activeProfile: DeploymentProfileSchema,
  softwareCatalog: Type.Array(SoftwareCatalogItemSchema),
  customScriptCatalog: Type.Array(CustomScriptCatalogItemSchema),
  selectedSoftware: Type.Array(ProfileReferenceSchema),
  selectedSoftwareText: Type.String(),
  selectedScripts: Type.Array(ProfileReferenceSchema),
  profiles: Type.Array(DeploymentProfileSchema),
}, { additionalProperties: false });
export type ProfilesResult = Static<typeof ProfilesResultSchema>;

export const OsImageSchema = Type.Object({
  id: Type.String(), name: Type.String(), version: Type.String(), releaseId: Type.String(), build: Type.String(),
  architecture: Type.String(), language: Type.String(), locale: Type.String(), timeZone: Type.String(), edition: Type.String(),
  editionId: Type.String(), activation: Type.String(), imageIndex: Type.Integer(), fileName: Type.String(), osFamily: Type.String(),
  size: Type.Union([Type.Integer(), Type.Null()]), sha256: Type.String(), sha1: Type.String(), url: Type.String(), sourceType: Type.String(),
  sourceFileName: Type.String(), sourceContainerType: Type.String(), sourceImageIndex: Type.Union([Type.Integer(), Type.Null()]),
  sourceSize: Type.Union([Type.Integer(), Type.Null()]), sourceSha256: Type.String(),
  filePath: Type.Optional(Type.String()), cached: Type.Optional(Type.Boolean()), exists: Type.Optional(Type.Boolean()),
  bytes: Type.Optional(Type.Integer()), sizeMatches: Type.Optional(Type.Boolean()),
  usedByProfiles: Type.Optional(Type.Array(ProfileReferenceSchema)),
}, { additionalProperties: false });
export type OsImage = Static<typeof OsImageSchema>;
export const OsImagesResultSchema = Type.Object({
  activeImage: Type.Union([OsImageSchema, Type.Null()]),
  activeImageId: Type.Union([Type.String(), Type.Null()]),
  activeLabel: Type.String(), catalogPath: Type.String(), downloadSourcesPath: Type.String(), cacheRoot: Type.String(),
  downloadStagingRoot: Type.String(), selectedOsPath: Type.String(), cacheLogPath: Type.String(),
  selectedOs: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  images: Type.Array(OsImageSchema),
  cachedFiles: Type.Array(Type.String()),
}, { additionalProperties: false });
export type OsImagesResult = Static<typeof OsImagesResultSchema>;

export const ScriptContentResultSchema = Type.Object({
  softwareId: Type.Optional(Type.String()),
  scriptId: Type.Optional(Type.String()),
  filePath: Type.String(),
  content: Type.String({ maxLength: 1048576 }),
}, { additionalProperties: false });
export type ScriptContentResult = Static<typeof ScriptContentResultSchema>;
export const StagedFileResultSchema = Type.Object({
  uploadToken: Type.String(), fileName: Type.String(), sizeBytes: Type.Integer({ minimum: 0 }), sha256: Type.String(),
}, { additionalProperties: false });
export type StagedFileResult = Static<typeof StagedFileResultSchema>;
export const DeploymentSnapshotResultSchema = Type.Object({
  generatedAt: Type.String({ format: 'date-time' }),
  app: Type.Record(Type.String(), Type.Unknown()),
  config: Type.Record(Type.String(), Type.Unknown()),
  services: Type.Record(Type.String(), Type.Unknown()),
  fleet: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: true });
export type DeploymentSnapshotResult = Static<typeof DeploymentSnapshotResultSchema>;
export const GatewayResultSchema = Type.Object({
  topology: Type.Union([Type.Literal('shared-lan'), Type.Literal('dual-nic-nat')]),
  ready: Type.Boolean(),
  detail: Type.String(),
}, { additionalProperties: true });
export type GatewayResult = Static<typeof GatewayResultSchema>;
export const DiagnosticsResultSchema = Type.Union([
  Type.Null(),
  Type.Object({ generatedAt: Type.String({ format: 'date-time' }) }, { additionalProperties: true }),
]);
export type DiagnosticsResult = Static<typeof DiagnosticsResultSchema>;
const NullableTextSchema = Type.Union([Type.String(), Type.Null()]);
export const SoftwareTestRunSchema = Type.Object({
  runId: Type.String(), profileId: Type.String(), profileName: Type.String(), status: Type.String(), phase: Type.String(),
  startedAt: NullableTextSchema, finishedAt: NullableTextSchema, abortRequestedAt: NullableTextSchema,
  elapsedSeconds: Type.Union([Type.Number(), Type.Null()]), rebootCount: Type.Integer(), cleanup: Type.String(),
  cleanupReason: Type.String(), cleanupAction: Type.String(),
  recovery: Type.Union([Type.Object({ status: Type.Literal('verified'), verifiedAt: Type.String() }, { additionalProperties: false }), Type.Null()]),
  detail: Type.String(),
  steps: Type.Array(Type.Object({
    index: Type.Number(), type: Type.String(), id: Type.String(), name: Type.String(), status: Type.String(),
    durationSeconds: Type.Union([Type.Number(), Type.Null()]), timeoutSeconds: Type.Union([Type.Number(), Type.Null()]),
    networkWaitSeconds: Type.Number(), rebootRecommended: Type.Boolean(),
  }, { additionalProperties: false })),
  failure: Type.Union([Type.Object({ category: Type.String(), stepId: Type.String(), stepType: Type.String() }, { additionalProperties: false }), Type.Null()]),
}, { additionalProperties: false });
export type SoftwareTestRun = Static<typeof SoftwareTestRunSchema>;
export const SoftwareTestStatusResultSchema = Type.Object({
  configuration: Type.Object({
    configured: Type.Boolean(), ready: Type.Boolean(), vmName: NullableTextSchema, checkpointName: NullableTextSchema,
    targetUser: NullableTextSchema, detail: Type.String(), verifiedAt: NullableTextSchema,
  }, { additionalProperties: false }),
  latest: Type.Union([SoftwareTestRunSchema, Type.Null()]),
  active: Type.Union([Type.Object({ runId: Type.String(), abortAvailable: Type.Boolean(), phase: Type.String() }, { additionalProperties: false }), Type.Null()]),
}, { additionalProperties: false });
export type SoftwareTestStatusResult = Static<typeof SoftwareTestStatusResultSchema>;

export const EmptyPayloadSchema = Type.Object({}, { additionalProperties: false });
export const SafeObjectPayloadSchema = Type.Record(Type.String({ minLength: 1, maxLength: 256 }), JsonValueSchema);
export type SafeObjectPayload = Static<typeof SafeObjectPayloadSchema>;
export const IdPayloadSchema = Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false });
export type IdPayload = Static<typeof IdPayloadSchema>;
export const IdsPayloadSchema = Type.Object({ ids: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 1000, uniqueItems: true }) }, { additionalProperties: false });
export type IdsPayload = Static<typeof IdsPayloadSchema>;
export const ServicePayloadSchema = Type.Object({
  name: Type.Union([Type.Literal('http'), Type.Literal('tftp'), Type.Literal('dhcp'), Type.Literal('torrent')]),
}, { additionalProperties: false });
export type ServicePayload = Static<typeof ServicePayloadSchema>;
export const ProjectRootPayloadSchema = Type.Object({
  projectRoot: Type.String({ minLength: 4, maxLength: 32768, pattern: '^[A-Za-z]:\\\\' }),
}, { additionalProperties: false });
export const BootModePayloadSchema = Type.Object({ mode: Type.Union([Type.Literal('secureboot'), Type.Literal('ipxe')]) }, { additionalProperties: false });
export type BootModePayload = Static<typeof BootModePayloadSchema>;
export const DhcpModePayloadSchema = Type.Object({ mode: Type.Union([Type.Literal('server'), Type.Literal('proxy')]) }, { additionalProperties: false });
export type DhcpModePayload = Static<typeof DhcpModePayloadSchema>;
export const DeploymentSecretsPayloadSchema = Type.Object({
  windowsUsername: Type.String({ minLength: 1, maxLength: 256 }),
  windowsPassword: Type.String({ minLength: 1, maxLength: 4096 }),
  pxeinstallPassword: Type.String({ minLength: 1, maxLength: 4096 }),
}, { additionalProperties: false });
export type DeploymentSecretsPayload = Static<typeof DeploymentSecretsPayloadSchema>;
export const ScriptReadPayloadSchema = Type.Object({ id: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
export const DiagnosticsBundlePayloadSchema = Type.Object({ bundleName: Type.String({ minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._-]+$' }) }, { additionalProperties: false });
export type DiagnosticsBundlePayload = Static<typeof DiagnosticsBundlePayloadSchema>;
export const UploadTokenPayloadSchema = Type.Object({
  uploadToken: Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' }),
}, { additionalProperties: false });
export type UploadTokenPayload = Static<typeof UploadTokenPayloadSchema>;
export const UploadStagedSchema = Type.Object({
  ok: Type.Literal(true),
  uploadToken: Type.String(),
  fileName: Type.String(),
  sizeBytes: Type.Integer({ minimum: 0 }),
  sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
});
export const SoftwareTestStartPayloadSchema = Type.Object({
  profileId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export type SoftwareTestStartPayload = Static<typeof SoftwareTestStartPayloadSchema>;
export const SoftwareTestAbortPayloadSchema = Type.Object({
  runId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export type SoftwareTestAbortPayload = Static<typeof SoftwareTestAbortPayloadSchema>;
export const TorrentSettingsPayloadSchema = Type.Object({
  seedMinutes: Type.Integer({ minimum: 0, maximum: 1440 }),
}, { additionalProperties: false });
export type TorrentSettingsPayload = Static<typeof TorrentSettingsPayloadSchema>;
export const TorrentClientPayloadSchema = Type.Object({
  runId: Type.String({ minLength: 1, maxLength: 128 }),
  clientId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export type TorrentClientPayload = Static<typeof TorrentClientPayloadSchema>;
export const OsImagePayloadSchema = Type.Object({
  imageId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export type OsImagePayload = Static<typeof OsImagePayloadSchema>;

const CatalogIdSchema = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' });
const HumanCatalogIdSchema = Type.String({ minLength: 1, maxLength: 16, pattern: '^[a-z0-9][a-z0-9-]*$' });
const OptionalTextSchema = Type.Optional(Type.String({ maxLength: 4096 }));
const OptionalNullableTextSchema = Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()]));

export const DeploymentSnapshotPayloadSchema = Type.Object({
  selectedRunId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  includeEvidence: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type DeploymentSnapshotPayload = Static<typeof DeploymentSnapshotPayloadSchema>;

export const OsCatalogPayloadSchema = Type.Object({
  osFamily: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { maxItems: 16, uniqueItems: true })),
  edition: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32, uniqueItems: true })),
  activation: Type.Optional(Type.Array(Type.Literal('Retail'), { maxItems: 1, uniqueItems: true })),
  language: Type.Optional(Type.Array(Type.String({ minLength: 2, maxLength: 32 }), { maxItems: 64, uniqueItems: true })),
  releaseId: Type.Optional(Type.Array(Type.String({ minLength: 2, maxLength: 32 }), { maxItems: 64, uniqueItems: true })),
  sourceType: Type.Optional(Type.Array(Type.Literal('official'), { maxItems: 1, uniqueItems: true })),
}, { additionalProperties: false });
export type OsCatalogPayload = Static<typeof OsCatalogPayloadSchema>;

export const DiagnosticsRunPayloadSchema = Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal('full'), Type.Literal('host'), Type.Literal('run')])),
  runId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  trigger: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._-]+$' })),
}, { additionalProperties: false });
export type DiagnosticsRunPayload = Static<typeof DiagnosticsRunPayloadSchema>;

export const EndpointPayloadSchema = Type.Object({
  interfaceAlias: Type.String({ minLength: 1, maxLength: 256 }),
  ipAddress: Type.String({ format: 'ipv4' }),
  prefixLength: Type.Integer({ minimum: 8, maximum: 30 }),
  gateway: Type.Optional(Type.String({ format: 'ipv4' })),
}, { additionalProperties: false });
export type EndpointPayload = Static<typeof EndpointPayloadSchema>;

export const NetworkPreparePayloadSchema = Type.Object({
  wanInterfaceAlias: Type.String({ minLength: 1, maxLength: 256 }),
  pxeInterfaceAlias: Type.String({ minLength: 1, maxLength: 256 }),
  internalSubnet: Type.Optional(Type.String({ minLength: 9, maxLength: 18, pattern: '^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\/(?:[89]|[12][0-9]|30)$' })),
}, { additionalProperties: false });
export type NetworkPreparePayload = Static<typeof NetworkPreparePayloadSchema>;

const ProfileFields = {
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: OptionalTextSchema,
  softwareIds: Type.Optional(Type.Array(CatalogIdSchema, { maxItems: 256, uniqueItems: true })),
  installSequence: Type.Optional(Type.Array(InstallSequenceEntrySchema, { maxItems: 512 })),
  execution: Type.Optional(Type.Object({
    defaultTimeoutSeconds: Type.Integer({ minimum: 1, maximum: 86400 }),
  }, { additionalProperties: false })),
  osImageId: Type.Optional(CatalogIdSchema),
  displayLanguage: OptionalNullableTextSchema,
  locale: OptionalNullableTextSchema,
  inputLanguage: OptionalNullableTextSchema,
  timeZone: OptionalNullableTextSchema,
};

export const ProfileCreatePayloadSchema = Type.Object(ProfileFields, { additionalProperties: false });
export type ProfileCreatePayload = Static<typeof ProfileCreatePayloadSchema>;
export const ProfileUpdatePayloadSchema = Type.Object({
  profileId: CatalogIdSchema,
  ...Object.fromEntries(Object.entries(ProfileFields).map(([key, schema]) => [key, Type.Optional(schema)])),
}, { additionalProperties: false });
export type ProfileUpdatePayload = Static<typeof ProfileUpdatePayloadSchema>;

export const SoftwareTestConfigurePayloadSchema = Type.Object({
  vmName: Type.String({ minLength: 1, maxLength: 128 }),
  checkpointName: Type.String({ minLength: 1, maxLength: 128 }),
  targetUser: Type.String({ minLength: 1, maxLength: 256 }),
}, { additionalProperties: false });
export type SoftwareTestConfigurePayload = Static<typeof SoftwareTestConfigurePayloadSchema>;

export const SoftwareCreatePayloadSchema = Type.Object({
  uploadToken: UploadTokenPayloadSchema.properties.uploadToken,
  softwareId: HumanCatalogIdSchema,
  name: Type.String({ minLength: 1, maxLength: 128 }),
  scriptMode: Type.Union([Type.Literal('template'), Type.Literal('raw')]),
  installerType: Type.Union([Type.Literal('exe'), Type.Literal('msi'), Type.Literal('msix'), Type.Literal('zip')]),
  silentArgs: Type.Optional(Type.String({ maxLength: 4096 })),
  successExitCodes: Type.Optional(Type.Array(Type.Integer({ minimum: -2147483648, maximum: 2147483647 }), { maxItems: 32, uniqueItems: true })),
  verifyPath: Type.Optional(Type.String({ maxLength: 32768 })),
  rawScript: Type.Optional(Type.String({ minLength: 1, maxLength: 262144 })),
  dependsOn: Type.Optional(Type.Array(HumanCatalogIdSchema, { maxItems: 64, uniqueItems: true })),
  network: SoftwareNetworkSchema,
}, { additionalProperties: false });
export type SoftwareCreatePayload = Static<typeof SoftwareCreatePayloadSchema>;

export const CustomScriptCreatePayloadSchema = Type.Object({
  uploadToken: UploadTokenPayloadSchema.properties.uploadToken,
  scriptId: HumanCatalogIdSchema,
  name: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });
export type CustomScriptCreatePayload = Static<typeof CustomScriptCreatePayloadSchema>;

export const AGENT_COMMAND_PAYLOAD_SCHEMAS: Readonly<Record<AgentCommandName, TSchema>> = Object.freeze({
  'system.health': EmptyPayloadSchema,
  'system.state': EmptyPayloadSchema,
  'operations.list': EmptyPayloadSchema,
  'deployment.snapshot': DeploymentSnapshotPayloadSchema,
  'interfaces.list': EmptyPayloadSchema,
  'network.inspect': EmptyPayloadSchema,
  'profiles.list': EmptyPayloadSchema,
  'os-images.list': EmptyPayloadSchema,
  'os-images.catalog': OsCatalogPayloadSchema,
  'diagnostics.latest': EmptyPayloadSchema,
  'diagnostics.bundle.stage': DiagnosticsBundlePayloadSchema,
  'software.script.read': ScriptReadPayloadSchema,
  'custom-script.read': ScriptReadPayloadSchema,
  'software-test.status': EmptyPayloadSchema,
  'service.start': ServicePayloadSchema,
  'service.stop': ServicePayloadSchema,
  'services.start-all': EmptyPayloadSchema,
  'services.stop-all': EmptyPayloadSchema,
  'preflight.run': EmptyPayloadSchema,
  'diagnostics.run': DiagnosticsRunPayloadSchema,
  'secrets.save': DeploymentSecretsPayloadSchema,
  'runtime.prepare': EmptyPayloadSchema,
  'project-root.update': ProjectRootPayloadSchema,
  'endpoint.update': EndpointPayloadSchema,
  'network.prepare': NetworkPreparePayloadSchema,
  'network.remove': EmptyPayloadSchema,
  'boot-mode.update': BootModePayloadSchema,
  'dhcp-mode.update': DhcpModePayloadSchema,
  'profile.publish': IdPayloadSchema,
  'profile.create': ProfileCreatePayloadSchema,
  'profile.update': ProfileUpdatePayloadSchema,
  'profile.delete': IdPayloadSchema,
  'software-test.configure': SoftwareTestConfigurePayloadSchema,
  'software-test.start': SoftwareTestStartPayloadSchema,
  'software-test.abort': SoftwareTestAbortPayloadSchema,
  'os-image.delete': IdPayloadSchema,
  'torrent.settings.update': TorrentSettingsPayloadSchema,
  'torrent.client.release': TorrentClientPayloadSchema,
  'torrent.client.extend': TorrentClientPayloadSchema,
  'os-image.download.start': OsImagePayloadSchema,
  'os-image.reexport.start': OsImagePayloadSchema,
  'offline-iso.start': EmptyPayloadSchema,
  'software.create': SoftwareCreatePayloadSchema,
  'software.delete': IdPayloadSchema,
  'software.script.open': IdPayloadSchema,
  'custom-script.create': CustomScriptCreatePayloadSchema,
  'custom-script.delete': IdPayloadSchema,
  'status.clear': EmptyPayloadSchema,
  'status.run.delete': IdPayloadSchema,
  'status.runs.delete': IdsPayloadSchema,
  'status.runs.archive': IdsPayloadSchema,
  'status.runs.restore': IdsPayloadSchema,
  'status.archive.delete': IdsPayloadSchema,
  'upload.os-image.commit': UploadTokenPayloadSchema,
  'upload.software.commit': UploadTokenPayloadSchema,
  'upload.custom-script.commit': UploadTokenPayloadSchema,
});

export const AGENT_COMMAND_RESULT_SCHEMAS: Readonly<Partial<Record<AgentCommandName, TSchema>>> = Object.freeze({
  'system.health': HealthSchema,
  'system.state': SystemStateSchema,
  'operations.list': Type.Array(OperationRecordSchema),
  'deployment.snapshot': DeploymentSnapshotResultSchema,
  'interfaces.list': Type.Array(NetworkInterfaceSchema),
  'network.inspect': GatewayResultSchema,
  'profiles.list': ProfilesResultSchema,
  'os-images.list': OsImagesResultSchema,
  'os-images.catalog': Type.Array(OsImageSchema),
  'diagnostics.latest': DiagnosticsResultSchema,
  'diagnostics.bundle.stage': StagedFileResultSchema,
  'software.script.read': ScriptContentResultSchema,
  'custom-script.read': ScriptContentResultSchema,
  'software-test.status': SoftwareTestStatusResultSchema,
  'software-test.abort': SoftwareTestRunSchema,
});

export const AgentRequestSchema = Type.Object({
  contractVersion: Type.Literal(CONTRACT_VERSION),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  command: AgentCommandNameSchema,
  payload: JsonValueSchema,
  authToken: Type.String({ minLength: 32, maxLength: 512 }),
}, { additionalProperties: false });
export type AgentRequest = Static<typeof AgentRequestSchema>;

export const AgentResponseSchema = Type.Object({
  contractVersion: Type.Literal(CONTRACT_VERSION),
  id: Type.String(),
  ok: Type.Boolean(),
  result: Type.Optional(JsonValueSchema),
  error: Type.Optional(Type.Object({
    code: Type.String(),
    message: Type.String(),
    correctiveAction: Type.Optional(Type.String()),
  })),
}, { additionalProperties: false });
export type AgentResponse = Static<typeof AgentResponseSchema>;

export const ServerEventSchema = Type.Object({
  version: Type.Literal(CONTRACT_VERSION),
  id: Type.String(),
  type: Type.Union([
    Type.Literal('state.changed'),
    Type.Literal('operation.changed'),
    Type.Literal('heartbeat'),
  ]),
  at: Type.String({ format: 'date-time' }),
  data: JsonValueSchema,
});
export type ServerEvent = Static<typeof ServerEventSchema>;
