import type { SkillLabelFields, SkillChainPattern } from "../../types/dashboards";

export function displaySkillLabel(
  row: SkillLabelFields & { skill_id?: string | null },
): string {
  return row.display_name || row.skill_name || row.problem_name || row.skill_id || "";
}

export function displayChainSkillLabel(
  skillId: string,
  displayName?: string,
  skillName?: string,
  problemName?: string,
): string {
  return displayName || skillName || problemName || skillId || "\u2014";
}

export function displayFromChainSkillLabel(row: SkillChainPattern): string {
  return displayChainSkillLabel(
    row.from_skill,
    row.from_display_name,
    row.from_skill_name,
    row.from_problem_name,
  );
}

export function displayToChainSkillLabel(row: SkillChainPattern): string {
  return displayChainSkillLabel(
    row.to_skill,
    row.to_display_name,
    row.to_skill_name,
    row.to_problem_name,
  );
}
