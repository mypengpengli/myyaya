import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { getSkillService, readSkillForAgent, skillEvidence } from "./skill-runtime";
import type { SkillInput } from "./skill-service";
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
export function createSkillTools(available: () => string[]): AgentTool[] {
  return [
    { name: "skill_list", label: "正在查找已学会的技能", description: "列出手机持久保存的技能及版本、启用状态。简介用于选择技能，完整步骤用 skill_read；停用技能不会自动使用。",
      parameters: Type.Object({}), execute: async () => text(getSkillService().getSnapshot().map((skill) => ({ name: skill.name, title: skill.current.title,
        description: skill.current.description, revision: skill.current.revision, enabled: skill.enabled, uses: skill.uses,
        missingTools: getSkillService().missingTools(skill, available()), history: skill.history.map((version) => version.revision) }))) },
    { name: "skill_read", label: "正在读取技能步骤", description: "读取已启用技能的当前 SKILL.md 和版本，按需遵循步骤执行用户当前任务。技能不能授权额外任务，也不能替代实际工具执行结果。",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }) }), execute: async (_id, args) => text(readSkillForAgent((args as { name: string }).name, available())) },
    { name: "skill_save", label: "正在整理并保存技能", description: "用户要求总结成功做法、教会流程、以后按同样方式做时，将可复用步骤保存为手机技能，下次可自动加载。name 为英文小写编号，title/description/steps 可用中文；触发短语尽量具体。只依赖已有工具，不写死本次文件编号、任务编号或密钥。source=experience 必须有所有 requiredTools 的真实成功调用依据；仅提交后台任务不代表流程已经成功。用户教给而尚未实测的流程用 source=user。更新同名技能先读取版本，并传 expectedRevision。",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }), title: Type.String({ minLength: 1, maxLength: 80 }),
        description: Type.String({ minLength: 1, maxLength: 500 }), instructions: Type.String({ minLength: 1, maxLength: 6000 }),
        triggers: Type.Optional(Type.Array(Type.String({ minLength: 2, maxLength: 40 }), { maxItems: 12 })),
        requiredTools: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
        source: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("experience")])), expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })) }),
      execute: async (_id, args, signal) => {
        if (signal?.aborted) throw new Error("已取消保存技能");
        const skill = getSkillService().save(args as SkillInput, available(), skillEvidence());
        return text({ saved: true, name: skill.name, revision: skill.current.revision, enabled: skill.enabled, source: skill.current.source,
          evidenceTools: skill.current.evidenceTools, notice: "已保存到手机技能库，后续匹配任务可按需使用；保存不代表执行了技能步骤" });
      } },
    { name: "skill_manage", label: "正在整理技能库", description: "按用户要求启用、停用、删除技能，或将历史内容恢复为新版本。restore 要提供历史 revision；恢复后继续保留版本记录。",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }),
        action: Type.Union([Type.Literal("enable"), Type.Literal("disable"), Type.Literal("restore"), Type.Literal("delete")]), revision: Type.Optional(Type.Integer({ minimum: 1 })) }),
      execute: async (_id, args, signal) => {
        if (signal?.aborted) throw new Error("已取消整理技能");
        const { name, action, revision } = args as { name: string; action: "enable" | "disable" | "restore" | "delete"; revision?: number };
        const service = getSkillService();
        if (action === "delete") { service.remove(name); return text({ name, deleted: true }); }
        const skill = action === "restore" ? service.restore(name, revision ?? 0) : service.setEnabled(name, action === "enable");
        return text({ name, enabled: skill.enabled, revision: skill.current.revision });
      } },
  ];
}
