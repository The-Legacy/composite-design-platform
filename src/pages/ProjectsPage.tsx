import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateProject, useProjects } from "../data/queries";
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, Spinner, Textarea } from "../components/ui";
import TopBar from "../components/TopBar";

export default function ProjectsPage() {
  const { data: projects, isLoading, error } = useProjects();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <Button variant="primary" onClick={() => setOpen(true)}>
            + New project
          </Button>
        </div>
        <ErrorText error={error} />
        {isLoading ? (
          <Spinner />
        ) : projects?.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link key={p.id} to={`/p/${p.id}`}>
                <Card className="h-full p-5 transition hover:border-accent hover:shadow-md">
                  <div className="font-semibold">{p.name}</div>
                  <div className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description || "No description"}</div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No projects yet">
            Create one, or ask a project owner to add your Google account.
          </EmptyState>
        )}
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
        <div className="flex justify-end gap-2">
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
