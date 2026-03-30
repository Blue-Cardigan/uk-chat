import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 1300,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/](react-dom|react|react-router|react-router-dom)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/](ai|@ai-sdk)[\\/]/.test(id)) return "vendor-ai";
          if (/[\\/]recharts[\\/]/.test(id)) return "vendor-charts";
          if (/[\\/](d3-geo|d3-scale|d3-selection|d3-zoom|topojson-client)[\\/]/.test(id)) return "vendor-d3";
          if (/[\\/](react-markdown|remark-gfm|micromark|mdast|unified|unist)/.test(id)) return "vendor-markdown";
          if (/[\\/](pdfjs-dist|mammoth|xlsx)[\\/]/.test(id)) return "vendor-docs";
          if (/[\\/]@supabase[\\/]/.test(id)) return "vendor-supabase";
        },
      },
    },
  },
});
