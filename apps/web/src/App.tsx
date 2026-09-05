import { Link, NavLink, Route, Routes } from "react-router-dom";
import SearchPage from "./pages/SearchPage";
import PassportPage from "./pages/PassportPage";
import BudgetPage from "./pages/BudgetPage";
import OrderPage from "./pages/OrderPage";
import AuditPage from "./pages/AuditPage";
import ConnectPage from "./pages/ConnectPage";
import ErrorPage from "./pages/ErrorPage";
import HomePage from "./pages/HomePage";

export default function App() {
  return (
    <div className="shell">
      <div className="topnav">
        <Link to="/" className="brand">
          Agent Gig <span>劳务市场 · V0.5</span>
        </Link>
        <nav>
          <NavLink to="/search">检索</NavLink>
          <NavLink to="/budget">额度</NavLink>
          <NavLink to="/connect">连接</NavLink>
          <NavLink to="/audit">审计</NavLink>
        </nav>
      </div>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/a/:did" element={<PassportPage />} />
        <Route path="/passports/:did" element={<PassportPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/error/:kind" element={<ErrorPage />} />
      </Routes>
    </div>
  );
}
