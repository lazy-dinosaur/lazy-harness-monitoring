export type MonitoringDiagnosticCode = 'CONFIG_JSON' | 'CONFIG_SCHEMA' | 'UNSUPPORTED_VERSION' | 'MODULE_DUPLICATE' | 'MODULE_SETTINGS' | 'MODULE_FACTORY' | 'MODULE_ID_MISMATCH' | 'MODULE_VERSION_MISMATCH' | 'JUDGE_REQUIRED' | 'BINDING_MISSING' | 'HOST_UNSUPPORTED' | 'HOST_BOUND_INVALID' | 'LIMIT_NOT_GRANTED' | 'LIMIT_EXCEEDED' | 'SOURCE_NOT_GRANTED' | 'ADAPTER_MISMATCH' | 'UNSUPPORTED_EVENT' | 'CORE_SETUP' | 'MODULE_DECLARATION' | 'JOB_OVERRIDE_WITHOUT_DECLARATION' | 'JOB_UNKNOWN' | 'JOB_REPORT_UNSUPPORTED' | 'JOB_RISK_LOOSENED' | 'WATCH_OVERRIDE_WITHOUT_DECLARATION' | 'WATCH_WIDENED' | 'STAGE_RAISED'
export class MonitoringConfigurationError extends Error {
  constructor(readonly code: MonitoringDiagnosticCode, readonly path: string, message: string) { super(message); this.name = 'MonitoringConfigurationError' }
  toJSON() { return { code: this.code, path: this.path, message: this.message } }
}
export function freezeMonitoringData<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freezeMonitoringData); Object.freeze(value) } return value }
/** Diagnostics intentionally omit input values, credentials and arbitrary exception messages. */
export function configurationFailure(code: MonitoringDiagnosticCode, path: string, message: string): never { throw new MonitoringConfigurationError(code, path, message) }
