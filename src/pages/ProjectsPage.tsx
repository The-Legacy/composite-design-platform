import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateProject, useProjects } from "../data/queries";
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, Monogram, Page, PageHeader, Spinner, Textarea } from "../components/ui";
import { ArrowRightIcon, FolderIcon, PlusIcon } from "../components/icons";
import TopBar from "../components/TopBar";

export default function ProjectsPage() {
  const { data: projects, isLoading, error } = useProjects();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex-1 overflow-auto">
        <Page>
          <PageHeader
            title="Projects"
            description="Each project holds its subsystems, parts, layups, equations and files."
            actions={
              <Button variant="primary" onClick={() => setOpen(true)}>
                <PlusIcon /> New project
              </Button>
            }
          />
          <ErrorText error={error} />
          {isLoading ? (
            <Spinner />
          ) : projects?.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <Link key={p.id} to={`/p/${p.id}`} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <Card className="flex h-full flex-col p-5 transition group-hover:-translate-y-px group-hover:border-slate-300 group-hover:shadow-lift">
                    <div className="flex items-start gap-3">
                      <Monogram name={p.name} className="h-10 w-10 text-base" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900">{p.name}</div>
                        <div className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description || "No description"}</div>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center gap-1 pt-5 text-xs font-medium text-slate-400 transition group-hover:text-accent">
                      Open project <ArrowRightIcon size={13} className="transition group-hover:translate-x-0.5" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FolderIcon}
              title="No projects yet"
              action={
                <Button variant="primary" onClick={() => setOpen(true)}>
                  <PlusIcon /> New project
                </Button>
              }
            >
              Create one, or ask a project owner to add your Google account.
            </EmptyState>
          )}
        </Page>
      </main>
      <NewProjectModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const p = await create.mutateAsync({ name: name.trim(), description });
          onClose();
          navigate(`/p/${p.id}`);
        }}
      >
        <Field label="Name">
          <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MedLaunch Rocket 2027" />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={create.isPending || !name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
