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

const DESKTOP_MIN_WIDTH_PX = 768;

function getInitialSidebarOpen() {
  return window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches;
}

export const useAppStore = create<AppState>((set) => ({
  conversations: [],
  activeConversationId: null,
  sidebarOpen: getInitialSidebarOpen(),
  rightSidebarOpen: false,
  themePreference: "system",
  vizPayloads: [],
  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setRightSidebarOpen: (rightSidebarOpen) => set({ rightSidebarOpen }),
  setThemePreference: (themePreference) => set({ themePreference }),
  pushVizPayload: (payload) =>
    set((state) => {
      const existing = state.vizPayloads.find((item) => item.id === payload.id);
      if (
        existing &&
        existing.toolName === payload.toolName &&
        existing.title === payload.title &&
        existing.data === payload.data &&
        existing.chartSpec === payload.chartSpec
      ) {
        return state;
      }
      return {
        // Upsert by ID so streaming updates don't duplicate artifacts.
        vizPayloads: [payload, ...state.vizPayloads.filter((item) => item.id !== payload.id)].slice(0, 20),
      };
    }),
  clearVizPayloads: () => set({ vizPayloads: [] }),
}));
