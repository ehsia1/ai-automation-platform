/**
 * Vector Stores
 *
 * Export all vector store implementations and factory function.
 */

export * from "./file-store";

import type { VectorStore } from "../types";
import { createFileStore, type FileStoreConfig } from "./file-store";

export type VectorStoreType = "file" | "sst";

export interface CreateVectorStoreOptions {
  type?: VectorStoreType;
  file?: FileStoreConfig;
}

/**
 * Create a vector store based on configuration or environment
 */
export function createVectorStore(
  options: CreateVectorStoreOptions = {}
): VectorStore {
  const type = options.type || (process.env.VECTOR_STORE as VectorStoreType) || "file";

  switch (type) {
    case "sst":
      // SST Vector store would be added when deploying to AWS
      // For now, fall back to file store
      console.warn("[VectorStore] SST store not yet implemented, using file store");
      return createFileStore(options.file);
    case "file":
    default:
      return createFileStore(options.file);
  }
}
