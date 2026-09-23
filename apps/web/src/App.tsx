import { NavLink, Outlet } from "react-router-dom";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▚</span> Summer
          <span className="brand-sub">Construction PLM / BOM</span>
        </div>
        <nav>
          <NavLink to="/projects" end>
            Projects
          </NavLink>
          <NavLink to="/materials">Material catalog</NavLink>
          <NavLink to="/suppliers">Suppliers</NavLink>
          <NavLink to="/rfqs">RFQs</NavLink>
          <NavLink to="/inventory">Inventory</NavLink>
          <NavLink to="/assistant">Summer</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
