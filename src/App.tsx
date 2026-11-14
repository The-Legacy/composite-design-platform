import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { supabaseConfigured } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectLayout from "./pages/ProjectLayout";
import ProjectOverview from "./pages/ProjectOverview";
import SubsystemPage from "./pages/SubsystemPage";
import PartPage from "./pages/PartPage";
import GlobalsPage from "./pages/GlobalsPage";
import SettingsPage from "./pages/SettingsPage";
import MaterialsPage from "./pages/MaterialsPage";
import RollupPage from "./pages/RollupPage";
import { Spinner } from "./components/ui";

export default function App() {
  const { session, loading } = useAuth();

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto mt-24 max-w-lg rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Supabase not configured</h1>
        Copy <code>.env.example</code> to <code>.env.local</code> and set <code>VITE_SUPABASE_URL</code> and{" "}
        <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>.
      </div>
    );
  }
  if (loading) return <Spinner full />;
  if (!session) return <LoginPage />;

  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/p/:projectId" element={<ProjectLayout />}>
        <Route index element={<ProjectOverview />} />
        <Route path="globals" element={<GlobalsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="materials" element={<MaterialsPage />} />
        <Route path="rollup" element={<RollupPage />} />
        <Route path="s/:subsystemId" element={<SubsystemPage />} />
        <Route path="part/:partId" element={<PartPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
