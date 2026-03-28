import { create } from "zustand";
import type { ChatConversation, ThemePreference, VizPayload } from "@/lib/types";

type AppState = {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  sidebarOpen: boolean;
  rightSidebarOpen: boolean;
  themePreference: ThemePreference;
  vizPayloads: VizPayload[];
  setConversations: (conversations: ChatConversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setRightSidebarOpen: (isOpen: boolean) => void;
  setThemePreference: (theme: ThemePreference) => void;
  pushVizPayload: (payload: VizPayload) => void;
  clearVizPayloads: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  conversations: [],
  activeConversationId: null,
  sidebarOpen: true,
  rightSidebarOpen: true,
  themePreference: "system",
  vizPayloads: [],
  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setRightSidebarOpen: (rightSidebarOpen) => set({ rightSidebarOpen }),
  setThemePreference: (themePreference) => set({ themePreference }),
  pushVizPayload: (payload) =>
    set((state) => ({
      vizPayloads: [payload, ...state.vizPayloads].slice(0, 20),
    })),
  clearVizPayloads: () => set({ vizPayloads: [] }),
}));
