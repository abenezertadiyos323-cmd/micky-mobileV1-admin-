import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { initTelegram } from "./lib/telegram";
import AuthGuard from "./components/AuthGuard";
import Layout from "./components/Layout";
import ScrollToTop from "./components/ScrollToTop";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import ProductForm from "./pages/ProductForm";
import Inbox from "./pages/Inbox";
import ThreadDetail from "./pages/ThreadDetail";
import Exchanges from "./pages/Exchanges";
import ExchangeDetail from "./pages/ExchangeDetail";
import Settings from "./pages/Settings";
import SettingsAccess from "./pages/SettingsAccess";
import SettingsBackend from "./pages/SettingsBackend";

export default function App() {
  useEffect(() => {
    initTelegram();
  }, []);

  return (
    <BrowserRouter>
      <AuthGuard>
        <ScrollToTop />
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/inventory/add" element={<ProductForm />} />
            <Route path="/inventory/:id" element={<ProductForm />} />
            <Route path="/exchanges" element={<Exchanges />} />
            <Route path="/exchanges/:id" element={<ExchangeDetail />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/inbox/:id" element={<ThreadDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/access" element={<SettingsAccess />} />
            <Route path="/settings/backend" element={<SettingsBackend />} />
          </Route>
        </Routes>
      </AuthGuard>
    </BrowserRouter>
  );
}
