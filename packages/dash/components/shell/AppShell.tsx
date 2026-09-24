import Rail from "./Rail";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Rail />
      <main className="main">{children}</main>
    </div>
  );
}
