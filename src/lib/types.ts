import type { FileKind } from "../../shared/fileTypes";
import type { MaterialProps } from "../equations/laminate";

export type Role = "owner" | "editor" | "viewer";

export interface Project {
  id: string;
  name: string;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface Member {
  project_id: string;
  user_id: string;
  role: Role;
  profiles: Profile | null;
}

export interface Invite {
  project_id: string;
  email: string;
  role: Role;
}

export interface Subsystem {
  id: string;
  project_id: string;
  name: string;
  description: string;
  position: number;
}

export interface Part {
  id: string;
  project_id: string;
  subsystem_id: string;
  name: string;
  slug: string;
  part_number: string;
  description: string;
  status: string;
  layup_symmetric: boolean;
  updated_at: string;
}

export interface FileRow {
  id: string;
  project_id: string;
  subsystem_id: string | null;
  part_id: string | null;
  name: string;
  kind: FileKind;
  mime_type: string;
  size_bytes: number;
  source: "upload" | "drive";
  drive_file_id: string | null;
  drive_url: string | null;
  revision: string;
  lineage_id: string;
  rev_number: number;
  notes: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Variable {
  id: string;
  project_id: string;
  part_id: string | null;
  name: string;
  expression: string;
  display_unit: string;
  description: string;
  position: number;
  updated_by: string | null;
  updated_at: string;
}

export const PART_STATUSES = ["concept", "design", "analysis", "review", "released", "manufactured"] as const;

export interface Material extends MaterialProps {
  project_id: string;
  notes: string;
}

export interface LayupPly {
  id: string;
  project_id: string;
  part_id: string;
  material_id: string;
  position: number;
  angle_deg: number;
  count: number;
  label: string;
}

export interface VariableChange {
  id: number;
  project_id: string;
  variable_id: string;
  part_id: string | null;
  name: string;
  op: "insert" | "update" | "delete";
  old_name: string | null;
  old_expression: string | null;
  new_expression: string | null;
  old_unit: string | null;
  new_unit: string | null;
  changed_by: string | null;
  changed_at: string;
  profiles: Pick<Profile, "full_name" | "email"> | null;
}
