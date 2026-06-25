export function caseExecutionId(runId: string, stableId: string): string {
  return `${runId}:${stableId}`;
}

export function testDataId(runId: string, stableId: string, dataType: string): string {
  return `${runId}:${stableId}:${dataType}`;
}
