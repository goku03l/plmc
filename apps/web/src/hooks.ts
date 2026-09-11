import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  Category,
  CostSummary,
  Material,
  MaterialSupplierLink,
  NodeAttachment,
  NodeDetail,
  Project,
  ProjectTree,
  Rfq,
  RfqListRow,
  Supplier,
  SupplierAssignments,
} from "./types";

/* ---------- projects ---------- */
export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/projects") });

export const useProject = (id: string) =>
  useQuery({ queryKey: ["project", id], queryFn: () => api.get<Project>(`/projects/${id}`), enabled: !!id });

export const useProjectTree = (id: string) =>
  useQuery({ queryKey: ["tree", id], queryFn: () => api.get<ProjectTree>(`/projects/${id}/tree`), enabled: !!id });

export const useProjectSummary = (id: string) =>
  useQuery({ queryKey: ["summary", id], queryFn: () => api.get<CostSummary>(`/projects/${id}/summary`), enabled: !!id });

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Project>) => api.post<Project>("/projects", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/* ---------- categories ---------- */
export const useCategories = (projectId: string) =>
  useQuery({
    queryKey: ["categories", projectId],
    queryFn: () => api.get<Category[]>(`/projects/${projectId}/categories`),
    enabled: !!projectId,
  });

export function useCategoryMutations(projectId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["categories", projectId] });
    qc.invalidateQueries({ queryKey: ["tree", projectId] });
    qc.invalidateQueries({ queryKey: ["summary", projectId] });
  };
  return {
    create: useMutation({
      mutationFn: (body: Partial<Category>) => api.post<Category>(`/projects/${projectId}/categories`, body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<Category> & { id: string }) => api.patch<Category>(`/categories/${id}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/categories/${id}`),
      onSuccess: invalidate,
    }),
  };
}

/* ---------- nodes ---------- */
export const useNode = (nodeId: string | null) =>
  useQuery({
    queryKey: ["node", nodeId],
    queryFn: () => api.get<NodeDetail>(`/nodes/${nodeId}`),
    enabled: !!nodeId,
  });

export function useNodeMutations(projectId: string) {
  const qc = useQueryClient();
  const invalidate = (nodeId?: string) => {
    qc.invalidateQueries({ queryKey: ["tree", projectId] });
    qc.invalidateQueries({ queryKey: ["summary", projectId] });
    if (nodeId) qc.invalidateQueries({ queryKey: ["node", nodeId] });
  };
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post(`/projects/${projectId}/nodes`, body),
      onSuccess: () => invalidate(),
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api.patch(`/nodes/${id}`, body),
      onSuccess: (_d, v) => invalidate(v.id),
    }),
    move: useMutation({
      mutationFn: ({ id, ...body }: { id: string; parentId: string | null; sortOrder?: number }) =>
        api.post(`/nodes/${id}/move`, body),
      onSuccess: () => invalidate(),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/nodes/${id}`),
      onSuccess: () => invalidate(),
    }),
  };
}

/* ---------- node documents (PDM: drawings, photos, PDFs, anything) ---------- */
export function useNodeAttachmentMutations(nodeId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    if (nodeId) qc.invalidateQueries({ queryKey: ["node", nodeId] });
  };
  return {
    upload: useMutation({
      mutationFn: (file: File) => api.upload<NodeAttachment>(`/nodes/${nodeId}/attachments`, file),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (attachmentId: string) => api.del(`/nodes/${nodeId}/attachments/${attachmentId}`),
      onSuccess: invalidate,
    }),
  };
}

/* ---------- bom ---------- */
export function useBomMutations(projectId: string, nodeId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tree", projectId] });
    qc.invalidateQueries({ queryKey: ["summary", projectId] });
    if (nodeId) qc.invalidateQueries({ queryKey: ["node", nodeId] });
  };
  return {
    add: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post(`/nodes/${nodeId}/bom`, body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api.patch(`/bom/${id}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/bom/${id}`),
      onSuccess: invalidate,
    }),
  };
}

/* ---------- materials ---------- */
export const useMaterials = (q?: string) =>
  useQuery({
    queryKey: ["materials", q ?? ""],
    queryFn: () => api.get<Material[]>(`/materials${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  });

export function useMaterialMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["materials"] });
  return {
    create: useMutation({
      mutationFn: (body: Partial<Material>) => api.post<Material>("/materials", body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<Material> & { id: string }) => api.patch<Material>(`/materials/${id}`, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/materials/${id}`),
      onSuccess: invalidate,
    }),
  };
}

/* ---------- suppliers ---------- */
export const useSuppliers = (q?: string, trade?: string) =>
  useQuery({
    queryKey: ["suppliers", q ?? "", trade ?? ""],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (trade) p.set("trade", trade);
      return api.get<Supplier[]>(`/suppliers${p.toString() ? `?${p}` : ""}`);
    },
  });

export const useSupplier = (id: string | null) =>
  useQuery({ queryKey: ["supplier", id], queryFn: () => api.get<Supplier>(`/suppliers/${id}`), enabled: !!id });

export function useSupplierMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["suppliers"] });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post<Supplier>("/suppliers", body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
        api.patch<Supplier>(`/suppliers/${id}`, body),
      onSuccess: (_d, v) => {
        invalidate();
        qc.invalidateQueries({ queryKey: ["supplier", v.id] });
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/suppliers/${id}`), onSuccess: invalidate }),
  };
}

