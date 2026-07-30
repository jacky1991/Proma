import type { SkillMeta, SkillGroupDef, SkillsGroupConfig } from '@proma/shared'

export interface UserSkillGroup {
  /** 分组定义；null = 未分组 */
  group: SkillGroupDef | null
  skills: SkillMeta[]
}

/**
 * 按用户分组配置（groups + assignments）归集用户技能。
 *
 * 分组归属来自独立的 skills-groups.json 映射，不读取 SKILL.md 的 group 字段。
 * - 已分配的技能按 groups 的 order 升序排列
 * - 未分配的技能统一归入「未分组」，排在最后
 * - 空分组（无技能）也保留，便于 UI 展示并允许改名/删除
 */
export function groupUserSkills(skills: SkillMeta[], config: SkillsGroupConfig): UserSkillGroup[] {
  const grouped = new Map<string, SkillMeta[]>()
  for (const g of config.groups) grouped.set(g.id, [])
  const ungrouped: SkillMeta[] = []

  for (const skill of skills) {
    const gid = config.assignments[skill.slug]
    if (gid && grouped.has(gid)) grouped.get(gid)!.push(skill)
    else ungrouped.push(skill)
  }

  const ordered = [...config.groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const result: UserSkillGroup[] = ordered.map((g) => ({ group: g, skills: grouped.get(g.id) ?? [] }))
  if (ungrouped.length > 0) result.push({ group: null, skills: ungrouped })
  return result
}
