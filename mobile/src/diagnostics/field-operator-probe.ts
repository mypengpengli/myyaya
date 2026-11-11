import { runNativeFieldDiagnostic } from "../../modules/navigation-probe";

/** DUMP-only operator test, never registered as a model tool. */
export async function runFieldOperatorProbe(args: { direction?: unknown; operatorConfirmed?: unknown }) {
  if (args?.operatorConfirmed !== true || !["back", "back_step", "left", "right"].includes(String(args?.direction))) {
    throw new Error("需要明确的方向和操作者场地确认");
  }
  return runNativeFieldDiagnostic(args.direction as "back" | "back_step" | "left" | "right", true);
}