/* ---------- RFQs ---------- */
export const useRfqs = (params: { projectId?: string; nodeId?: string } = {}) =>
  useQuery({
    queryKey: ["rfqs", params.projectId ?? "", params.nodeId ?? ""],
    queryFn: () => {
      const p = new URLSearchParams();
      if (params.projectId) p.set("projectId", params.projectId);
      if (params.nodeId) p.set("nodeId", params.nodeId);
      return api.get<RfqListRow[]>(`/rfqs${p.toString() ? `?${p}` : ""}`);
    },
  });

export const useRfq = (id: string | null) =>
  useQuery({ queryKey: ["rfq", id], queryFn: () => api.get<Rfq>(`/rfqs/${id}`), enabled: !!id });

export function useRfqMutations(rfqId?: string) {
  const qc = useQueryClient();
  const refresh = (data?: Rfq) => {
    if (data?.id) qc.setQueryData(["rfq", data.id], data);
    qc.invalidateQueries({ queryKey: ["rfqs"] });
    if (rfqId) qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
  };
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post<Rfq>("/rfqs", body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api.patch<Rfq>(`/rfqs/${id}`, body),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/rfqs/${id}`), onSuccess: () => refresh() }),
    addItem: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post<Rfq>(`/rfqs/${rfqId}/items`, body),
      onSuccess: refresh,
    }),
    updateItem: useMutation({
      mutationFn: ({ itemId, ...body }: { itemId: string } & Record<string, unknown>) =>
        api.patch<Rfq>(`/rfqs/${rfqId}/items/${itemId}`, body),
      onSuccess: refresh,
    }),
    removeItem: useMutation({
      mutationFn: (itemId: string) => api.del(`/rfqs/${rfqId}/items/${itemId}`).then(() => undefined),
      onSuccess: () => refresh(),
    }),
    addSuppliers: useMutation({
      mutationFn: (supplierIds: string[]) => api.post<Rfq>(`/rfqs/${rfqId}/suppliers`, { supplierIds }),
      onSuccess: refresh,
    }),
    removeSupplier: useMutation({
      mutationFn: (rfqSupplierId: string) =>
        api.del(`/rfqs/${rfqId}/suppliers/${rfqSupplierId}`).then(() => undefined),
      onSuccess: () => refresh(),
    }),
    send: useMutation({
      mutationFn: (body: Record<string, unknown> = {}) =>
        api.post<{ mailEnabled: boolean; sent: { email: string; delivered: boolean }[]; rfq: Rfq }>(
          `/rfqs/${rfqId}/send`,
          body,
        ),
      onSuccess: (r) => refresh(r.rfq),
    }),
    award: useMutation({
      mutationFn: (rfqSupplierId: string) => api.post<Rfq>(`/rfqs/${rfqId}/award`, { rfqSupplierId }),
      onSuccess: refresh,
    }),
  };
}

/* ---------- material ↔ supplier links & assignments ---------- */
export const useMaterialSuppliers = (materialId: string | null) =>
  useQuery({
    queryKey: ["material-suppliers", materialId],
    queryFn: () => api.get<MaterialSupplierLink[]>(`/materials/${materialId}/suppliers`),
    enabled: !!materialId,
  });

export function useMaterialSupplierMutations(materialId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["material-suppliers", materialId] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };
  return {
    link: useMutation({
      mutationFn: (body: { supplierId: string; preferred?: boolean }) =>
        api.post(`/materials/${materialId}/suppliers`, body),
      onSuccess: invalidate,
    }),
    unlink: useMutation({
      mutationFn: (supplierId: string) =>
        api.del(`/materials/${materialId}/suppliers/${supplierId}`).then(() => undefined),
      onSuccess: invalidate,
    }),
  };
}

export const useSupplierAssignments = (projectId: string, nodeId?: string) =>
  useQuery({
    queryKey: ["supplier-assignments", projectId, nodeId ?? ""],
    queryFn: () =>
      api.get<SupplierAssignments>(
        `/projects/${projectId}/supplier-assignments${nodeId ? `?nodeId=${nodeId}` : ""}`,
      ),
    enabled: !!projectId,
  });

export function useAssignSupplier(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { materialId: string; supplierId: string | null; nodeId?: string | null }) =>
      api.post<{ updated: number }>(`/projects/${projectId}/assign-supplier`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-assignments", projectId] });
      qc.invalidateQueries({ queryKey: ["tree", projectId] });
      qc.invalidateQueries({ queryKey: ["node"] });
    },
  });
}
