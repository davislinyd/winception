import { Type, type Static, type TSchema } from '@sinclair/typebox';

export const WINCEPTION_V2_VERSION = '2.0.0-alpha.1' as const;
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

export const AGENT_COMMAND_PAYLOAD_SCHEMAS: Readonly<Record<AgentCommandName, TSchema>> = Object.freeze({
  'system.health': EmptyPayloadSchema,
  'system.state': EmptyPayloadSchema,
  'operations.list': EmptyPayloadSchema,
  'deployment.snapshot': SafeObjectPayloadSchema,
  'interfaces.list': EmptyPayloadSchema,
  'network.inspect': EmptyPayloadSchema,
  'profiles.list': EmptyPayloadSchema,
  'os-images.list': EmptyPayloadSchema,
  'os-images.catalog': SafeObjectPayloadSchema,
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
  'diagnostics.run': SafeObjectPayloadSchema,
  'secrets.save': DeploymentSecretsPayloadSchema,
  'runtime.prepare': EmptyPayloadSchema,
  'project-root.update': ProjectRootPayloadSchema,
  'endpoint.update': SafeObjectPayloadSchema,
  'network.prepare': SafeObjectPayloadSchema,
  'network.remove': EmptyPayloadSchema,
  'boot-mode.update': BootModePayloadSchema,
  'dhcp-mode.update': DhcpModePayloadSchema,
  'profile.publish': IdPayloadSchema,
  'profile.create': SafeObjectPayloadSchema,
  'profile.update': SafeObjectPayloadSchema,
  'profile.delete': IdPayloadSchema,
  'software-test.configure': SafeObjectPayloadSchema,
  'software-test.start': SoftwareTestStartPayloadSchema,
  'software-test.abort': SoftwareTestAbortPayloadSchema,
  'os-image.delete': IdPayloadSchema,
  'torrent.settings.update': TorrentSettingsPayloadSchema,
  'torrent.client.release': TorrentClientPayloadSchema,
  'torrent.client.extend': TorrentClientPayloadSchema,
  'os-image.download.start': OsImagePayloadSchema,
  'os-image.reexport.start': OsImagePayloadSchema,
  'offline-iso.start': EmptyPayloadSchema,
  'software.create': SafeObjectPayloadSchema,
  'software.delete': IdPayloadSchema,
  'software.script.open': IdPayloadSchema,
  'custom-script.create': SafeObjectPayloadSchema,
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
