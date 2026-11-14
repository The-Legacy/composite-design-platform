import { useOutletContext } from "react-router";
import type { Part, Project, Role, Subsystem } from "../lib/types";

export interface ProjectCtx {
  project: Project;
  role: Role | null;
  canEdit: boolean;
  subsystems: Subsystem[];
  parts: Part[];
  openNewPart: (subsystemId?: string) => void;
}

export const useProjectCtx = () => useOutletContext<ProjectCtx>();
