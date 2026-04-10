import { create } from "zustand";
import type { ArtifactLibrary, ChatConversation, ThemePreference, VizPayload } from "@/lib/types";

type AppState = {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  sidebarOpen: boolean;
  rightSidebarOpen: boolean;
  themePreference: ThemePreference;
  vizPayloads: VizPayload[];
  artifactLibrary: ArtifactLibrary | null;
  pinnedArtifacts: VizPayload[];
  setConversations: (conversations: ChatConversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setRightSidebarOpen: (isOpen: boolean) => void;
  setThemePreference: (theme: ThemePreference) => void;
  pushVizPayload: (payload: VizPayload) => void;
  clearVizPayloads: () => void;
  setArtifactLibrary: (library: ArtifactLibrary | null) => void;
  pinArtifact: (payload: VizPayload) => void;
  unpinArtifact: (id: string) => void;
  clearPinnedArtifacts: () => void;
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
  artifactLibrary: null,
  pinnedArtifacts: [],
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
        vizPayloads: [payload, ...state.vizPayloads.filter((item) => item.id !== payload.id)].slice(0, 120),
      };
    }),
  clearVizPayloads: () => set({ vizPayloads: [] }),
  setArtifactLibrary: (artifactLibrary) => set({ artifactLibrary }),
  pinArtifact: (payload) =>
    set((state) => ({
      pinnedArtifacts: [payload, ...state.pinnedArtifacts.filter((item) => item.id !== payload.id)].slice(0, 5),
    })),
  unpinArtifact: (id) =>
    set((state) => ({
      pinnedArtifacts: state.pinnedArtifacts.filter((item) => item.id !== id),
    })),
  clearPinnedArtifacts: () => set({ pinnedArtifacts: [] }),
}));
