export type SkillInput = { name: string; title: string; description: string; instructions: string; triggers?: string[];
  requiredTools?: string[]; source?: "user" | "experience"; expectedRevision?: number };
export type SkillVersion = Omit<SkillInput, "expectedRevision" | "source"> & { triggers: string[]; requiredTools: string[];
  source: "user" | "experience"; revision: number; createdAt: number; evidenceTools: string[] };
export type SavedSkill = { name: string; enabled: boolean; current: SkillVersion; history: SkillVersion[];
  createdAt: number; updatedAt: number; uses: number; lastUsedAt?: number };
export interface SkillRepository { list(): SavedSkill[]; save(skill: SavedSkill): void; remove(name: string): void }
const MAX_SKILLS = 40;
const normalized = (text: string) => text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
function field(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label}不能为空，最多 ${max} 字`);
  const text = value.trim();
  if (/\b(?:sk-|tvly-)[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{16,}/i.test(text)) throw new Error("技能中不能保存 API Key 或访问令牌");
  return text;
}
export function skillMarkdown(skill: SkillVersion): string {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions}\n`;
}
/** App-owned mobile storage adapter for Pi's name/description -> SKILL.md loading pattern. */
export class SkillService {
  private records: SavedSkill[];
  private listeners = new Set<() => void>();
  constructor(private readonly repository: SkillRepository, private readonly now = Date.now) {
    this.records = repository.list().sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getSnapshot = () => this.records;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get(name: string): SavedSkill {
    const skill = this.records.find((item) => item.name === name);
    if (!skill) throw new Error("没有找到这个技能，请先列出技能");
    return skill;
  }
  private store(value: SavedSkill): SavedSkill {
    // Publish only after SQLite succeeds. A full disk must never produce a phantom saved skill.
    this.repository.save(value);
    this.records = [value, ...this.records.filter((item) => item.name !== value.name)].sort((a, b) => b.updatedAt - a.updatedAt);
    this.listeners.forEach((listener) => listener()); return value;
  }
  save(input: SkillInput, availableTools: string[], evidenceTools: string[] = []): SavedSkill {
    if (typeof input.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.name) || input.name.length > 64) throw new Error("技能编号请用不超过 64 位的小写字母、数字和单个连字符");
    const title = field(input.title, "技能名称", 80), description = field(input.description, "适用场景", 500);
    const instructions = field(input.instructions, "技能步骤", 6000);
    if (!Array.isArray(input.triggers ?? []) || (input.triggers?.length ?? 0) > 12) throw new Error("最多填写 12 个触发短语");
    const triggers = [...new Set((input.triggers ?? []).map((value) => field(value, "触发短语", 40)))];
    if (triggers.some((value) => normalized(value).length < 2)) throw new Error("触发短语至少两个有效字符");
    if (!Array.isArray(input.requiredTools ?? []) || (input.requiredTools?.length ?? 0) > 16) throw new Error("最多指定 16 个已有工具");
    const requiredTools = [...new Set(input.requiredTools ?? [])];
    const missing = requiredTools.filter((tool) => !availableTools.includes(tool));
    if (missing.length) throw new Error(`这些工具尚未接入，不能保存为可执行技能：${missing.join("、")}`);
    const source = input.source ?? "user";
    if (source !== "user" && source !== "experience") throw new Error("技能来源无效");
    const evidence = [...new Set(evidenceTools.filter((tool) => requiredTools.includes(tool) || !requiredTools.length && tool === "assistant_reply"))];
    if (source === "experience" && (requiredTools.length ? !requiredTools.every((tool) => evidence.includes(tool)) : !evidence.includes("assistant_reply"))) {
      throw new Error("尚缺这些步骤的真实成功调用依据；请先完成流程，或作为用户教给的流程保存，不能假称已经验证");
    }
    const previous = this.records.find((item) => item.name === input.name);
    if (!previous && this.records.length >= MAX_SKILLS) throw new Error(`技能库最多 ${MAX_SKILLS} 项，请先整理不用的技能`);
    const content = { name: input.name, title, description, instructions, triggers, requiredTools, source };
    if (previous && Object.entries(content).every(([key, value]) => JSON.stringify(value) === JSON.stringify(previous.current[key as keyof SkillVersion]))) return previous;
    if (previous && input.expectedRevision !== previous.current.revision) throw new Error("技能版本已变化；请先读取当前技能，再带 expectedRevision 更新");
    const now = this.now(), version: SkillVersion = { ...content, revision: (previous?.current.revision ?? 0) + 1, createdAt: now, evidenceTools: evidence };
    return this.store({ name: input.name, enabled: previous?.enabled ?? true, current: version,
      history: previous ? [...previous.history, previous.current].slice(-8) : [], createdAt: previous?.createdAt ?? now, updatedAt: now,
      uses: previous?.uses ?? 0, ...(previous?.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}) });
  }
  setEnabled(name: string, enabled: boolean): SavedSkill {
    const skill = this.get(name); return skill.enabled === enabled ? skill : this.store({ ...skill, enabled, updatedAt: this.now() });
  }
  restore(name: string, revision: number): SavedSkill {
    const skill = this.get(name), version = skill.history.find((item) => item.revision === revision);
    if (!version) throw new Error("没有找到这个历史版本");
    return this.store({ ...skill, current: { ...version, revision: skill.current.revision + 1, createdAt: this.now() },
      history: [...skill.history, skill.current].slice(-8), updatedAt: this.now() });
  }
  remove(name: string): void {
    this.get(name); this.repository.remove(name); this.records = this.records.filter((item) => item.name !== name); this.listeners.forEach((listener) => listener());
  }
  missingTools(skill: SavedSkill, availableTools: string[]): string[] { return skill.current.requiredTools.filter((tool) => !availableTools.includes(tool)); }
  read(name: string, availableTools: string[], countUse = false): { name: string; revision: number; markdown: string; requiredTools: string[] } {
    let skill = this.get(name);
    if (!skill.enabled) throw new Error("这个技能已停用；请先启用再使用");
    const missing = this.missingTools(skill, availableTools);
    if (missing.length) throw new Error(`这个技能缺少工具：${missing.join("、")}`);
    if (countUse) skill = this.store({ ...skill, uses: skill.uses + 1, lastUsedAt: this.now() });
    return { name, revision: skill.current.revision, markdown: skillMarkdown(skill.current), requiredTools: skill.current.requiredTools };
  }
  catalog(availableTools: string[]) {
    return this.records.filter((skill) => skill.enabled && !this.missingTools(skill, availableTools).length).map((skill) => ({
      name: skill.name, title: skill.current.title.slice(0, 40), description: skill.current.description.slice(0, 160),
      triggers: skill.current.triggers.slice(0, 4), revision: skill.current.revision,
    }));
  }
  matching(query: string, availableTools: string[]): SavedSkill[] {
    const text = normalized(query);
    // Management requests should inspect/edit current versions instead of invoking their workflows.
    if (/技能|skill|总结.*经验|记住.*流程|学会/.test(query.toLocaleLowerCase())) return [];
    return this.records.filter((skill) => skill.enabled && !this.missingTools(skill, availableTools).length)
      .map((skill) => ({ skill, score: Math.max(0, ...skill.current.triggers.map((trigger) => text.includes(normalized(trigger)) ? normalized(trigger).length : 0)) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map((item) => item.skill);
  }
}
