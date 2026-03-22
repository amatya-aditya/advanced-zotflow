/**
 * React context that makes the workflow Zustand store available to
 * deeply nested components (e.g. BaseNode rendered inside React Flow).
 */

import { createContext, useContext } from "react";

import type { StoreApi } from "zustand/vanilla";
import type { WorkflowState } from "./store";

export const WorkflowStoreContext =
    createContext<StoreApi<WorkflowState> | null>(null);

export function useWorkflowStoreApi(): StoreApi<WorkflowState> {
    const store = useContext(WorkflowStoreContext);
    if (!store) {
        throw new Error(
            "useWorkflowStoreApi must be used within <WorkflowStoreContext.Provider>",
        );
    }
    return store;
}
