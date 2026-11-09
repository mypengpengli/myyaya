/** Expire queued work before invoking any tool/agent. Stop and read-only status remain usable. */
export function assertIntegrationCommandFresh(command: { kind: string; tool?: string; args?: { action?: string }; receivedAtEpochMs?: number }, now = Date.now()) {
  if (command.kind === "status" || (command.kind === "tool" && command.tool === "robot_action" && command.args?.action === "stop")) return;
  const age = now - Number(command.receivedAtEpochMs);
  if (!Number.isFinite(age) || age < -1000 || age > 15_000) throw new Error("联调指令已过期，未执行；请保持前台后重新发送");
}
