import type { SkillMeta } from '@proma/shared'

export interface SkillGroup {
  id: string
  title: string
  skills: SkillMeta[]
}

const UNGROUPED_TITLE = '未分组'

function normalizeGroup(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

export function getSkillGroupTitle(skill: SkillMeta): string {
  if (skill.group) {
    const group = normalizeGroup(skill.group)
    if (group) return group
  }

  return UNGROUPED_TITLE
}

export function groupSkills(skills: SkillMeta[]): SkillGroup[] {
  // 聚合 key 用小写归一化：避免 "proma" 与 "Proma" 这类仅大小写不同的 group
  // 被拆成两个分组——它们的 id（= title.toLowerCase()）会相同，导致 React key 冲突。
  // 显示用的 title 保留首次遇到的原始写法。
  const groups = new Map<string, { title: string; skills: SkillMeta[] }>()

  for (const skill of skills) {
    const title = getSkillGroupTitle(skill)
    const key = title.toLowerCase()
    const existing = groups.get(key)
    if (existing) {
      existing.skills.push(skill)
    } else {
      groups.set(key, { title, skills: [skill] })
    }
  }

  return [...groups.values()]
    .map(({ title, skills }) => ({
      id: title.toLowerCase(),
      title,
      skills,
    }))
    .sort((a, b) => compareGroupTitle(a.title, b.title))
}

function compareGroupTitle(a: string, b: string): number {
  if (a === UNGROUPED_TITLE && b !== UNGROUPED_TITLE) return 1
  if (b === UNGROUPED_TITLE && a !== UNGROUPED_TITLE) return -1
  return a.localeCompare(b, 'zh-CN')
}
