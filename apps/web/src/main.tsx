import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectPage from "./pages/ProjectPage";
import MaterialsPage from "./pages/MaterialsPage";
import SuppliersPage from "./pages/SuppliersPage";
import ProcurementPage from "./pages/ProcurementPage";
import RfqsPage from "./pages/RfqsPage";
import RfqDetailPage from "./pages/RfqDetailPage";
import PortalPage from "./pages/PortalPage";
import AssistantPage from "./pages/AssistantPage";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: "projects/:projectId", element: <ProjectPage /> },
      { path: "projects/:projectId/procurement", element: <ProcurementPage /> },
      { path: "materials", element: <MaterialsPage /> },
      { path: "suppliers", element: <SuppliersPage /> },
      { path: "rfqs", element: <RfqsPage /> },
      { path: "rfqs/:rfqId", element: <RfqDetailPage /> },
      { path: "assistant", element: <AssistantPage /> },
    ],
  },
  { path: "/portal/:token", element: <PortalPage /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
