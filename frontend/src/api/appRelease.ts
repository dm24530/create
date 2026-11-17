import { apiClient } from "./client";

export interface CreateClientReleaseDownloads {
  windows_x64: string;
  macos_arm64: string;
  macos_x64: string;
}

export interface CreateClientRelease {
  enabled: boolean;
  version: string;
  published_at: string;
  minimum_version: string;
  notes: string;
  update_base_url: string;
  downloads: CreateClientReleaseDownloads;
}

export async function getCreateClientRelease(): Promise<CreateClientRelease> {
  const { data } = await apiClient.get<CreateClientRelease>(
    "/public/create-client-release",
  );
  return data;
}
