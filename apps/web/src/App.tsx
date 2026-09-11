import { NavLink, Outlet } from "react-router-dom";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▚</span> PLMC
          <span className="brand-sub">Construction PLM / BOM</span>
        </div>
        <nav>
          <NavLink to="/" end>
            Projects
          </NavLink>
          <NavLink to="/materials">Material catalog</NavLink>
          <NavLink to="/suppliers">Suppliers</NavLink>
          <NavLink to="/rfqs">RFQs</NavLink>
          <NavLink to="/assistant">Assistant</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
