import { useEffect, useState } from "react";
import { api } from "./api";
import { Link, match, navigate, RouterProvider, usePath } from "./router";
import { AssignmentPage } from "./pages/Assignment";
import { AuthPage } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { MetricsPage } from "./pages/Metrics";
import { ReviewPage } from "./pages/Review";
import { SettingsPage } from "./pages/Settings";
import { StudentJoin, StudentReceipt, StudentSubmit } from "./pages/Student";

export interface Me {
  id: string;
  email: string;
  display_name: string;
}

export function App() {
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
}

function Shell() {
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const isStudent = path === "/s" || path.startsWith("/s/") || path.startsWith("/r/");

  useEffect(() => {
    if (isStudent) return;
    api.get<Me>("/me").then(setMe, () => setMe(null));
  }, [isStudent]);

  if (isStudent) {
    let m;
    return (
      <div className="page student">
        <header className="topbar">
          <Link to="/s" className="brand">Margin</Link>
        </header>
        <main>
          {(m = match("/s/:code", path)) ? <StudentSubmit code={m.code!} /> :
           (m = match("/r/:token", path)) ? <StudentReceipt token={m.token!} /> :
           <StudentJoin />}
        </main>
      </div>
    );
  }

  if (me === undefined) return null;
  if (me === null) return <AuthPage onAuthed={() => api.get<Me>("/me").then(setMe)} />;

  const logout = async () => {
    await api.post("/auth/logout");
    setMe(null);
    navigate("/");
  };

  let m;
  const page =
    (m = match("/assignments/:id", path)) ? <AssignmentPage id={m.id!} /> :
    (m = match("/submissions/:id", path)) ? <ReviewPage id={m.id!} /> :
    path === "/metrics" ? <MetricsPage /> :
    path === "/settings" ? <SettingsPage /> :
    <Dashboard />;

  return (
    <div className="page">
      <header className="topbar">
        <Link to="/" className="brand">Margin</Link>
        <nav>
          <Link to="/">Assignments</Link>
          <Link to="/metrics">AI accuracy</Link>
          <Link to="/settings">Settings</Link>
          <button className="link" onClick={logout}>Log out</button>
        </nav>
      </header>
      <main>{page}</main>
    </div>
  );
}
